// Nearby Passes upkeep (spec 3.6.6, F13.4; AC-REQ-14-04-01, AC-REQ-14-04-02, AC-REQ-14-02-02) against the fake, with
// the app's clock.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPassesApp, DOGWASH, NOODLE, RILLITO, SAGUARO } from '../helpers/passesApp.js';
import { PassUpkeep } from '../../src/services/passes/upkeep.js';
import { parseNear } from '../../src/services/near/format.js';

let t: Awaited<ReturnType<typeof createPassesApp>>;
let upkeep: PassUpkeep;
const lines: string[] = [];
const BASE = new Date('2026-11-16T15:00:00Z').getTime();
let n = 0;

beforeAll(async () => {
  t = await createPassesApp();
  upkeep = new PassUpkeep(t.db, t.fake, t.config, t.app.services.passes!, () => t.clock.now(), (l) => lines.push(l));
});
afterAll(async () => { await t.close(); });
beforeEach(async () => {
  n += 1;
  t.clock.set(new Date(BASE + n * 3_600_000));
  t.fake.passes.clear();
  t.fake.calls.length = 0;
  lines.length = 0;
  for (const x of [SAGUARO, NOODLE, RILLITO, DOGWASH]) t.fake.balances.set(x.account, 5n * 10n ** 24n);
  await t.db.query('DELETE FROM pass_actions');
});

describe('upkeep', () => {
  it('AC-REQ-14-04-02 / AC-REQ-14-02-02: tops each sample offer up to three with the values of 3.8; a second run mints nothing', async () => {
    t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1);
    const r = await upkeep.runOnce();
    expect(r.minted).toBe(2 + 3 + 3 + 3);
    const open = (acct: string, offer: string) => [...t.fake.passes.values()].filter((p) => p.merchantId === acct && p.offerId === offer && p.status === 'Open');
    for (const x of [SAGUARO, NOODLE, RILLITO, DOGWASH]) expect(open(x.account, x.offer)).toHaveLength(3);
    expect(open(RILLITO.account, RILLITO.offer).every((p) => p.valueYocto === parseNear('0.2').toString())).toBe(true);
    expect(open(NOODLE.account, NOODLE.offer).every((p) => p.valueYocto === parseNear('0.1').toString())).toBe(true);
    const minted = open(DOGWASH.account, DOGWASH.offer)[0];
    expect(minted.expiresAtMs).toBe(t.clock.now().getTime() + 48 * 3_600_000);
    expect(minted.title).toBe('Mesquite Dog Wash pass');
    const mintCall = t.fake.calls.find((c) => c[0] === 'mint_passes' && c[1] === RILLITO.account)!;
    expect(mintCall[2]).toMatchObject({ count: 3, depositYocto: 3n * (parseNear('0.2') + parseNear('0.03')) });
    expect((await t.db.query(`SELECT count(*)::int AS n FROM pass_actions WHERE action = 'fund' AND actor = 'upkeep'`)).rows[0].n).toBe(11);
    t.fake.calls.length = 0;
    expect((await upkeep.runOnce()).minted).toBe(0);
    expect(t.fake.calls.filter((c) => c[0] === 'mint_passes')).toEqual([]);
  });
  it('AC-REQ-14-04-01: refunds passes expired more than fifteen minutes ago, not those expired more recently', async () => {
    const [old] = t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1, '0.1', 60_000);
    t.clock.set(new Date(t.clock.now().getTime() + 10 * 60_000));
    const [recent] = t.fake.seedPasses(SAGUARO.account, SAGUARO.offer, 1, '0.1', 60_000);
    t.clock.set(new Date(t.clock.now().getTime() + 8 * 60_000)); // old expired 17 min ago, recent 7 min ago
    const r = await upkeep.runOnce();
    expect(r.refunded).toBe(1);
    expect(t.fake.passes.get(old)!.status).toBe('Refunded');
    expect(t.fake.passes.get(recent)!.status).toBe('Open');
    expect((await t.db.query(`SELECT actor FROM pass_actions WHERE action = 'refund'`)).rows).toEqual([{ actor: 'upkeep' }]);
  });
  it('AC-REQ-14-04-02: a merchant under the floor gets no top-up, and one log line says so', async () => {
    t.fake.balances.set(NOODLE.account, parseNear('0.9'));
    const r = await upkeep.runOnce();
    expect(t.fake.calls.filter((c) => c[0] === 'mint_passes' && c[1] === NOODLE.account)).toEqual([]);
    expect(lines.filter((l) => l.includes(NOODLE.account))).toEqual([`upkeep: ${NOODLE.account} holds 0.9 testnet NEAR, under the floor of 1 testnet NEAR; no top-up`]);
    expect(r.minted).toBe(9);
  });
  it('a NEAR failure is logged and does not stop the other merchants', async () => {
    t.fake.failNextCall('mint_passes', 'network');
    const r = await upkeep.runOnce();
    expect(r.errors).toHaveLength(1);
    expect(r.minted).toBe(9);
  });
});
