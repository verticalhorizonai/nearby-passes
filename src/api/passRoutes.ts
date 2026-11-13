// Nearby Passes routes (api-contracts.md "Nearby Passes"; REQ-09-01 to REQ-13-02, REQ-14-06). With passes off
// (NEAR_NETWORK unset) GET /api/near/account says so and every other route here answers 404 (AC-REQ-14-06-01).
import type { FastifyInstance } from 'fastify';
import type { NearAccountResult } from '../shared/types.js';
import { notFound, ok, requireUuid, badRequest } from './http.js';
import type { PassService } from '../services/passes/passService.js';
import { passReference, passSvg } from '../services/passes/passImage.js';

const OFF: NearAccountResult = { passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null };

export function registerPassRoutes(app: FastifyInstance, passes: PassService | null, appBaseUrl: string): void {
  const on = () => {
    if (!passes) throw notFound('Passes are not set up on this server.');
    return passes;
  };
  app.get('/api/near/account', async (req, reply) => ok(reply, passes ? await passes.account(req.sessionId) : OFF));
  // F8.2 (Should): a NEAR testnet wallet account for this session; a POST, so the origin rule applies.
  app.post<{ Body: unknown }>('/api/near/account', async (req, reply) =>
    ok(reply, await on().setWallet(req.sessionId, ((req.body ?? {}) as { accountId?: unknown }).accountId)),
  );
  app.get('/api/near/agent', async (_req, reply) => ok(reply, await on().agentKeys()));
  app.post<{ Body: unknown }>('/api/passes/claim', async (req, reply) => {
    const s = on();
    const body = (req.body ?? {}) as { proposalId?: unknown; confirmationToken?: unknown };
    if (body.proposalId === undefined) throw badRequest('proposalId is required');
    // Only proposalId and confirmationToken are read; a receiver, merchant, offer or amount in the body is ignored (SEC-09-04-01).
    return ok(reply, await s.claim(req.sessionId, requireUuid(body.proposalId, 'proposalId'), body.confirmationToken), 201);
  });
  app.get('/api/passes/mine', async (req, reply) => ok(reply, await on().mine(req.sessionId)));
  app.get<{ Params: { tokenId: string } }>('/api/passes/:tokenId', async (req, reply) => ok(reply, await on().get(req.params.tokenId)));

  // The public image and reference metadata (3.4.5): no session, cacheable for ten seconds.
  app.get<{ Params: { file: string } }>('/passes/:file', async (req, reply) => {
    const m = /^(pass-\d+)\.(svg|json)$/.exec(req.params.file);
    const p = m && passes ? await passes.publicPass(m[1]).catch(() => null) : null;
    if (!m || !p || !passes) return reply.code(404).send({ success: false, error: { code: 'not_found', message: 'No pass has this number.' } });
    const [view] = await passes.toViews([p]);
    reply.header('Cache-Control', 'public, max-age=10');
    if (m[2] === 'svg') return reply.type('image/svg+xml').send(passSvg(p, view.merchantName));
    return reply.type('application/json').send(passReference(p, view.merchantName, `${appBaseUrl}/passes/${p.tokenId}.svg`));
  });

  app.get<{ Params: { merchantId: string } }>('/api/merchants/:merchantId/passes', async (req, reply) =>
    ok(reply, await on().merchantPasses(requireUuid(req.params.merchantId, 'merchantId'))),
  );
  app.get<{ Params: { merchantId: string } }>('/api/merchants/:merchantId/passes/activity', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return ok(reply, await on().activity(requireUuid(req.params.merchantId, 'merchantId')));
  });
  app.post<{ Params: { merchantId: string; offerId: string }; Body: unknown }>('/api/merchants/:merchantId/offers/:offerId/passes', async (req, reply) =>
    ok(reply, await on().fund(req.sessionId, requireUuid(req.params.merchantId, 'merchantId'), requireUuid(req.params.offerId, 'offerId'), req.body), 201),
  );
  app.post<{ Params: { merchantId: string } }>('/api/merchants/:merchantId/passes/refund-expired', async (req, reply) =>
    ok(reply, await on().refundExpired(req.sessionId, requireUuid(req.params.merchantId, 'merchantId'))),
  );
  app.post<{ Params: { merchantId: string; tokenId: string } }>('/api/merchants/:merchantId/passes/:tokenId/redeem', async (req, reply) =>
    ok(reply, await on().redeem(req.sessionId, requireUuid(req.params.merchantId, 'merchantId'), req.params.tokenId)),
  );
}
