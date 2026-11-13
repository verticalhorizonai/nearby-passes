// Words for passes on screen (Nearby Passes 3.6.7): the short account ("3f2a…9c1d"), the expiry, the offer line, the
// pass number as the merchant types it. Amounts arrive from the server already written ("0.1 testnet NEAR").
import { APP_TIME_ZONE } from '@/client/format';
import { PASS_SAMPLE_LINE, PASS_TOKEN_ID_PATTERN } from '@/shared/types';

/** "3f2a…9c1d": the first four and last four characters (F8.1). A short named account is shown whole. */
export function shortAccount(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

const expiryFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Thu, Nov 19, 9:30 AM" in the demo's time zone. */
export function formatExpiry(iso: string): string {
  return expiryFormat.format(new Date(iso));
}

/** The offer line of a pass: its description without the trailing "Sample merchant. Testnet only." */
export function passOffer(description: string): string {
  const d = description.trim();
  if (!d.endsWith(PASS_SAMPLE_LINE)) return d;
  return d.slice(0, d.length - PASS_SAMPLE_LINE.length).trim();
}

/** "pass-7" or "7" (or "#7") -> "pass-7"; anything else -> null (build ruling 49(c)). */
export function normalizePassNumber(raw: string): string | null {
  const t = raw.trim().replace(/^#/, '').toLowerCase();
  const id = /^\d+$/.test(t) ? `pass-${t}` : t;
  return PASS_TOKEN_ID_PATTERN.test(id) ? id : null;
}
