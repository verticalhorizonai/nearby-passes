// Nearby Passes, the server against the NEAR adapter's fake (spec 3.6.9 tests 1 to 5, 7; REQ-09-01 to REQ-14-03).
// The fake keeps the contract's rules, so every refusal the contract makes is met here too. No live service.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPassesApp, AGENT, CONTRACT, NOODLE, SAGUARO, SONORAN } from '../helpers/passesApp.js';
import { demoAccountId } from '../../src/services/near/demoAccount.js';
import { parseNear } from '../../src/services/near/format.js';

let t: Awaited<ReturnType<typeof createPassesApp>>;
// Each test runs in two fresh browser sessions (the in-process limits are per session) and at its own time, 20 s
// after the last, so the 10-second view cache never carries a pass from one test into the next.
let n = 0;
let S = 's0';
let S2 = 's0b';
let start = new Date('2026-11-16T15:00:00Z');
const BASE = new Date('2026-11-16T15:00:00Z').getTime();
const req = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, session = S) => t.request(method, url, body, {}, session);

beforeAll(async () => {
  t = await createPassesApp();
});
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  n += 1;
  S = `s${n}`;
  S2 = `s${n}b`;
  start = new Date(BASE + n * 20_000);
  t.clock.set(start);
  for (const s of [S, S2]) await req('POST', '/api/calendar/demo-connection', undefined, s);
  await t.db.query('DELETE FROM pass_claims');
  await t.db.query('DELETE FROM pass_actions');
  await t.db.query('DELETE FROM purchases');
  await t.db.query('DELETE FROM proposals');
  await t.db.query('DELETE FROM near_accounts');
  t.fake.passes.clear();
  t.fake.calls.length = 0;
  t.fake.cfg.claimsPaused = false;
  t.fake.balances.set(AGENT, 4n * 10n ** 24n);
});

const sessionIdOf = (s: string) => t.cookieJar[s];
async function idsFor(title: string, session = S) {
  const list = await req('GET', '/api/appointments/upcoming', undefined, session);
  return Object.fromEntries(list.json.data.appointments.map((a: { title: string; id: string }) => [a.title, a.id]))[title] as string;
}
const picksFor = async (title: string, session = S) => (await req('GET', `/api/appointments/${await idsFor(title, session)}/picks`, undefined, session)).json.data;
async function acceptPass(session = S) {
  const picks = await picksFor('Client meeting', session);
  const proposalId = picks.picks[0].proposalId as string;
  const acc = await req('POST', `/api/proposals/${proposalId}/accept`, { intent: 'pass' }, session);
  return { proposalId, acc, token: acc.json?.data?.confirmationToken as string };
}

describe('REQ-09-01, REQ-09-06: the session’s NEAR account', () => {
  it('AC-REQ-09-01-01 / AC-REQ-09-06-01: GET /api/near/account derives the demo account from the session, with its explorer link', async () => {
    const r = await req('GET', '/api/near/account');
    expect(r.json.data).toMatchObject({ passesEnabled: true, claimsAvailable: true, network: 'testnet', source: 'demo' });
    const expected = demoAccountId(t.config.demoAccountSecret, sessionIdOf(S), 0);
    expect(r.json.data.accountId).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.data.explorerUrl).toBe(`https://testnet.near.rocks/account/${expected}`);
    const again = await req('GET', '/api/near/account');
    expect(again.json.data.accountId).toBe(expected);
    const other = await req('GET', '/api/near/account', undefined, S2);
    expect(other.json.data.accountId).not.toBe(expected);
  });
  it('AC-REQ-09-01-02: nothing is signed or created on chain to have an account', async () => {
    await req('GET', '/api/near/account');
    expect(t.fake.calls).toEqual([]);
  });
  it('AC-REQ-09-06-02: Reset demo moves the session to its next account; the claimed pass stays with the earlier one; PayPal reset unchanged', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    const first = (await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token })).json.data;
    const before = (await req('GET', '/api/near/account')).json.data.accountId;
    const reset = await req('POST', '/api/demo/reset');
    expect(reset.status).toBe(200);
    expect(reset.json.data).toMatchObject({ proposalsRemoved: 2, purchasesRemoved: 0, nearAccountId: demoAccountId(t.config.demoAccountSecret, sessionIdOf(S), 1) });
    const after = (await req('GET', '/api/near/account')).json.data.accountId;
    expect(after).not.toBe(before);
    expect((await t.fake.getPass(first.pass.tokenId))!.ownerId).toBe(before);
    expect((await t.db.query('SELECT count(*)::int AS n FROM pass_claims')).rows[0].n).toBe(0);
    // The new account can claim the same offer's pass again (one claim per account per offer, not per session).
    const again = await acceptPass();
    expect((await req('POST', '/api/passes/claim', { proposalId: again.proposalId, confirmationToken: again.token })).status).toBe(201);
  });
});

describe('REQ-09-03: pass facts on picks (spec 3.6.9 test 3)', () => {
  it('AC-REQ-09-03-01: a pick whose offer has open passes from the known account carries them', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3, '0.1');
    const d = await picksFor('Client meeting');
    expect(d.picks[0].offerId).toBe(SAGUARO.offer);
    expect(d.picks[0].pass).toMatchObject({ openCount: 3, cashBackText: '0.1 testnet NEAR', cashBackYocto: parseNear('0.1').toString() });
    expect(d.picks[1].pass).toBeNull(); // Sonoran Print Shop has no NEAR account
  });
  it('AC-REQ-09-03-02: no open pass (or none unexpired) gives null', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1, '0.1', 60_000);
    t.clock.set(new Date(t.clock.now().getTime() + 120_000));
    const d = await picksFor('Client meeting');
    expect(d.picks[0].pass).toBeNull();
    t.clock.set(start);
  });
  it('NEG-09-03-01: a stranger’s passes minted for a sample offer id are never counted or claimed', async () => {
    t.fake.seedPasses('stranger.testnet', SAGUARO.offer, 3);
    const d = await picksFor('Client meeting');
    expect(d.picks[0].pass).toBeNull();
    const acc = await req('POST', `/api/proposals/${d.picks[0].proposalId}/accept`, { intent: 'pass' });
    expect(acc.status).toBe(409);
    expect(acc.json.error.code).toBe('pass_unavailable');
    // With the merchant's own pass present too, the claim asks for the known merchant's pass only.
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    const ok = await req('POST', `/api/proposals/${d.picks[0].proposalId}/accept`, { intent: 'pass' });
    const c = await req('POST', '/api/passes/claim', { proposalId: d.picks[0].proposalId, confirmationToken: ok.json.data.confirmationToken });
    expect(c.status).toBe(201);
    expect(c.json.data.pass.merchantAccountId).toBe(SAGUARO.account);
    expect(t.fake.calls.find((x) => x[0] === 'claim_pass')![2]).toMatchObject({ merchant: SAGUARO.account });
  });
});

describe('REQ-09-04, REQ-09-07: the yes and the claim (spec 3.6.9 tests 1 and 2)', () => {
  it('AC-REQ-09-04-01 / AC-REQ-09-07-01: accept with intent pass returns the pass sheet and stores the intent', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2, '0.1');
    const { proposalId, acc } = await acceptPass();
    expect(acc.status).toBe(200);
    const account = (await req('GET', '/api/near/account')).json.data.accountId;
    expect(acc.json.data).toMatchObject({ intent: 'pass', passSheet: { merchantName: 'Saguaro Bean Co.', merchantIsSample: true, cashBackText: '0.1 testnet NEAR', receivingAccountId: account, agentSentence: "Nearby's agent claims it for you. It cannot move money." } });
    expect((await t.db.query('SELECT accept_intent FROM proposals WHERE id = $1', [proposalId])).rows[0].accept_intent).toBe('pass');
    const bad = await req('POST', `/api/proposals/${proposalId}/accept`, { intent: 'card' });
    expect(bad.status).toBe(400);
    const plain = await req('POST', `/api/proposals/${proposalId}/accept`);
    expect(plain.json.data).toMatchObject({ intent: 'paypal', passSheet: null });
  });
  it('AC-REQ-09-04-02: Yes, claim it claims the oldest open pass into the session’s account, signed by the agent, and records it', async () => {
    const [p1] = t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    const r = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(r.status).toBe(201);
    const account = (await req('GET', '/api/near/account')).json.data.accountId;
    expect(r.json.data.pass).toMatchObject({ tokenId: p1, status: 'Claimed', ownerId: account, merchantId: SAGUARO.id, merchantName: 'Saguaro Bean Co.' });
    expect(r.json.data.txUrl).toBe(`https://testnet.near.rocks/tx/${r.json.data.txHash}`);
    expect(t.fake.calls.filter((c) => c[0] === 'claim_pass')).toEqual([['claim_pass', AGENT, { merchant: SAGUARO.account, offerId: SAGUARO.offer, receiver: account }]]);
    const row = (await t.db.query('SELECT status, token_id, claim_tx FROM pass_claims WHERE proposal_id = $1', [proposalId])).rows[0];
    expect(row).toEqual({ status: 'claimed', token_id: p1, claim_tx: r.json.data.txHash });
  });
  it('SEC-09-04-01: the receiver, merchant, offer and amount come from the server, never the body', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    t.fake.seedPasses(NOODLE.account, NOODLE.offer, 1);
    const { proposalId, token } = await acceptPass();
    const r = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token, receiverId: 'attacker.testnet', merchantId: NOODLE.account, offerId: NOODLE.offer, value: '9000000000000000000000000', deposit: '1' });
    expect(r.status).toBe(201);
    const account = (await req('GET', '/api/near/account')).json.data.accountId;
    expect(t.fake.calls.find((c) => c[0] === 'claim_pass')![2]).toEqual({ merchant: SAGUARO.account, offerId: SAGUARO.offer, receiver: account });
  });
  it('NEG-09-07-01: a pass token never pays and a PayPal token never claims', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    const { proposalId, token } = await acceptPass();
    const pay = await req('POST', '/api/purchases', { proposalId, confirmationToken: token });
    expect(pay.status).toBe(403);
    expect(pay.json.error.code).toBe('confirmation_token_invalid');
    expect(t.paypalTransport.calls.filter((c: { url: string }) => c.url.includes('/v2/checkout/orders')).length).toBe(0);
    const acc = await req('POST', `/api/proposals/${proposalId}/accept`); // paypal
    const claim = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: acc.json.data.confirmationToken });
    expect(claim.status).toBe(403);
    expect(claim.json.error.code).toBe('confirmation_token_invalid');
    expect(t.fake.calls.filter((c) => c[0] === 'claim_pass')).toEqual([]);
  });
  it('NEG-09-07-02: a used or expired token is refused and nothing is called', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3);
    const { proposalId, token } = await acceptPass();
    expect((await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token })).status).toBe(201);
    const used = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(used.status).toBe(403);
    await t.db.query('DELETE FROM pass_claims');
    await t.db.query('DELETE FROM proposals');
    const second = await acceptPass();
    t.clock.set(new Date(t.clock.now().getTime() + 11 * 60_000));
    const expired = await req('POST', '/api/passes/claim', { proposalId: second.proposalId, confirmationToken: second.token });
    expect(expired.status).toBe(403);
    expect(t.fake.calls.filter((c) => c[0] === 'claim_pass').length).toBe(1);
    t.clock.set(start);
  });
  it('NEG-09-07-03: a pick is settled one way', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3);
    const { proposalId, token } = await acceptPass();
    await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    for (const body of [undefined, { intent: 'pass' }]) {
      const r = await req('POST', `/api/proposals/${proposalId}/accept`, body);
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe('pass_unavailable');
    }
    const d = await picksFor('Client meeting');
    const claimed = d.picks.find((p: { proposalId: string }) => p.proposalId === proposalId);
    expect(claimed.passClaim).toMatchObject({ status: 'claimed' });
    expect(claimed.pass).toBeNull();
  });
  it('NEG-09-07-03: a pick bought with PayPal cannot be claimed', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3);
    const d = await picksFor('Client meeting');
    const proposalId = d.picks[0].proposalId;
    await t.db.query(`INSERT INTO purchases (proposal_id, offer_id, merchant_id, amount_cents, paypal_order_id, status, redemption_code, completed_at)
      VALUES ($1, $2, $3, 600, 'ORDER-X', 'completed', 'ABCDEF', now())`, [proposalId, SAGUARO.offer, SAGUARO.id]);
    const r = await req('POST', `/api/proposals/${proposalId}/accept`, { intent: 'pass' });
    expect(r.status).toBe(409);
  });
  it('NEG-09-07-04: a chain call that fails before sending releases the token; the same token works again', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    t.fake.failNextCall('claim_pass', 'network');
    const r = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('near_unavailable');
    const row = (await t.db.query('SELECT status, error FROM pass_claims WHERE proposal_id = $1', [proposalId])).rows[0];
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/Nothing was claimed/);
    const retry = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(retry.status).toBe(201);
  });
  it('NEG-09-07-05: an unknown outcome is checked by its hash; one yes never claims two passes', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3);
    const { proposalId, token } = await acceptPass();
    t.fake.failNextCall('claim_pass', 'timeout-sent'); // sent and executed, but the answer did not come back
    const r = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(r.status).toBe(503);
    const row = (await t.db.query('SELECT status, claim_tx FROM pass_claims WHERE proposal_id = $1', [proposalId])).rows[0];
    expect(row.status).toBe('pending');
    expect(row.claim_tx).toBeTruthy();
    const retry = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(retry.status).toBe(201);
    expect(retry.json.data.txHash).toBe(row.claim_tx);
    expect(t.fake.calls.filter((c) => c[0] === 'claim_pass').length).toBe(1);
    expect([...t.fake.passes.values()].filter((p) => p.status === 'Claimed').length).toBe(1);
  });
  it('NEG-09-07-06: a contract refusal fails the claim with a plain message and releases the token', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    const { proposalId, token } = await acceptPass();
    t.fake.cfg.claimsPaused = true; // the contract refuses (and claiming became unavailable after the sheet opened)
    const r = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ code: 'pass_unavailable', message: 'Claiming is paused right now.' });
    expect((await t.db.query('SELECT confirm_token_used_at FROM proposals WHERE id = $1', [proposalId])).rows[0].confirm_token_used_at).toBeNull();
  });
  it('AC-REQ-13-01-03: a second visitor claims the same offer’s pass after the first', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3);
    const a = await acceptPass(S);
    expect((await req('POST', '/api/passes/claim', { proposalId: a.proposalId, confirmationToken: a.token }, S)).status).toBe(201);
    const b = await acceptPass(S2);
    const rb = await req('POST', '/api/passes/claim', { proposalId: b.proposalId, confirmationToken: b.token }, S2);
    expect(rb.status).toBe(201);
    expect(rb.json.data.pass.ownerId).toBe((await req('GET', '/api/near/account', undefined, S2)).json.data.accountId);
  });
});

describe('REQ-09-05, REQ-10-01 to REQ-10-03: claimed picks and My passes', () => {
  it('AC-REQ-09-05-02: My week counts the stop’s passes', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    const list = await req('GET', '/api/appointments/upcoming');
    const appt = list.json.data.appointments.find((a: { title: string }) => a.title === 'Client meeting');
    expect(appt.passCount).toBe(1);
    expect(list.json.data.appointments.find((a: { title: string }) => a.title === 'Workshop').passCount).toBe(0);
  });
  it('AC-REQ-10-01-01 / AC-REQ-10-01-02 / AC-REQ-10-03-01: My passes reads the contract; a redeem shows Redeemed with its link', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    const { proposalId, token } = await acceptPass();
    const claim = (await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token })).json.data;
    const mine = await req('GET', '/api/passes/mine');
    expect(mine.json.data.passes).toHaveLength(1);
    expect(mine.json.data.passes[0]).toMatchObject({ tokenId: claim.pass.tokenId, status: 'Claimed', merchantName: 'Saguaro Bean Co.', merchantIsSample: true, valueText: '0.1 testnet NEAR', mediaUrl: `http://localhost:3000/passes/${claim.pass.tokenId}.svg`, lastTxUrl: claim.txUrl });
    const red = await req('POST', `/api/merchants/${SAGUARO.id}/passes/${claim.pass.tokenId}/redeem`);
    expect(red.status).toBe(200);
    t.clock.set(new Date(t.clock.now().getTime() + 11_000)); // past the view cache
    const after = await req('GET', '/api/passes/mine');
    expect(after.json.data.passes[0]).toMatchObject({ status: 'Redeemed', lastTxUrl: red.json.data.txUrl });
    expect((await t.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN ('pass_claims','pass_actions','near_accounts') AND column_name ILIKE '%status%'`)).rows.map((r: { column_name: string }) => r.column_name)).toEqual(['status']); // pass_claims.status is the claim's, not the pass's
    t.clock.set(start);
  });
  it('GET /api/passes/{tokenId} accepts pass-N or N, refuses anything else, 404 for an unknown pass', async () => {
    const [id] = t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    expect((await req('GET', `/api/passes/${id}`)).json.data.tokenId).toBe(id);
    expect((await req('GET', `/api/passes/${id.slice(5)}`)).json.data.tokenId).toBe(id);
    expect((await req('GET', '/api/passes/pass-x')).status).toBe(400);
    expect((await req('GET', '/api/passes/pass-999')).status).toBe(404);
  });
});

describe('REQ-11, REQ-12: the merchant (spec 3.6.9 test 4)', () => {
  it('AC-REQ-11-01-01 / AC-REQ-11-03-01: the NEAR panel, counts per seeded offer and the balance held', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3, '0.1');
    const r = await req('GET', `/api/merchants/${SAGUARO.id}/passes`);
    expect(r.json.data).toMatchObject({ nearEnabled: true, accountId: SAGUARO.account, explorerUrl: `https://testnet.near.rocks/account/${SAGUARO.account}`, heldText: '0.3 testnet NEAR' });
    expect(r.json.data.offers).toEqual([expect.objectContaining({ offerId: SAGUARO.offer, open: 3, claimed: 0, redeemed: 0, refunded: 0 })]);
  });
  it('AC-REQ-11-01-02: a merchant with no NEAR account says passes are set up for four', async () => {
    const r = await req('GET', `/api/merchants/${SONORAN.id}/passes`);
    expect(r.json.data).toMatchObject({ nearEnabled: false, notice: 'Passes are set up for four sample merchants in this demo.' });
  });
  it('AC-REQ-11-02-02: Fund mints as the merchant with the deposit computed on the server', async () => {
    const r = await req('POST', `/api/merchants/${SAGUARO.id}/offers/${SAGUARO.offer}/passes`, { count: 2, cashBack: '0.25', expiry: '24h', value: '1', deposit: '1' });
    expect(r.status).toBe(201);
    const call = t.fake.calls.find((c) => c[0] === 'mint_passes')!;
    expect(call[1]).toBe(SAGUARO.account);
    expect(call[2]).toMatchObject({ offerId: SAGUARO.offer, count: 2, valueYocto: parseNear('0.25'), depositYocto: 2n * (parseNear('0.25') + parseNear('0.03')) });
    expect(r.json.data.passes.map((p: { status: string }) => p.status)).toEqual(['Open', 'Open']);
    expect(r.json.data.depositText).toBe('0.56 testnet NEAR');
  });
  it('NEG-11-02-01: values outside the options are refused and nothing is signed', async () => {
    for (const body of [{ count: 0, cashBack: '0.1', expiry: '24h' }, { count: 6, cashBack: '0.1', expiry: '24h' }, { count: 1, cashBack: '0.2', expiry: '24h' }, { count: 1, cashBack: '0.1', expiry: '1h' }, { count: '2', cashBack: '0.1', expiry: '24h' }]) {
      const r = await req('POST', `/api/merchants/${SAGUARO.id}/offers/${SAGUARO.offer}/passes`, body);
      expect(r.status).toBe(400);
    }
    expect(t.fake.calls).toEqual([]);
  });
  it('NEG-11-02-02: a visitor’s own offer, or a merchant with no NEAR account, is refused', async () => {
    const posted = await req('POST', `/api/merchants/${SAGUARO.id}/offers`, { title: 'My own deal', priceCents: 500, category: 'coffee', validDays: ['mon'], validStartTime: '07:00', validEndTime: '09:00' });
    expect(posted.json.error?.details ?? null).toBeNull();
    expect(posted.status).toBe(201);
    const own = await req('POST', `/api/merchants/${SAGUARO.id}/offers/${posted.json.data.id}/passes`, { count: 1, cashBack: '0.1', expiry: '24h' });
    expect(own.status).toBe(400);
    const none = await req('POST', `/api/merchants/${SONORAN.id}/offers/${SONORAN.offer}/passes`, { count: 1, cashBack: '0.1', expiry: '24h' });
    expect(none.status).toBe(400);
    expect((await req('POST', `/api/merchants/${SAGUARO.id}/offers/00000000-0000-4000-8000-000000000999/passes`, { count: 1, cashBack: '0.1', expiry: '24h' })).status).toBe(404);
    expect(t.fake.calls).toEqual([]);
  });
  it('AC-REQ-12-01-02 / NEG-12-01-01 / NEG-12-01-02: redeem by the merchant only, Claimed and unexpired only', async () => {
    const seeded = t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    const claimed = (await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token })).json.data.pass.tokenId;
    const open = seeded.find((id) => id !== claimed)!;
    const other = await req('POST', `/api/merchants/${NOODLE.id}/passes/${claimed}/redeem`);
    expect(other.status).toBe(400);
    expect(other.json.error.message).toBe('This pass belongs to another merchant.');
    const stillOpen = await req('POST', `/api/merchants/${SAGUARO.id}/passes/${open}/redeem`);
    expect(stillOpen.status).toBe(409);
    const ok = await req('POST', `/api/merchants/${SAGUARO.id}/passes/${claimed.slice(5)}/redeem`);
    expect(ok.status).toBe(200);
    expect(ok.json.data.message).toBe('Redeemed. 0.1 testnet NEAR sent to the holder.');
    const twice = await req('POST', `/api/merchants/${SAGUARO.id}/passes/${claimed}/redeem`);
    expect(twice.status).toBe(409);
    expect(t.fake.calls.filter((c) => c[0] === 'redeem_pass')).toEqual([['redeem_pass', SAGUARO.account, { tokenId: claimed }]]);
  });
  it('AC-REQ-12-02-01 / NEG-12-02-01: refund expired, at most ten per call; nothing to refund signs nothing', async () => {
    const none = await req('POST', `/api/merchants/${SAGUARO.id}/passes/refund-expired`);
    expect(none.json.data.refunded).toEqual([]);
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 12, '0.05', 60_000);
    t.clock.set(new Date(t.clock.now().getTime() + 61_000));
    const view = await req('GET', `/api/merchants/${SAGUARO.id}/passes`);
    expect(view.json.data.passes.every((p: { expired: boolean }) => p.expired)).toBe(true);
    const r = await req('POST', `/api/merchants/${SAGUARO.id}/passes/refund-expired`);
    expect(r.json.data.refunded).toHaveLength(10);
    expect(r.json.data.refunded[0].txUrl).toMatch(/^https:\/\/testnet\.near\.rocks\/tx\//);
    expect((await t.db.query(`SELECT count(*)::int AS n FROM pass_actions WHERE action = 'refund'`)).rows[0].n).toBe(10);
    t.clock.set(start);
  });
});

describe('REQ-14-03: guardrails', () => {
  it('AC-REQ-14-03-01: paused, or the agent low, hides the pass on every pick and says why', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3);
    t.fake.cfg.claimsPaused = true;
    t.clock.set(new Date(t.clock.now().getTime() + 11_000));
    expect((await picksFor('Client meeting')).picks[0].pass).toBeNull();
    expect((await req('GET', '/api/near/account')).json.data).toMatchObject({ claimsAvailable: false, unavailableReason: 'Claiming is paused on the contract right now.' });
    t.fake.cfg.claimsPaused = false;
    t.fake.balances.set(AGENT, parseNear('0.4'));
    t.clock.set(new Date(t.clock.now().getTime() + 11_000));
    expect((await picksFor('Client meeting')).picks[0].pass).toBeNull();
    expect((await req('GET', '/api/near/account')).json.data.claimsAvailable).toBe(false);
    t.clock.set(start);
  });
  it('NEG-14-03-02: five claims per session per hour', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await req('POST', '/api/passes/claim', { proposalId: '00000000-0000-4000-8000-00000000abcd', confirmationToken: 'x' }, S)).status;
    expect(last).toBe(429);
  });
});

describe('REQ-13-02: the agent’s limits, in public', () => {
  it('AC-REQ-13-02-01: GET /api/near/agent lists the agent’s keys as the network reports them', async () => {
    const r = await req('GET', '/api/near/agent');
    expect(r.json.data).toMatchObject({ accountId: AGENT, contractId: CONTRACT, claimsPaused: false, contractSourceUrl: null, explorerUrl: `https://testnet.near.rocks/account/${AGENT}` });
    expect(r.json.data.keys).toEqual([expect.objectContaining({ kind: 'function_call', receiverId: CONTRACT, methodNames: ['claim_pass'], allowanceText: '3 testnet NEAR' })]);
  });
});

describe('REQ-10-05: the public image and reference (spec 3.6.9 test 8)', () => {
  it('AC-REQ-10-05-01 / AC-REQ-10-05-02: /passes/{id}.svg and .json follow the status, with no session, cacheable ten seconds', async () => {
    const [id] = t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    const svg = await t.app.inject({ method: 'GET', url: `/passes/${id}.svg` });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svg.headers['cache-control']).toBe('public, max-age=10');
    expect(svg.headers['set-cookie']).toBeUndefined();
    expect(svg.body).toContain('>Open<');
    expect(svg.body).toContain('Saguaro Bean Co.');
    const json = await t.app.inject({ method: 'GET', url: `/passes/${id}.json` });
    expect(JSON.parse(json.body)).toMatchObject({ token_id: id, status: 'Open', merchant_name: 'Saguaro Bean Co.', image: `http://localhost:3000/passes/${id}.svg` });
  });
  it('NEG-10-05-01: a malformed or unknown id is 404, and a malformed one asks the chain nothing', async () => {
    let views = 0;
    const real = t.fake.getPass.bind(t.fake);
    t.fake.getPass = async (x: string) => { views += 1; return real(x); };
    for (const url of ['/passes/evil.svg', '/passes/pass-1.png', '/passes/pass-.json', '/passes/..%2Fsecret.svg']) expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect(views).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: '/passes/pass-424242.svg' })).statusCode).toBe(404);
    t.fake.getPass = real;
  });
  it('SEC-09-06-01: no response carries the demo account’s seed or key', async () => {
    const r = await req('GET', '/api/near/account');
    const seed = (await import('../../src/services/near/demoAccount.js')).demoSeed(t.config.demoAccountSecret, sessionIdOf(S), 0).toString('hex');
    expect(r.res.body).not.toContain(seed);
    expect(r.res.body).not.toMatch(/ed25519:/);
    expect(r.res.body).not.toContain(t.config.demoAccountSecret.toString('hex'));
  });
});

describe('ruling 54(a): a pending claim is settled when the picks are read', () => {
  it('an unknown outcome that succeeded shows as claimed on the next read, with no second claim sent', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    t.fake.failNextCall('claim_pass', 'timeout-sent');
    expect((await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token })).status).toBe(503);
    const d = await picksFor('Client meeting');
    const p = d.picks.find((x: { proposalId: string }) => x.proposalId === proposalId);
    expect(p.passClaim).toMatchObject({ status: 'claimed' });
    expect(p.acceptIntent).toBe('pass');
    expect(t.fake.calls.filter((c) => c[0] === 'claim_pass').length).toBe(1);
  });
  it('a pending claim with no hash, older than twice the call timeout, fails so the pick can be tried again', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const d0 = await picksFor('Client meeting');
    const proposalId = d0.picks[0].proposalId;
    await t.db.query(`INSERT INTO pass_claims (proposal_id, session_id, offer_id, merchant_id, account_id, status, updated_at) VALUES ($1, 'x', $2, $3, 'a', 'pending', $4)`,
      [proposalId, SAGUARO.offer, SAGUARO.id, new Date(start.getTime() - 60_000)]);
    const d = await picksFor('Client meeting');
    expect(d.picks.find((x: { proposalId: string }) => x.proposalId === proposalId).passClaim).toMatchObject({ status: 'failed', error: 'The NEAR testnet did not answer. Nothing was claimed. Try again.' });
    expect((await req('POST', `/api/proposals/${proposalId}/accept`, { intent: 'pass' })).status).toBe(200);
  });
});

describe('REQ-10-04 (Should): passes for any agent over MCP', () => {
  const OLD_MAIN = { lat: 32.2318, lng: -110.9535 };
  const TUE_0930 = '2026-11-17T09:30:00-07:00';
  it('AC-REQ-10-04-01: find_offers_near and get_offer carry the pass; the checkout link lands where it can be claimed with the same yes', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 3, '0.1');
    const near = await t.app.services.offerSearch.findNear({ lat: OLD_MAIN.lat, lng: OLD_MAIN.lng, starts_at: TUE_0930 }) as { offers: { offer_id: string; pass: unknown }[] };
    const saguaro = near.offers.find((o) => o.offer_id === SAGUARO.offer)!;
    expect(saguaro.pass).toEqual({ open_count: 3, cash_back: '0.1 testnet NEAR' });
    expect(near.offers.find((o) => o.offer_id !== SAGUARO.offer)?.pass ?? null).toBeNull();
    const one = await t.app.services.offerSearch.getOffer({ offer_id: SAGUARO.offer }) as { offer: { pass: unknown } };
    expect(one.offer.pass).toEqual({ open_count: 3, cash_back: '0.1 testnet NEAR' });
    // The checkout link opens the handoff; its pick carries the pass and is claimed with the one yes.
    const h = await req('POST', '/api/handoff', { offer: SAGUARO.offer, lat: String(OLD_MAIN.lat), lng: String(OLD_MAIN.lng), at: TUE_0930 });
    expect(h.status).toBe(201);
    const picks = (await req('GET', `/api/appointments/${h.json.data.appointmentId}/picks`)).json.data;
    expect(picks.picks[0].pass).toMatchObject({ openCount: 3 });
    const acc = await req('POST', `/api/proposals/${h.json.data.proposalId}/accept`, { intent: 'pass' });
    const claim = await req('POST', '/api/passes/claim', { proposalId: h.json.data.proposalId, confirmationToken: acc.json.data.confirmationToken });
    expect(claim.status).toBe(201);
  });
});

describe('REQ-12-03 (Should): pass activity', () => {
  it('AC-REQ-12-03-01: GET .../passes/activity lists the claim and the redemption, newest first, with links', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const { proposalId, token } = await acceptPass();
    const claimed = (await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token })).json.data;
    t.clock.set(new Date(start.getTime() + 2_000));
    await req('POST', `/api/merchants/${SAGUARO.id}/passes/${claimed.pass.tokenId}/redeem`);
    const a = await req('GET', `/api/merchants/${SAGUARO.id}/passes/activity`);
    expect(a.json.data.items.slice(0, 2).map((i: { kind: string; tokenId: string }) => `${i.kind} ${i.tokenId}`)).toEqual([`redeem ${claimed.pass.tokenId}`, `claim ${claimed.pass.tokenId}`]);
    expect(a.json.data.items[1].txUrl).toBe(claimed.txUrl);
    expect((await req('GET', `/api/merchants/${SONORAN.id}/passes/activity`)).json.data.items).toEqual([]);
    t.clock.set(start);
  });
});

describe('REQ-09-02 (Should): connect a wallet', () => {
  it('AC-REQ-09-02-01: a testnet wallet account that exists becomes the session’s; later claims go to it', async () => {
    t.fake.balances.set('alice.testnet', 10n ** 24n);
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 2);
    const r = await req('POST', '/api/near/account', { accountId: 'alice.testnet' });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ accountId: 'alice.testnet', source: 'wallet', explorerUrl: 'https://testnet.near.rocks/account/alice.testnet' });
    const { proposalId, token } = await acceptPass();
    const c = await req('POST', '/api/passes/claim', { proposalId, confirmationToken: token });
    expect(c.json.data.pass.ownerId).toBe('alice.testnet');
    expect(t.fake.calls.filter((x) => x[0] === 'claim_pass').every((x) => (x[2] as { receiver: string }).receiver === 'alice.testnet')).toBe(true);
  });
  it('NEG-09-02-01: an account that is not a testnet id, or does not exist, is refused and the session keeps its account', async () => {
    const before = (await req('GET', '/api/near/account')).json.data.accountId;
    for (const accountId of ['alice.near', 'Alice.testnet', 'x', 'nobody-here.testnet', 'f'.repeat(63)]) {
      const r = await req('POST', '/api/near/account', { accountId });
      expect([accountId, r.status]).toEqual([accountId, 400]);
    }
    expect((await req('GET', '/api/near/account')).json.data.accountId).toBe(before);
    const cross = await t.request('POST', '/api/near/account', { accountId: 'alice.testnet' }, { origin: 'https://evil.example' }, S);
    expect(cross.status).toBe(403);
  });
});
