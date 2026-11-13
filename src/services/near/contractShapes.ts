// The passes contract's JSON, read into the adapter's types (Nearby Passes spec 3.4.2 views). Field names follow the
// contract in contracts/passes/ (snake_case, amounts as yoctoNEAR strings, times in milliseconds).
import type { PassStatus } from '../../shared/types.js';
import { PASS_STATUSES } from '../../shared/types.js';
import type { ChainOfferStats, ChainPass } from './adapter.js';

type Json = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export function fromContractPass(p: Json): ChainPass {
  const pass = (p.pass && typeof p.pass === 'object' ? { ...(p.pass as Json), ...p } : p) as Json;
  const meta = (pass.metadata ?? {}) as Json;
  const status = str(pass.status) as PassStatus;
  if (!PASS_STATUSES.includes(status)) throw new Error(`unknown pass status ${status}`);
  return {
    tokenId: str(pass.token_id),
    merchantId: str(pass.merchant_id),
    offerId: str(pass.offer_id),
    title: str(pass.title ?? meta.title),
    description: str(meta.description ?? pass.description),
    valueYocto: BigInt(str(pass.value ?? pass.value_yocto) || '0').toString(),
    expiresAtMs: Number(pass.expires_at_ms),
    status,
    claimedAtMs: num(pass.claimed_at_ms),
    settledAtMs: num(pass.settled_at_ms),
    ownerId: str(pass.owner_id),
    updatedAtMs: num(meta.updated_at),
  };
}

export function fromContractStats(s: Json): ChainOfferStats {
  return {
    open: Number(s.open ?? 0),
    claimed: Number(s.claimed ?? 0),
    redeemed: Number(s.redeemed ?? 0),
    refunded: Number(s.refunded ?? 0),
    heldYocto: BigInt(str(s.held ?? s.held_yocto) || '0').toString(),
  };
}
