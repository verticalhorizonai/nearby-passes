// NEAR amounts (Nearby Passes spec 3.6.4: "Amounts are never read from a request"): yoctoNEAR as bigint on the server,
// decimal strings on the wire, and text such as "0.1 testnet NEAR" on screen. No floating point.
export const YOCTO_PER_NEAR = 10n ** 24n;

/** "0.1" -> 100000000000000000000000n. Throws on anything but a non-negative decimal with at most 24 places. */
export function parseNear(text: string): bigint {
  const t = String(text).trim();
  if (!/^\d+(\.\d{1,24})?$/.test(t)) throw new Error(`not a NEAR amount: ${t}`);
  const [w, f = ''] = t.split('.');
  return BigInt(w) * YOCTO_PER_NEAR + BigInt((f + '0'.repeat(24)).slice(0, 24));
}

/** 100000000000000000000000n -> "0.1"; at most `places` decimals, rounded down, trailing zeros dropped. */
export function formatNear(yocto: bigint | string, places = 4): string {
  const v = BigInt(yocto);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / YOCTO_PER_NEAR;
  const frac = (a % YOCTO_PER_NEAR).toString().padStart(24, '0').slice(0, places).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** "0.1 testnet NEAR": every amount on screen says testnet (spec 3.6.7). */
export function nearText(yocto: bigint | string, places = 4): string {
  return `${formatNear(yocto, places)} testnet NEAR`;
}
