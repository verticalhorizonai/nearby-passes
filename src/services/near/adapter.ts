// The one place that talks to NEAR (Nearby Passes spec 3.1, 3.6.9; REQ-14-05): views, signing as the agent's
// function-call key or as a sample merchant, account and key reads, transaction status by hash. The live
// implementation is liveNearAdapter.ts (near-api-js); every test uses fakeNear.ts, which keeps the contract's rules.
import type { PassStatus } from '../../shared/types.js';

/** A pass as the contract's views give it (get_pass, passes_for_owner, passes_for_merchant). */
export interface ChainPass {
  tokenId: string;
  merchantId: string;
  offerId: string;
  title: string;
  description: string;
  valueYocto: string;
  expiresAtMs: number;
  status: PassStatus;
  claimedAtMs: number | null;
  settledAtMs: number | null;
  ownerId: string;
  /** The token metadata's updated_at (ms), when the contract gives it. */
  updatedAtMs: number | null;
}

export interface ChainOfferStats {
  open: number;
  claimed: number;
  redeemed: number;
  refunded: number;
  heldYocto: string;
}

export interface ChainConfig {
  ownerId: string;
  agentId: string;
  claimsPaused: boolean;
  mediaBaseUrl: string;
}

export interface ChainAccessKey {
  publicKey: string;
  kind: 'function_call' | 'full_access';
  receiverId: string | null;
  methodNames: string[];
  allowanceYocto: string | null;
}

/** A transaction that executed; `value` is the method's return value. */
export interface ChainTx<T = unknown> {
  hash: string;
  value: T;
}

export interface MintArgs {
  offerId: string;
  title: string;
  description: string;
  valueYocto: bigint;
  expiresAtMs: number;
  count: number;
  depositYocto: bigint;
}

/** The contract refused the call (it panicked): the call is final and nothing changed. */
export class ChainRefusedError extends Error {
  constructor(message: string, public readonly hash: string | null) {
    super(message);
  }
}

/** The network failed or the outcome was not known in time. `hash` is set when the transaction was signed and sent,
 * so its outcome can be checked later (spec 3.6.3). */
export class ChainUnavailableError extends Error {
  constructor(message: string, public readonly hash: string | null) {
    super(message);
  }
}

export type TxOutcome = { state: 'succeeded'; value: unknown } | { state: 'failed'; message: string } | { state: 'unknown' };

export interface NearAdapter {
  config(): Promise<ChainConfig>;
  getPass(tokenId: string): Promise<ChainPass | null>;
  passesForOwner(accountId: string, fromIndex: number, limit: number): Promise<ChainPass[]>;
  passesForMerchant(merchantAccountId: string, fromIndex: number, limit: number): Promise<ChainPass[]>;
  offerStats(merchantAccountId: string, offerId: string): Promise<ChainOfferStats>;
  /** The account's total balance in yocto, or null when the account does not exist. */
  balance(accountId: string): Promise<string | null>;
  accessKeys(accountId: string): Promise<ChainAccessKey[]>;
  /** Signed by the agent's function-call key, no deposit. Returns the token id. */
  claimPass(merchantAccountId: string, offerId: string, receiverId: string): Promise<ChainTx<string>>;
  /** Signed by that merchant's key. Returns the token ids. */
  mintPasses(merchantAccountId: string, args: MintArgs): Promise<ChainTx<string[]>>;
  /** Signed by that merchant's key, exactly 1 yoctoNEAR and REDEEM_GAS_TGAS. */
  redeemPass(merchantAccountId: string, tokenId: string): Promise<ChainTx<null>>;
  /** Signed by that merchant's key (anyone may call refund_expired). */
  refundExpired(signerAccountId: string, tokenId: string): Promise<ChainTx<null>>;
  /** The outcome of a transaction the server sent, by its hash. */
  txOutcome(hash: string, signerId: string): Promise<TxOutcome>;
}
