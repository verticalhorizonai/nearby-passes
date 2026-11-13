// The pass image and reference JSON (Nearby Passes spec 3.4.5, 3.6.4; REQ-10-05): drawn by the app from the pass's
// current status, so the NFT's picture changes as the pass is used. Colors are the app's tokens (ruling 49(g)): Open in
// the primary green, Claimed in blue (the one added value, used only here), Redeemed in the secondary gray with a
// check, Refunded in the map highlight's amber. Text on each band meets WCAG AA. Every text from the chain is escaped:
// anyone may mint, so a title is data, never markup.
import { COLORS } from '../../styles/tokens.js';
import type { PassStatus } from '../../shared/types.js';
import type { ChainPass } from '../near/adapter.js';
import { nearText } from '../near/format.js';

export const PASS_CLAIMED_BLUE = '#1D4E89';

export const STATUS_STYLE: Record<PassStatus, { band: string; ink: string; label: string }> = {
  Open: { band: COLORS.primary, ink: '#FFFFFF', label: 'Open' },
  Claimed: { band: PASS_CLAIMED_BLUE, ink: '#FFFFFF', label: 'Claimed' },
  Redeemed: { band: COLORS.secondaryText, ink: '#FFFFFF', label: 'Redeemed' },
  Refunded: { band: COLORS.glow, ink: COLORS.text, label: 'Refunded' },
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function phoenixDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

export function passSvg(p: ChainPass, merchantName: string | null): string {
  const st = STATUS_STYLE[p.status];
  const name = escapeXml(clip(merchantName ?? p.title, 34));
  const offer = escapeXml(clip(p.description.replace(/\s*Sample merchant\. Testnet only\.\s*$/, ''), 48));
  const check = p.status === 'Redeemed'
    ? `<path d="M352 30 l8 8 l16 -18" fill="none" stroke="${st.ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250" role="img" aria-label="${escapeXml(`${p.tokenId}, ${st.label}, ${nearText(p.valueYocto)}, ${merchantName ?? p.title}, sample`)}">
<rect width="400" height="250" rx="20" fill="${COLORS.surface}" stroke="${COLORS.border}"/>
<path d="M0 20 a20 20 0 0 1 20 -20 h360 a20 20 0 0 1 20 20 v40 h-400 z" fill="${st.band}"/>
<text x="24" y="38" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="${st.ink}">${st.label}</text>
${check}
<text x="24" y="92" font-family="Bricolage Grotesque, Arial, sans-serif" font-size="22" font-weight="700" fill="${COLORS.text}">${name}</text>
<rect x="24" y="102" width="62" height="20" rx="10" fill="${COLORS.badgeBg}"/>
<text x="55" y="116" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700" fill="${COLORS.accent}">SAMPLE</text>
<text x="96" y="117" font-family="Inter, Arial, sans-serif" font-size="14" fill="${COLORS.secondaryText}">${offer}</text>
<text x="24" y="158" font-family="Bricolage Grotesque, Arial, sans-serif" font-size="26" font-weight="800" fill="${COLORS.primary}">${escapeXml(nearText(p.valueYocto))}</text>
<text x="24" y="186" font-family="Inter, Arial, sans-serif" font-size="14" fill="${COLORS.secondaryText}">Expires ${escapeXml(phoenixDate(p.expiresAtMs))} (Phoenix)</text>
<text x="24" y="226" font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="700" fill="${COLORS.text}">${escapeXml(p.tokenId)}</text>
<text x="376" y="226" text-anchor="end" font-family="Inter, Arial, sans-serif" font-size="12" fill="${COLORS.secondaryText}">Testnet only</text>
</svg>`;
}

export function passReference(p: ChainPass, merchantName: string | null, imageUrl: string) {
  return {
    name: p.title,
    description: p.description,
    image: imageUrl,
    token_id: p.tokenId,
    status: p.status,
    value_yocto: p.valueYocto,
    value: nearText(p.valueYocto),
    merchant: p.merchantId,
    merchant_name: merchantName,
    offer_id: p.offerId,
    expires_at: String(p.expiresAtMs),
    updated_at: p.updatedAtMs === null ? null : String(p.updatedAtMs),
    sample: true,
    network: 'testnet',
  };
}
