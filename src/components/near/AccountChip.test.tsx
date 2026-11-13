// @vitest-environment jsdom
// The shopper's NEAR account in the header (Nearby Passes F8.1; REQ-09-01): "Passes go to 3f2a…9c1d", the account
// panel with the full id, "Demo account, testnet" and the explorer link; no wallet, no sign-in, nothing signed.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NearAccountResult } from '@/shared/types';
import { AppRoutes } from '@/client/App';
import { refreshNearAccount } from '@/hooks/useNearAccount';

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };
function stubFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const h = routes[`${init?.method ?? 'GET'} ${url.pathname}`];
    const r = h ? h(init) : { status: 404, body: { success: false, error: { code: 'not_found', message: 'Not found' } } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const ok = (data: unknown): Handler => () => ({ status: 200, body: { success: true, data } });

const ACCOUNT = `3f2a${'0123456789abcdef'.repeat(3)}${'a'.repeat(8)}9c1d`;
const account: NearAccountResult = {
  passesEnabled: true,
  claimsAvailable: true,
  unavailableReason: null,
  network: 'testnet',
  accountId: ACCOUNT,
  source: 'demo',
  explorerUrl: `https://testnet.near.rocks/account/${ACCOUNT}`,
};
const routes = {
  'GET /api/near/account': ok(account),
  'GET /api/calendar/connection': ok({ calendarName: 'Demo calendar', upcomingAppointmentCount: 0, connectedAt: '2026-11-11T17:00:00.000Z' }),
  'GET /api/appointments/upcoming': ok({ appointments: [], skippedEvents: [] }),
};

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('my NEAR account (REQ-09-01)', () => {
  it('AC-REQ-09-01-01: the Shopper seat\'s header reads "Passes go to 3f2a…9c1d" and opens the panel with the full id, "Demo account, testnet" and the explorer link', async () => {
    expect(ACCOUNT).toHaveLength(64);
    stubFetch(routes);
    await refreshNearAccount();
    renderAt('/week');
    const chip = await screen.findByTestId('account-chip');
    expect(chip).toHaveTextContent('Passes go to 3f2a…9c1d');
    expect(chip).toHaveClass('min-h-touch');
    expect(chip.className).toMatch(/focus-visible:ring-2/);
    expect(screen.getByRole('banner')).toContainElement(chip);
    fireEvent.click(chip);
    const panel = await screen.findByRole('dialog', { name: 'Where your passes go' });
    expect(within(panel).getByTestId('account-id')).toHaveTextContent(ACCOUNT);
    expect(panel).toHaveTextContent('Demo account, testnet');
    expect(within(panel).getByRole('link', { name: /See the account on the explorer/ })).toHaveAttribute('href', `https://testnet.near.rocks/account/${ACCOUNT}`);
  });

  it('AC-REQ-09-01-01: the chip is in the Shopper seat only, not on a merchant\'s page', async () => {
    stubFetch({ ...routes, 'GET /api/merchants/m1/dashboard': () => ({ status: 404, body: { success: false, error: { code: 'not_found', message: 'x' } } }) });
    await refreshNearAccount();
    window.localStorage.setItem('nearby.seat', JSON.stringify({ seat: 'merchant', merchantId: 'm1', merchantName: 'Saguaro Bean Co.', merchantIsSample: true }));
    renderAt('/merchant/m1');
    expect(await screen.findByText('This merchant is not here')).toBeInTheDocument();
    expect(screen.queryByTestId('account-chip')).toBeNull();
  });

  it('AC-REQ-09-01-02: a new browser in the Shopper seat sees the demo account with no wallet prompt, no sign-in and nothing signed', async () => {
    const fetchFn = stubFetch(routes);
    await refreshNearAccount();
    renderAt('/week');
    fireEvent.click(await screen.findByTestId('account-chip'));
    const panel = await screen.findByRole('dialog', { name: 'Where your passes go' });
    expect(panel).toHaveTextContent('You need no wallet, and there is nothing to sign.');
    expect(document.body.textContent).not.toMatch(/sign in|log in|connect (a|your) wallet/i);
    expect(screen.queryByRole('textbox')).toBeNull();
    // only reads: the account is derived on the server, never created or signed for from the browser
    const writes = fetchFn.mock.calls.filter(([, i]) => (i?.method ?? 'GET') !== 'GET').map(([u]) => String(u));
    expect(writes.filter((u) => u.includes('/near') || u.includes('/passes'))).toEqual([]);
  });
});
