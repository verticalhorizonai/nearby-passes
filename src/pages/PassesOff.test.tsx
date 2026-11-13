// @vitest-environment jsdom
// Passes off (Nearby Passes 3.6.8 "Unset: passes are off and the app runs as Nearby does today"; REQ-14-06): with
// GET /api/near/account answering passesEnabled false, no pass control shows anywhere and no pass route is asked.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppointmentPicks, MerchantDashboard, NearAccountResult, UpcomingAppointment } from '@/shared/types';
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

const OFF: NearAccountResult = { passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null };
const MID = '00000000-0000-4000-8000-000000000001';
const A1: UpcomingAppointment = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Client meeting',
  startsAt: '2026-11-17T16:30:00.000Z',
  endsAt: '2026-11-17T17:30:00.000Z',
  address: 'Client meeting address, Tucson',
  location: { lat: 32.2319, lng: -110.9535 },
  enabled: true,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  boughtCount: 0,
  passCount: 0,
};
const picks: AppointmentPicks = {
  appointmentId: A1.id,
  noMatch: false,
  picks: [
    {
      proposalId: 'p-1', merchantId: MID, merchantName: 'Saguaro Bean Co.', merchantIsSample: true, offerId: 'o1', offerTitle: 'Any drink plus pastry',
      priceCents: 600, regularPriceCents: null, validWindow: { validDays: ['tue'], validStartTime: '07:00', validEndTime: '11:00' },
      reason: 'Two blocks from your 9:30.', distanceMeters: 322, score: 0.9, source: 'agent', status: 'proposed', purchased: false, pass: null, passClaim: null,
    },
  ],
};
const dashboard: MerchantDashboard = {
  merchant: {
    id: MID, name: 'Saguaro Bean Co.', type: 'Coffee shop', area: 'near the university', location: { lat: 32.2335, lng: -110.9515 }, isSample: true,
    createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
  },
  offers: [],
};
const routes: Record<string, Handler> = {
  'GET /api/near/account': ok(OFF),
  'GET /api/config/public': ok({ repoUrl: null, googleMapsBrowserKey: null }),
  'GET /api/calendar/connection': ok({ calendarName: 'Demo calendar', upcomingAppointmentCount: 1, connectedAt: '2026-11-11T17:00:00.000Z' }),
  'GET /api/appointments/upcoming': ok({ appointments: [A1], skippedEvents: [] }),
  [`GET /api/appointments/${A1.id}/picks`]: ok(picks),
  [`GET /api/appointments/${A1.id}/map`]: ok({ appointment: A1, searchRadiusMeters: 1609, renderMode: 'svg_plot', places: [], placesAttributions: [], merchants: [] }),
  [`GET /api/merchants/${MID}/dashboard`]: ok(dashboard),
  [`GET /api/merchants/${MID}/sales-feed`]: ok({ merchantId: MID, items: [] }),
};

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

function expectNoPassControl() {
  expect(screen.queryByTestId('account-chip')).toBeNull();
  expect(screen.queryByText(/Passes go to/)).toBeNull();
  expect(screen.queryByTestId('pick-pass-line')).toBeNull();
  expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull();
  expect(screen.queryByRole('link', { name: 'My passes' })).toBeNull();
  expect(screen.queryByTestId('pass-pill')).toBeNull();
  expect(screen.queryByTestId('merchant-near-panel')).toBeNull();
  expect(screen.queryByTestId('passes-on-near')).toBeNull();
  expect(screen.queryByText(/testnet NEAR/)).toBeNull();
}

function askedForPasses(fn: ReturnType<typeof stubFetch>): string[] {
  return fn.mock.calls
    .map(([u]) => new URL(String(u), 'http://localhost').pathname)
    .filter((p) => p !== '/api/near/account' && (p.startsWith('/api/near') || p.startsWith('/api/passes') || /\/passes(\/|$)/.test(p)));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('passes off (REQ-14-06)', () => {
  it('AC-REQ-14-06-01: the home page has no passes section and asks for no agent keys', async () => {
    const fn = stubFetch(routes);
    await refreshNearAccount();
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'The deal that is already on your way.' })).toBeInTheDocument();
    expect(screen.getByTestId('how-to-test')).toBeInTheDocument();
    expectNoPassControl();
    expect(askedForPasses(fn)).toEqual([]);
  });

  it('AC-REQ-14-06-01: My week shows no account chip, no pass pill and no My passes link', async () => {
    const fn = stubFetch(routes);
    await refreshNearAccount();
    window.localStorage.setItem('nearby.seat', JSON.stringify({ seat: 'shopper', merchantId: null, merchantName: null, merchantIsSample: null }));
    renderAt('/week');
    expect(await screen.findAllByTestId('appointment-row')).toHaveLength(1);
    expect(screen.getByTestId('seat-chip')).toHaveTextContent('Shopper');
    expectNoPassControl();
    expect(askedForPasses(fn)).toEqual([]);
  });

  it('AC-REQ-14-06-01: a stop\'s pick has Yes and Not now as before, with no pass line or Claim as pass', async () => {
    const fn = stubFetch(routes);
    await refreshNearAccount();
    renderAt(`/appointments/${A1.id}`);
    expect(await screen.findByRole('button', { name: /^Yes/ })).toHaveClass('flex-[2_1_0%]');
    expect(screen.getByRole('button', { name: /^Not now/ })).toHaveClass('flex-[1_1_0%]');
    expectNoPassControl();
    expect(askedForPasses(fn)).toEqual([]);
  });

  it('AC-REQ-14-06-01: the merchant dashboard has no NEAR panel and asks for no merchant passes', async () => {
    const fn = stubFetch(routes);
    await refreshNearAccount();
    renderAt(`/merchant/${MID}`);
    expect(await screen.findByRole('heading', { name: 'Offers' })).toBeInTheDocument();
    expectNoPassControl();
    expect(askedForPasses(fn)).toEqual([]);
  });

  it('AC-REQ-14-06-01: an answer that cannot be read counts as passes off', async () => {
    const fn = stubFetch({ ...routes, 'GET /api/near/account': () => ({ status: 500, body: { success: false, error: { code: 'internal_error', message: 'x' } } }) });
    await refreshNearAccount();
    renderAt('/week');
    expect(await screen.findAllByTestId('appointment-row')).toHaveLength(1);
    expectNoPassControl();
    expect(askedForPasses(fn)).toEqual([]);
  });
});
