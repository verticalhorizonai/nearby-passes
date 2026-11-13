// The live NEAR adapter (Nearby Passes spec 3.1, 3.2; REQ-14-05): near-api-js 7.4.0 against the testnet RPC of
// NEAR_RPC_URL. It holds the agent's function-call key and the sample merchants' keys; nothing else in the app does.
// No key is ever logged or returned. Each transaction is signed first, so its hash is known before it is sent and an
// unknown outcome can be checked by that hash later (spec 3.6.3). Calls signed by one key are sent one at a time, so
// two claims never race for the same nonce. Waiting is bounded by NEAR_CALL_TIMEOUT_MS.
import { Account, JsonRpcProvider, KeyPairSigner, actions, baseEncode } from 'near-api-js';
import { NEAR_CALL_TIMEOUT_MS, REDEEM_GAS_TGAS } from '../../shared/types.js';
import type { NearConfig } from './nearConfig.js';
import {
  ChainRefusedError, ChainUnavailableError,
  type ChainAccessKey, type ChainConfig, type ChainOfferStats, type ChainPass, type ChainTx, type MintArgs, type NearAdapter, type TxOutcome,
} from './adapter.js';
import { fromContractPass, fromContractStats } from './contractShapes.js';

const TGAS = 1_000_000_000_000n;
const CALL_GAS = 100n * TGAS;

type Json = Record<string, unknown>;

export class LiveNearAdapter implements NearAdapter {
  private readonly provider: JsonRpcProvider;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly cfg: NearConfig, private readonly timeoutMs = NEAR_CALL_TIMEOUT_MS) {
    this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
  }

  private async view<T>(method: string, args: Json): Promise<T | undefined> {
    return (await this.provider.callFunction({ contractId: this.cfg.contractId, method, args })) as T | undefined;
  }

  async config(): Promise<ChainConfig> {
    const c = await this.view<{ owner_id: string; agent_id: string; claims_paused: boolean; media_base_url: string }>('config', {});
    if (!c) throw new ChainUnavailableError('config() returned nothing', null);
    return { ownerId: c.owner_id, agentId: c.agent_id, claimsPaused: c.claims_paused, mediaBaseUrl: c.media_base_url };
  }

  async getPass(tokenId: string): Promise<ChainPass | null> {
    const p = await this.view<Json | null>('get_pass', { token_id: tokenId });
    return p ? fromContractPass(p) : null;
  }

  async passesForOwner(accountId: string, fromIndex: number, limit: number): Promise<ChainPass[]> {
    return ((await this.view<Json[]>('passes_for_owner', { account_id: accountId, from_index: fromIndex, limit })) ?? []).map(fromContractPass);
  }

  async passesForMerchant(merchantAccountId: string, fromIndex: number, limit: number): Promise<ChainPass[]> {
    return ((await this.view<Json[]>('passes_for_merchant', { merchant_id: merchantAccountId, from_index: fromIndex, limit })) ?? []).map(fromContractPass);
  }

  async offerStats(merchantAccountId: string, offerId: string): Promise<ChainOfferStats> {
    return fromContractStats((await this.view<Json>('offer_stats', { merchant_id: merchantAccountId, offer_id: offerId })) ?? {});
  }

  async balance(accountId: string): Promise<string | null> {
    try {
      const a = await this.provider.viewAccount({ accountId });
      return BigInt(a.amount).toString();
    } catch (e) {
      if (/does not exist|UNKNOWN_ACCOUNT/i.test(String((e as Error).message ?? e))) return null;
      throw new ChainUnavailableError(`Could not read ${accountId}`, null);
    }
  }

  async accessKeys(accountId: string): Promise<ChainAccessKey[]> {
    const list = await this.provider.viewAccessKeyList({ accountId });
    return (list.keys ?? []).map((k) => {
      const perm = k.access_key.permission as unknown;
      const fc = typeof perm === 'object' && perm !== null && 'FunctionCall' in perm ? (perm as { FunctionCall: { receiver_id: string; method_names: string[]; allowance?: string | bigint | null } }).FunctionCall : null;
      return {
        publicKey: k.public_key,
        kind: fc ? 'function_call' : 'full_access',
        receiverId: fc?.receiver_id ?? null,
        methodNames: fc?.method_names ?? [],
        allowanceYocto: fc?.allowance != null ? BigInt(fc.allowance).toString() : null,
      };
    });
  }

  claimPass(merchantAccountId: string, offerId: string, receiverId: string): Promise<ChainTx<string>> {
    return this.call<string>(this.cfg.agentAccountId, this.cfg.agentPrivateKey, 'claim_pass', { merchant_id: merchantAccountId, offer_id: offerId, receiver_id: receiverId }, 0n, CALL_GAS);
  }

  mintPasses(merchantAccountId: string, a: MintArgs): Promise<ChainTx<string[]>> {
    return this.call<string[]>(merchantAccountId, this.merchantKey(merchantAccountId), 'mint_passes', {
      offer_id: a.offerId, title: a.title, description: a.description, value: a.valueYocto.toString(), expires_at_ms: a.expiresAtMs, count: a.count,
    }, a.depositYocto, CALL_GAS * 2n);
  }

  redeemPass(merchantAccountId: string, tokenId: string): Promise<ChainTx<null>> {
    return this.call<null>(merchantAccountId, this.merchantKey(merchantAccountId), 'redeem_pass', { token_id: tokenId }, 1n, BigInt(REDEEM_GAS_TGAS) * TGAS);
  }

  refundExpired(signerAccountId: string, tokenId: string): Promise<ChainTx<null>> {
    return this.call<null>(signerAccountId, this.merchantKey(signerAccountId), 'refund_expired', { token_id: tokenId }, 0n, 50n * TGAS);
  }

  async txOutcome(hash: string, signerId: string): Promise<TxOutcome> {
    try {
      const res = await this.provider.viewTransactionStatus({ txHash: hash, accountId: signerId, waitUntil: 'EXECUTED_OPTIMISTIC' });
      return outcomeOf(res);
    } catch {
      return { state: 'unknown' };
    }
  }

  private merchantKey(accountId: string): string {
    const k = this.cfg.merchantKeys[accountId];
    if (!k) throw new ChainRefusedError(`No key for ${accountId}`, null);
    return k;
  }

  /** One signed call, sent after the previous call signed by the same key has finished. */
  private call<T>(signerId: string, key: string, methodName: string, args: Json, deposit: bigint, gas: bigint): Promise<ChainTx<T>> {
    const prev = this.queues.get(signerId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.send<T>(signerId, key, methodName, args, deposit, gas));
    this.queues.set(signerId, run.catch(() => undefined));
    return run;
  }

  private async send<T>(signerId: string, key: string, methodName: string, args: Json, deposit: bigint, gas: bigint): Promise<ChainTx<T>> {
    const signer = KeyPairSigner.fromSecretKey(key as `ed25519:${string}`);
    const account = new Account(signerId, this.provider, signer);
    let hash: string | null = null;
    let signed;
    try {
      const tx = await account.createTransaction({
        receiverId: this.cfg.contractId,
        actions: [actions.functionCall(methodName, args, gas, deposit)],
        publicKey: await signer.getPublicKey(),
      });
      const s = await signer.signTransaction(tx);
      hash = baseEncode(s.txHash);
      signed = s.signedTransaction;
    } catch (e) {
      throw new ChainUnavailableError(`Could not prepare ${methodName}: ${safe(e)}`, null);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const res = await Promise.race([
        this.provider.sendTransactionUntil(signed, 'EXECUTED_OPTIMISTIC'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ChainUnavailableError(`${methodName}: no final outcome within ${this.timeoutMs} ms`, hash)), this.timeoutMs);
        }),
      ]);
      const o = outcomeOf(res);
      if (o.state === 'failed') throw new ChainRefusedError(o.message, hash);
      if (o.state !== 'succeeded') throw new ChainUnavailableError(`${methodName}: outcome unknown`, hash);
      return { hash: hash!, value: o.value as T };
    } catch (e) {
      if (e instanceof ChainRefusedError || e instanceof ChainUnavailableError) throw e;
      const msg = safe(e);
      // The node refused the transaction before it ran (invalid key, nonce, balance): nothing changed.
      if (/InvalidTxError|InvalidAccessKey|NotEnoughBalance|NotEnoughAllowance|MethodNameMismatch|ReceiverMismatch|DepositWithFunctionCall|Expired|InvalidNonce/i.test(msg)) {
        throw new ChainRefusedError(msg, null);
      }
      throw new ChainUnavailableError(`${methodName}: ${msg}`, hash);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** The outcome of a transaction response: its status, and any receipt that failed. */
export function outcomeOf(res: unknown): TxOutcome {
  const r = res as { status?: unknown; receipts_outcome?: { outcome?: { status?: unknown } }[] };
  const st = r?.status as Record<string, unknown> | string | undefined;
  if (st && typeof st === 'object' && 'Failure' in st) return { state: 'failed', message: failureText(st.Failure) };
  if (st && typeof st === 'object' && 'SuccessValue' in st) {
    const raw = String(st.SuccessValue ?? '');
    const text = raw ? Buffer.from(raw, 'base64').toString('utf8') : '';
    let value: unknown = null;
    try {
      value = text ? JSON.parse(text) : null;
    } catch {
      value = text;
    }
    return { state: 'succeeded', value };
  }
  return { state: 'unknown' };
}

function failureText(f: unknown): string {
  const s = JSON.stringify(f);
  const m = /Smart contract panicked: ([^"\\]+)/.exec(s);
  return m ? m[1] : s.slice(0, 200);
}

/** An error's text with anything that looks like a key removed (spec rule 3). */
export function safe(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{30,}/g, 'ed25519:<hidden>').slice(0, 300);
}
