// @vitest-environment jsdom
// F11.3 (Should; AC-REQ-12-03-01): pass activity appears beside the sales within the feed's poll, newest first; nothing
// shows with passes off.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { NearAccountResult, PassActivityItem } from '@/shared/types';
import { PassActivityPanel } from './PassActivityPanel';
import { refreshNearAccount } from '@/hooks/useNearAccount';

const MID = '00000000-0000-4000-8000-000000000001';
const on: NearAccountResult = { passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: 'a'.repeat(64), source: 'demo', explorerUrl: 'https://testnet.near.rocks/account/x' };
const off: NearAccountResult = { passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null };

function stub(account: NearAccountResult, pages: PassActivityItem[][]) {
  let poll = 0;
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/near/account') return new Response(JSON.stringify({ success: true, data: account }));
    if (path === `/api/merchants/${MID}/passes/activity`) {
      const items = pages[Math.min(poll++, pages.length - 1)];
      return new Response(JSON.stringify({ success: true, data: { items } }));
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PassActivityPanel', () => {
  it('AC-REQ-12-03-01: a claim, then a redemption, appear within the poll, newest first, with their links', async () => {
    const claim: PassActivityItem = { kind: 'claim', tokenId: 'pass-6', at: '2026-11-13T01:20:00.000Z', txUrl: 'https://testnet.near.rocks/tx/a' };
    const redeem: PassActivityItem = { kind: 'redeem', tokenId: 'pass-6', at: '2026-11-13T01:21:00.000Z', txUrl: 'https://testnet.near.rocks/tx/b' };
    stub(on, [[], [claim], [redeem, claim]]);
    await refreshNearAccount();
    render(<PassActivityPanel merchantId={MID} intervalMs={30} />);
    await waitFor(() => expect(screen.getAllByTestId('pass-activity')).toHaveLength(2), { timeout: 2000 });
    const rows = screen.getAllByTestId('pass-activity');
    expect(rows[0]).toHaveTextContent('pass-6 redeemed');
    expect(rows[1]).toHaveTextContent('pass-6 claimed');
    expect(screen.getByRole('heading', { name: 'Pass activity' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Explorer/ })[0]).toHaveAttribute('href', 'https://testnet.near.rocks/tx/b');
  });
  it('AC-REQ-14-06-01: with passes off it renders nothing and asks for no activity', async () => {
    const fn = stub(off, [[{ kind: 'claim', tokenId: 'pass-1', at: '2026-11-13T01:20:00.000Z', txUrl: null }]]);
    await refreshNearAccount();
    const { container } = render(<PassActivityPanel merchantId={MID} intervalMs={30} />);
    await new Promise((r) => setTimeout(r, 120));
    expect(container).toBeEmptyDOMElement();
    expect(fn.mock.calls.some(([u]) => String(u).includes('/passes/activity'))).toBe(false);
  });
});
