// @vitest-environment jsdom
// The visible name "NEARby" with passes on (ruling 63, the spec owner's naming decision): the header's wordmark in two
// colours, the visitor's running text, the tab's title, and the PayPal group's heading. Spoken names stay "Nearby".
// With passes off every page is exactly as accepted.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NearAccountResult } from '@/shared/types';
import { AppRoutes } from '@/client/App';
import { refreshNearAccount } from '@/hooks/useNearAccount';

const ON: NearAccountResult = { passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: 'a'.repeat(64), source: 'demo', explorerUrl: 'https://testnet.near.rocks/account/x' };
const OFF: NearAccountResult = { passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null };

async function renderAt(path: string, account: NearAccountResult) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const p = new URL(String(input), 'http://localhost').pathname;
    const data = p === '/api/near/account' ? account : p === '/api/config/public' ? { repoUrl: null, googleMapsBrowserKey: null } : null;
    return data ? new Response(JSON.stringify({ success: true, data })) : new Response('{}', { status: 404 });
  }));
  await refreshNearAccount();
  document.title = 'Nearby';
  render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
  await screen.findByTestId('wordmark');
}
/** What a sighted visitor reads: the page's text without the screen-reader-only spans. */
function visibleText(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return copy.textContent ?? '';
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the name with passes on (ruling 63)', () => {
  it('the header shows NEARby, with NEAR in the primary green, and its spoken name is still Nearby; the tab reads NEARby Passes', async () => {
    await renderAt('/', ON);
    await waitFor(() => expect(screen.getByTestId('wordmark')).toHaveTextContent(/^NEARby$/));
    const near = screen.getByTestId('wordmark').querySelector('.text-primary');
    expect(near).toHaveTextContent(/^NEAR$/);
    expect(screen.getAllByRole('link', { name: 'Nearby home' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('wordmark').closest('a')).toHaveAccessibleName('Nearby home');
    await waitFor(() => expect(document.title).toBe('NEARby Passes'));
  });
  it('the home page names NEARby in its text, and the PayPal group reads "Also in the app"', async () => {
    await renderAt('/', ON);
    await screen.findByRole('heading', { name: 'Also in the app: pay with PayPal' });
    expect(screen.queryByRole('heading', { name: 'Also in Nearby: pay with PayPal' })).not.toBeInTheDocument();
    expect(visibleText()).toContain('NEARby reads where your calendar takes you');
    expect(visibleText()).not.toMatch(/\bNearby\b/);
  });
  it('other pages name NEARby too: Choose a seat and the page that is not found', async () => {
    await renderAt('/seats', ON);
    await screen.findByText(/It only picks which side of NEARby you see/);
    expect(visibleText()).not.toMatch(/\bNearby\b/);
    cleanup();
    await renderAt('/no-such-page', ON);
    await screen.findByText(/This page is not part of NEARby\./);
    expect(visibleText()).not.toMatch(/\bNearby\b/);
  });
});

describe('the name with passes off (as accepted)', () => {
  it('the header, the text and the tab say Nearby, in one colour', async () => {
    await renderAt('/', OFF);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('wordmark')).toHaveTextContent(/^Nearby$/);
    expect(screen.getByTestId('wordmark').querySelector('.text-primary')).toBeNull();
    expect(visibleText()).not.toContain('NEARby');
    expect(document.title).toBe('Nearby');
  });
  it('Choose a seat keeps its sentence', async () => {
    await renderAt('/seats', OFF);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/It only picks which side of Nearby you see/)).toBeInTheDocument();
    expect(visibleText()).not.toContain('NEARby');
  });
});
