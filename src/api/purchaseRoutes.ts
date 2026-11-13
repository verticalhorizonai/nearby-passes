// Picks, Yes, Not now, Pay, return and cancel (Master Route Table; REQ-02-02, REQ-03-01, REQ-03-02, REQ-03-07..12).
import type { FastifyInstance } from 'fastify';
import { badRequest, ok, requireUuid } from './http.js';
import type { AppServices } from '../app.js';

export function registerPurchaseRoutes(app: FastifyInstance, s: AppServices): void {
  app.get<{ Params: { appointmentId: string } }>('/api/appointments/:appointmentId/picks', async (req, reply) => {
    const id = requireUuid(req.params.appointmentId, 'appointmentId');
    s.rateLimiter.count(req.sessionId); // every request to the agent endpoint counts (3.6.4)
    const result = await s.picks.picks(req.sessionId, id);
    return ok(reply, s.passes ? await s.passes.decoratePicks(result) : result); // Nearby Passes F8.3
  });
  // Signs of life (build ruling 43): this session's agent runs in flight, each with its tool calls so far. Read only;
  // it never starts a run and never counts toward the rate limit.
  app.get('/api/agent/runs', async (req, reply) => ok(reply, { runs: s.activity.list(req.sessionId) }));
  app.get<{ Params: { appointmentId: string } }>('/api/appointments/:appointmentId/map', async (req, reply) =>
    ok(reply, await s.map.mapData(req.sessionId, requireUuid(req.params.appointmentId, 'appointmentId'))),
  );
  // Show hidden picks again (build ruling 40). A POST, so the origin rule applies; it is not the agent endpoint, so it
  // never counts toward the rate limit and never starts a run.
  app.post<{ Params: { appointmentId: string } }>('/api/appointments/:appointmentId/picks/restore', async (req, reply) => {
    const result = await s.proposals.restoreDeclined(req.sessionId, requireUuid(req.params.appointmentId, 'appointmentId'));
    return ok(reply, s.passes ? await s.passes.decoratePicks(result) : result);
  });
  // Nearby Passes 3.6.3: an optional body { intent: 'paypal' | 'pass' }, default 'paypal'.
  app.post<{ Params: { proposalId: string }; Body: unknown }>('/api/proposals/:proposalId/accept', async (req, reply) => {
    const proposalId = requireUuid(req.params.proposalId, 'proposalId');
    const raw = (req.body ?? {}) as { intent?: unknown };
    const intent = raw.intent === undefined ? 'paypal' : raw.intent;
    if (intent !== 'paypal' && intent !== 'pass') throw badRequest('intent must be paypal or pass');
    return ok(reply, await s.proposals.accept(req.sessionId, proposalId, intent, s.passes?.passGate));
  });
  app.get<{ Params: { proposalId: string } }>('/api/proposals/:proposalId/receipt', async (req, reply) =>
    ok(reply, await s.purchases.viewReceipt(req.sessionId, requireUuid(req.params.proposalId, 'proposalId'))),
  );
  app.post<{ Params: { proposalId: string } }>('/api/proposals/:proposalId/decline', async (req, reply) =>
    ok(reply, await s.proposals.decline(req.sessionId, requireUuid(req.params.proposalId, 'proposalId'))),
  );
  app.post<{ Body: unknown }>('/api/purchases', async (req, reply) => {
    const body = (req.body ?? {}) as { proposalId?: unknown; confirmationToken?: unknown };
    if (body.proposalId === undefined) throw badRequest('proposalId is required');
    const proposalId = requireUuid(body.proposalId, 'proposalId');
    // Only proposalId and confirmationToken are read; any amount, price or currency field is ignored (3.7.4).
    return ok(reply, await s.purchases.start(req.sessionId, proposalId, body.confirmationToken), 201);
  });
  app.post<{ Params: { proposalId: string } }>('/api/pay/return/:proposalId', async (req, reply) =>
    ok(reply, await s.purchases.handleReturn(req.sessionId, requireUuid(req.params.proposalId, 'proposalId'))),
  );
  app.post<{ Params: { proposalId: string } }>('/api/pay/cancel/:proposalId', async (req, reply) =>
    ok(reply, await s.purchases.handleCancel(req.sessionId, requireUuid(req.params.proposalId, 'proposalId'))),
  );
}
