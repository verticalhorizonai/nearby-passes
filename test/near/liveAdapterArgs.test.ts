// The live adapter's JSON arguments match the contract's (REQ-14-05). A live run found `from_index` sent as a string
// to views that take a u32; the fake cannot see JSON types, so this pins every argument's shape. The contract's own
// test `mint_passes_args_deserialize_from_the_servers_json` checks the mint shape from the other side.
import { describe, expect, it } from 'vitest';
import { LiveNearAdapter } from '../../src/services/near/liveNearAdapter.js';
import { nearTestConfig } from '../helpers/passesApp.js';
import { parseNear } from '../../src/services/near/format.js';

class Spy extends LiveNearAdapter {
  readonly views: [string, Record<string, unknown>][] = [];
  readonly sent: [string, string, Record<string, unknown>, bigint, bigint][] = [];
  constructor() { super(nearTestConfig()); }
}
function spy() {
  const s = new Spy() as Spy & Record<string, unknown>;
  s.view = async (m: string, a: Record<string, unknown>) => { s.views.push([m, a]); return m === 'offer_stats' ? {} : []; };
  s.call = async (signer: string, _key: string, m: string, a: Record<string, unknown>, deposit: bigint, gas: bigint) => { s.sent.push([signer, m, a, deposit, gas]); return { hash: 'h', value: null }; };
  return s;
}

describe('the live adapter sends the contract’s argument types', () => {
  it('list views take from_index and limit as numbers (u32)', async () => {
    const s = spy();
    await s.passesForOwner('a.testnet', 0, 50);
    await s.passesForMerchant('m.testnet', 3, 100);
    await s.offerStats('m.testnet', 'o');
    expect(s.views).toEqual([
      ['passes_for_owner', { account_id: 'a.testnet', from_index: 0, limit: 50 }],
      ['passes_for_merchant', { merchant_id: 'm.testnet', from_index: 3, limit: 100 }],
      ['offer_stats', { merchant_id: 'm.testnet', offer_id: 'o' }],
    ]);
  });
  it('calls: amounts as yocto strings, times and counts as numbers, 1 yocto and 50 TGas on redeem, no deposit on claim', async () => {
    const s = spy();
    const cfg = nearTestConfig();
    const m = Object.values(cfg.merchantAccounts)[0];
    await s.mintPasses(m, { offerId: 'o', title: 't', description: 'd', valueYocto: parseNear('0.1'), expiresAtMs: 1794528000000, count: 3, depositYocto: parseNear('0.39') });
    await s.claimPass(m, 'o', 'r.testnet');
    await s.redeemPass(m, 'pass-1');
    await s.refundExpired(m, 'pass-2');
    expect(s.sent[0]).toEqual([m, 'mint_passes', { offer_id: 'o', title: 't', description: 'd', value: '100000000000000000000000', expires_at_ms: 1794528000000, count: 3 }, parseNear('0.39'), 200_000_000_000_000n]);
    expect(s.sent[1]).toEqual([cfg.agentAccountId, 'claim_pass', { merchant_id: m, offer_id: 'o', receiver_id: 'r.testnet' }, 0n, 100_000_000_000_000n]);
    expect(s.sent[2]).toEqual([m, 'redeem_pass', { token_id: 'pass-1' }, 1n, 50_000_000_000_000n]);
    expect(s.sent[3]).toEqual([m, 'refund_expired', { token_id: 'pass-2' }, 0n, 50_000_000_000_000n]);
  });
});
