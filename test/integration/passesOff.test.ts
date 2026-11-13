// Nearby Passes off (NEAR_NETWORK unset; spec 3.6.8, 3.6.9 test 6; AC-REQ-14-06-01, NEG-14-06-01, AC-REQ-14-06-02):
// the app is Nearby as accepted. The existing suite, which runs with passes off, is the rest of the proof.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('passes off', () => {
  it('AC-REQ-14-06-01: GET /api/near/account says passes are off; picks carry no pass; My week counts none', async () => {
    const r = await t.request('GET', '/api/near/account');
    expect(r.json.data).toEqual({ passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null });
    await t.request('POST', '/api/calendar/demo-connection');
    const list = await t.request('GET', '/api/appointments/upcoming');
    const appt = list.json.data.appointments.find((a: { title: string }) => a.title === 'Client meeting');
    expect(appt.passCount).toBe(0);
    const picks = await t.request('GET', `/api/appointments/${appt.id}/picks`);
    expect(picks.json.data.picks.every((p: { pass: unknown; passClaim: unknown }) => p.pass === null && p.passClaim === null)).toBe(true);
    const acc = await t.request('POST', `/api/proposals/${picks.json.data.picks[0].proposalId}/accept`, { intent: 'pass' });
    expect(acc.status).toBe(409);
    const plain = await t.request('POST', `/api/proposals/${picks.json.data.picks[0].proposalId}/accept`);
    expect(plain.json.data).toMatchObject({ intent: 'paypal', passSheet: null });
    const reset = await t.request('POST', '/api/demo/reset');
    expect(reset.json.data).not.toHaveProperty('nearAccountId');
  });
  it('NEG-14-06-01: every other pass route answers 404 and nothing reaches NEAR', async () => {
    for (const [method, url] of [
      ['POST', '/api/passes/claim'], ['GET', '/api/passes/mine'], ['GET', '/api/passes/pass-1'], ['GET', '/api/near/agent'],
      ['GET', '/api/merchants/00000000-0000-4000-8000-000000000001/passes'],
      ['POST', '/api/merchants/00000000-0000-4000-8000-000000000001/offers/00000000-0000-4000-8000-000000000101/passes'],
      ['POST', '/api/merchants/00000000-0000-4000-8000-000000000001/passes/pass-1/redeem'],
      ['POST', '/api/merchants/00000000-0000-4000-8000-000000000001/passes/refund-expired'],
    ] as const) {
      const r = await t.request(method, url, method === 'POST' ? { proposalId: '00000000-0000-4000-8000-0000000000aa', confirmationToken: 'x', count: 1, cashBack: '0.1', expiry: '24h' } : undefined);
      expect([url, r.status]).toEqual([url, 404]);
    }
    expect((await t.app.inject({ method: 'GET', url: '/passes/pass-1.svg' })).statusCode).toBe(404);
  });
});
