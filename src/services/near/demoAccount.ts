// The visitor's demo NEAR account (Nearby Passes spec 3.6.2; F8.1; REQ-09-06): derived, never created and never
// stored. seed = HMAC-SHA256(NEAR_DEMO_ACCOUNT_SECRET, session_id + ":" + account_index); the seed is an ed25519
// private key; the account id is the 64 lowercase hex characters of its public key (an implicit account, which a
// NEAR transfer creates on first payout). The private key never leaves this function's caller on the server
// (SEC-09-06-01); only F9.5 (a Could, not built) would ever export it.
import { createHmac, createPrivateKey, createPublicKey } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function demoSeed(secret: Buffer, sessionId: string, accountIndex: number): Buffer {
  return createHmac('sha256', secret).update(`${sessionId}:${accountIndex}`, 'utf8').digest();
}

/** The ed25519 public key (32 bytes) of a 32-byte seed. */
export function ed25519PublicKey(seed: Buffer): Buffer {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const jwk = createPublicKey(priv).export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url');
}

/** The session's demo account id for this index: 64 lowercase hex characters. */
export function demoAccountId(secret: Buffer, sessionId: string, accountIndex: number): string {
  return ed25519PublicKey(demoSeed(secret, sessionId, accountIndex)).toString('hex');
}
