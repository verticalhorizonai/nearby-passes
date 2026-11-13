// The NEAR adapter's fake (Nearby Passes spec 3.6.9: "The NEAR adapter has a fake that keeps the contract's rules in
// memory"; REQ-14-05). Every automated test uses it; no test reaches testnet. It enforces the rules of spec 3.4.3 the
// contract enforces (who may call, status, expiry, one claim per receiver per merchant and offer, the oldest open pass
// first, payouts once) so the app is tested against the same refusals. It is a test double with no production caller
// by design, as fixtureTransport is (build ruling 22; ruling 52(c)).
import { createHash } from 'node:crypto';
import type { PassStatus } from '../../shared/types.js';
import {
  PASS_DESCRIPTION_MAX_LENGTH, PASS_MAX_EXPIRY_MS, PASS_MIN_VALUE_NEAR, PASS_MINT_COUNT_MAX, PASS_OFFER_ID_MAX_LENGTH, PASS_TITLE_MAX_LENGTH,
} from '../../shared/types.js';
import { parseNear } from './format.js';
import {
  ChainRefusedError, ChainUnavailableError,
  type ChainAccessKey, type ChainConfig, type ChainOfferStats, type ChainPass, type ChainTx, type MintArgs, type NearAdapter, type TxOutcome,
} from './adapter.js';

interface FakePass extends ChainPass {
  status: PassStatus;
}

export type FakeFailure = 'refuse' | 'timeout-sent' | 'timeout-unsent' | 'network';

export class FakeNear implements NearAdapter {
  readonly passes = new Map<string, FakePass>();
  readonly balances = new Map<string, bigint>();
  readonly keys = new Map<string, ChainAccessKey[]>();
  readonly txs = new Map<string, TxOutcome>();
  /** Every call made, for tests: [method, signer, args]. */
  readonly calls: [string, string, unknown][] = [];
  private readonly claimed = new Set<string>();
  private nextId = 1;
  private txSeq = 1;
  private failNext: { method: string; kind: FakeFailure; message?: string } | null = null;
  cfg: ChainConfig;

  constructor(
    opts: { contractId: string; ownerId: string; agentId: string; mediaBaseUrl?: string },
    private readonly now: () => Date = () => new Date(),
  ) {
    this.contractId = opts.contractId;
    this.cfg = { ownerId: opts.ownerId, agentId: opts.agentId, claimsPaused: false, mediaBaseUrl: opts.mediaBaseUrl ?? 'http://localhost:3000/passes/' };
    this.keys.set(opts.agentId, [{ publicKey: 'ed25519:FakeAgentKey', kind: 'function_call', receiverId: opts.contractId, methodNames: ['claim_pass'], allowanceYocto: parseNear('3').toString() }]);
    this.balances.set(opts.agentId, parseNear('4'));
  }

  readonly contractId: string;

  /** The next call of `method` fails this way (tests of spec 3.6.3's failure paths). */
  failNextCall(method: string, kind: FakeFailure, message = 'Smart contract panicked'): void {
    this.failNext = { method, kind, message };
  }

  private nowMs(): number {
    return this.now().getTime();
  }

  private newHash(): string {
    return createHash('sha256').update(`fake-tx-${this.txSeq++}`).digest('base64url').slice(0, 44);
  }

  private async send<T>(method: string, signer: string, args: unknown, body: () => T): Promise<ChainTx<T>> {
    this.calls.push([method, signer, args]);
    const hash = this.newHash();
    const f = this.failNext && this.failNext.method === method ? this.failNext : null;
    if (f) this.failNext = null;
    if (f?.kind === 'network' || f?.kind === 'timeout-unsent') throw new ChainUnavailableError('The NEAR network did not answer.', null);
    if (f?.kind === 'refuse') {
      this.txs.set(hash, { state: 'failed', message: f.message ?? 'refused' });
      throw new ChainRefusedError(f.message ?? 'refused', hash);
    }
    let value: T;
    try {
      value = body();
    } catch (e) {
      this.txs.set(hash, { state: 'failed', message: (e as Error).message });
      throw new ChainRefusedError((e as Error).message, hash);
    }
    this.txs.set(hash, { state: 'succeeded', value });
    if (f?.kind === 'timeout-sent') throw new ChainUnavailableError('The claim was sent but its outcome is not known yet.', hash);
    return { hash, value };
  }

  private credit(account: string, amount: bigint): void {
    this.balances.set(account, (this.balances.get(account) ?? 0n) + amount);
  }

  // ---- views
  async config(): Promise<ChainConfig> {
    return { ...this.cfg };
  }
  async getPass(tokenId: string): Promise<ChainPass | null> {
    const p = this.passes.get(tokenId);
    return p ? { ...p } : null;
  }
  async passesForOwner(accountId: string, fromIndex: number, limit: number): Promise<ChainPass[]> {
    return [...this.passes.values()].filter((p) => p.ownerId === accountId).slice(fromIndex, fromIndex + limit).map((p) => ({ ...p }));
  }
  async passesForMerchant(merchantAccountId: string, fromIndex: number, limit: number): Promise<ChainPass[]> {
    return [...this.passes.values()].filter((p) => p.merchantId === merchantAccountId).reverse().slice(fromIndex, fromIndex + limit).map((p) => ({ ...p }));
  }
  async offerStats(merchantAccountId: string, offerId: string): Promise<ChainOfferStats> {
    const ps = [...this.passes.values()].filter((p) => p.merchantId === merchantAccountId && p.offerId === offerId);
    const count = (s: PassStatus) => ps.filter((p) => p.status === s).length;
    const held = ps.filter((p) => p.status === 'Open' || p.status === 'Claimed').reduce((t, p) => t + BigInt(p.valueYocto), 0n);
    return { open: count('Open'), claimed: count('Claimed'), redeemed: count('Redeemed'), refunded: count('Refunded'), heldYocto: held.toString() };
  }
  async balance(accountId: string): Promise<string | null> {
    const b = this.balances.get(accountId);
    return b === undefined ? null : b.toString();
  }
  async accessKeys(accountId: string): Promise<ChainAccessKey[]> {
    return (this.keys.get(accountId) ?? []).map((k) => ({ ...k }));
  }
  async txOutcome(hash: string): Promise<TxOutcome> {
    return this.txs.get(hash) ?? { state: 'unknown' };
  }

  // ---- calls (the rules of spec 3.4.2 and 3.4.3)
  async mintPasses(merchant: string, a: MintArgs): Promise<ChainTx<string[]>> {
    return this.send('mint_passes', merchant, a, () => {
      // The contract's limits (spec 3.4.2), from the shared constants.
      if (a.count < 1 || a.count > PASS_MINT_COUNT_MAX) throw new Error(`count must be 1 to ${PASS_MINT_COUNT_MAX}`);
      if (a.valueYocto < parseNear(PASS_MIN_VALUE_NEAR)) throw new Error(`value must be at least ${PASS_MIN_VALUE_NEAR} NEAR`);
      if (a.expiresAtMs <= this.nowMs() || a.expiresAtMs > this.nowMs() + PASS_MAX_EXPIRY_MS) throw new Error('expiry out of range');
      if (a.offerId.includes('|') || a.offerId.length > PASS_OFFER_ID_MAX_LENGTH || a.title.length > PASS_TITLE_MAX_LENGTH || a.description.length > PASS_DESCRIPTION_MAX_LENGTH) throw new Error('bad text');
      if (a.depositYocto < BigInt(a.count) * a.valueYocto) throw new Error('deposit too small');
      const ids: string[] = [];
      for (let i = 0; i < a.count; i++) {
        const tokenId = `pass-${this.nextId++}`;
        this.passes.set(tokenId, {
          tokenId, merchantId: merchant, offerId: a.offerId, title: a.title, description: a.description, valueYocto: a.valueYocto.toString(),
          expiresAtMs: a.expiresAtMs, status: 'Open', claimedAtMs: null, settledAtMs: null, ownerId: this.contractId, updatedAtMs: this.nowMs(),
        });
        ids.push(tokenId);
      }
      this.credit(merchant, -BigInt(a.count) * a.valueYocto);
      return ids;
    });
  }

  async claimPass(merchant: string, offerId: string, receiver: string): Promise<ChainTx<string>> {
    return this.send('claim_pass', this.cfg.agentId, { merchant, offerId, receiver }, () => {
      if (this.cfg.claimsPaused) throw new Error('Claims are paused');
      if (receiver.length === 64 && !/^[0-9a-f]{64}$/.test(receiver)) throw new Error('Invalid implicit receiver');
      const key = `${merchant}|${offerId}|${receiver}`;
      if (this.claimed.has(key)) throw new Error('Already claimed this offer');
      const open = [...this.passes.values()].filter((p) => p.merchantId === merchant && p.offerId === offerId && p.status === 'Open' && p.expiresAtMs > this.nowMs());
      if (open.length === 0) throw new Error('No open pass for this offer');
      const p = open[0];
      p.status = 'Claimed';
      p.ownerId = receiver;
      p.claimedAtMs = this.nowMs();
      p.updatedAtMs = this.nowMs();
      this.claimed.add(key);
      return p.tokenId;
    });
  }

  async redeemPass(merchant: string, tokenId: string): Promise<ChainTx<null>> {
    return this.send('redeem_pass', merchant, { tokenId }, () => {
      const p = this.passes.get(tokenId);
      if (!p) throw new Error('No such pass');
      if (p.merchantId !== merchant) throw new Error('Only the pass merchant can redeem');
      if (p.status !== 'Claimed') throw new Error(`Pass is ${p.status}`);
      if (this.nowMs() >= p.expiresAtMs) throw new Error('Pass expired');
      p.status = 'Redeemed';
      p.settledAtMs = this.nowMs();
      p.updatedAtMs = this.nowMs();
      this.credit(p.ownerId, BigInt(p.valueYocto));
      return null;
    });
  }

  async refundExpired(signer: string, tokenId: string): Promise<ChainTx<null>> {
    return this.send('refund_expired', signer, { tokenId }, () => {
      const p = this.passes.get(tokenId);
      if (!p) throw new Error('No such pass');
      if (p.status !== 'Open' && p.status !== 'Claimed') throw new Error(`Pass is ${p.status}`);
      if (this.nowMs() < p.expiresAtMs) throw new Error('Pass not expired');
      p.status = 'Refunded';
      p.settledAtMs = this.nowMs();
      p.updatedAtMs = this.nowMs();
      this.credit(p.merchantId, BigInt(p.valueYocto));
      return null;
    });
  }

  // ---- test helpers (not part of NearAdapter)
  /** Mints as `merchant` without the app (a stranger's passes, the seed). */
  seedPasses(merchant: string, offerId: string, count: number, valueNear = '0.1', expiresInMs = 48 * 3_600_000): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const tokenId = `pass-${this.nextId++}`;
      this.passes.set(tokenId, {
        tokenId, merchantId: merchant, offerId, title: 'Sample pass', description: 'Sample merchant. Testnet only.', valueYocto: parseNear(valueNear).toString(),
        expiresAtMs: this.nowMs() + expiresInMs, status: 'Open', claimedAtMs: null, settledAtMs: null, ownerId: this.contractId, updatedAtMs: this.nowMs(),
      });
      ids.push(tokenId);
    }
    return ids;
  }
}
