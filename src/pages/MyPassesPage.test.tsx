// @vitest-environment jsdom
// My passes and the My week pill (Nearby Passes F8.5, F9.1 to F9.3; REQ-09-05, REQ-10-01, REQ-10-02, REQ-10-03): each
// pass with its image, merchant and Sample, offer, balance, status, expiry, number and explorer link; the number in
// large type at the counter; a redeemed pass paid; "1 pass" beside the stop on My week with a link to My passes.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NearAccountResult, PassView, UpcomingAppointment } from '@/shared/types';
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

const ACCOUNT = `3f2a${'b'.repeat(56)}9c1d`;
const account: NearAccountResult = {
  passesEnabled: true,
  claimsAvailable: true,
  unavailableReason: null,
  network: 'testnet',
  accountId: ACCOUNT,
  source: 'demo',
  explorerUrl: `https://testnet.near.rocks/account/${ACCOUNT}`,
};
const pass = (over: Partial<PassView>): PassView => ({
  tokenId: 'pass-7',
  status: 'Claimed',
  expired: false,
  merchantAccountId: 'saguaro-bean.nearby-passes.testnet',
  merchantId: 'm1',
  merchantName: 'Saguaro Bean Co.',
  merchantIsSample: true,
  offerId: 'o1',
  title: 'Saguaro Bean Co. pass',
  description: 'Any drink plus pastry. Sample merchant. Testnet only.',
  valueYocto: '100000000000000000000000',
  valueText: '0.1 testnet NEAR',
  expiresAt: '2026-11-19T16:30:00.000Z',
  claimedAt: '2026-11-17T16:00:00.000Z',
  settledAt: null,
  ownerId: ACCOUNT,
  mediaUrl: 'http://localhost/passes/pass-7.svg',
  ownerExplorerUrl: `https://testnet.near.rocks/account/${ACCOUNT}`,
  lastTxUrl: 'https://testnet.near.rocks/tx/CLAIMTX',
  ...over,
});

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

describe('My passes (REQ-10-01)', () => {
  it('AC-REQ-10-01-01: each pass shows its live image, merchant with Sample, offer, balance in testnet NEAR, status, expiry, number and explorer link, from GET /api/passes/mine', async () => {
    const fetchFn = stubFetch({
      'GET /api/near/account': ok(account),
      'GET /api/passes/mine': ok({ accountId: ACCOUNT, passes: [pass({}), pass({ tokenId: 'pass-9', mediaUrl: 'http://localhost/passes/pass-9.svg', merchantName: 'Rillito Tacos', description: 'Free horchata with two tacos', status: 'Open', lastTxUrl: null })] }),
    });
    await refreshNearAccount();
    renderAt('/passes');
    expect(await screen.findByRole('heading', { level: 1, name: 'My passes' })).toBeInTheDocument();
    const cards = await screen.findAllByTestId('pass-card');
    expect(cards).toHaveLength(2);
    const c = within(cards[0]);
    expect(c.getByTestId('pass-image')).toHaveAttribute('src', 'http://localhost/passes/pass-7.svg');
    expect(c.getByTestId('pass-image')).toHaveAttribute('alt', expect.stringContaining('pass-7'));
    expect(c.getByRole('heading', { name: /Saguaro Bean Co\./ })).toHaveTextContent('Sample');
    expect(cards[0]).toHaveTextContent('Any drink plus pastry');
    expect(cards[0]).not.toHaveTextContent('Testnet only.');
    expect(c.getByTestId('pass-balance')).toHaveTextContent('0.1 testnet NEAR');
    expect(c.getByTestId('pass-status')).toHaveTextContent('Claimed');
    expect(cards[0]).toHaveTextContent('Thu, Nov 19, 9:30 AM');
    expect(c.getByTestId('pass-card-number')).toHaveTextContent('pass-7');
    expect(c.getByRole('link', { name: /See the transaction on the explorer/ })).toHaveAttribute('href', 'https://testnet.near.rocks/tx/CLAIMTX');
    // with no transaction the app sent, the link is the holder's account (ruling 49(b))
    expect(within(cards[1]).getByRole('link', { name: /See the account on the explorer/ })).toHaveAttribute('href', `https://testnet.near.rocks/account/${ACCOUNT}`);
    const gets = fetchFn.mock.calls.map(([u]) => String(u));
    expect(gets).toContain('/api/passes/mine');
  });

  it('AC-REQ-10-01-01: no passes yet says so plainly', async () => {
    stubFetch({ 'GET /api/near/account': ok(account), 'GET /api/passes/mine': ok({ accountId: ACCOUNT, passes: [] }) });
    await refreshNearAccount();
    renderAt('/passes');
    expect(await screen.findByTestId('passes-empty')).toHaveTextContent('No passes yet.');
  });
});

describe('Show at the counter (REQ-10-02)', () => {
  it('AC-REQ-10-02-01: opening a pass shows its number in the system monospaced font, larger than any other text on the view, with the merchant and offer under it', async () => {
    stubFetch({ 'GET /api/near/account': ok(account), 'GET /api/passes/mine': ok({ accountId: ACCOUNT, passes: [pass({})] }) });
    await refreshNearAccount();
    renderAt('/passes');
    fireEvent.click(await screen.findByRole('button', { name: 'Show pass pass-7' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your pass' });
    const number = within(dialog).getByTestId('pass-number');
    expect(number).toHaveTextContent('pass-7');
    expect(number).toHaveClass('font-mono', 'text-[36px]');
    // the largest text on the view: every other size used in it is smaller than 36 px
    const sizes = Array.from(dialog.querySelectorAll('*')).flatMap((el) => Array.from(el.classList)).filter((c) => /^text-(\[\d+px\]|xs|sm|base|lg|xl|2xl|price|code|label|badge)$/.test(c));
    const px: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20, 'text-2xl': 24, 'text-price': 24, 'text-code': 28, 'text-label': 13, 'text-badge': 11 };
    const others = sizes.filter((c) => c !== 'text-[36px]').map((c) => px[c] ?? Number(/\[(\d+)px\]/.exec(c)?.[1]));
    expect(Math.max(...others)).toBeLessThan(36);
    // merchant and offer under the number
    const merchant = within(dialog).getByTestId('pass-merchant');
    const offer = within(dialog).getByTestId('pass-offer');
    expect(merchant).toHaveTextContent('Saguaro Bean Co.');
    expect(offer).toHaveTextContent('Any drink plus pastry');
    expect(number.compareDocumentPosition(merchant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(merchant.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Paid (REQ-10-03)', () => {
  it('AC-REQ-10-03-01: a redeemed pass shows Redeemed and "0.1 testnet NEAR paid to your account" with the redeem transaction', async () => {
    stubFetch({
      'GET /api/near/account': ok(account),
      'GET /api/passes/mine': ok({ accountId: ACCOUNT, passes: [pass({ status: 'Redeemed', settledAt: '2026-11-17T17:00:00.000Z', lastTxUrl: 'https://testnet.near.rocks/tx/REDEEMTX' })] }),
    });
    await refreshNearAccount();
    renderAt('/passes');
    const card = await screen.findByTestId('pass-card');
    expect(within(card).getByTestId('pass-status')).toHaveTextContent('Redeemed');
    expect(within(card).getByTestId('pass-paid')).toHaveTextContent('0.1 testnet NEAR paid to your account');
    expect(within(card).getByRole('link', { name: /See the transaction on the explorer/ })).toHaveAttribute('href', 'https://testnet.near.rocks/tx/REDEEMTX');
  });

  it('AC-REQ-10-03-01: redeemed with no transaction the app sent links the account on the explorer; the amount is the pass\'s own', async () => {
    stubFetch({
      'GET /api/near/account': ok(account),
      'GET /api/passes/mine': ok({ accountId: ACCOUNT, passes: [pass({ status: 'Redeemed', valueText: '0.25 testnet NEAR', lastTxUrl: null })] }),
    });
    await refreshNearAccount();
    renderAt('/passes');
    const card = await screen.findByTestId('pass-card');
    expect(within(card).getByTestId('pass-paid')).toHaveTextContent('0.25 testnet NEAR paid to your account');
    expect(within(card).getByRole('link', { name: /See the account on the explorer/ })).toHaveAttribute('href', `https://testnet.near.rocks/account/${ACCOUNT}`);
  });
});

describe('My week counts the stop\'s passes (REQ-09-05)', () => {
  const appt = (id: string, title: string, passCount: number): UpcomingAppointment => ({
    id,
    title,
    startsAt: '2026-11-17T16:30:00.000Z',
    endsAt: '2026-11-17T17:30:00.000Z',
    address: `${title} address, Tucson`,
    location: { lat: 32.2319, lng: -110.9535 },
    enabled: false,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    boughtCount: 1,
    passCount,
  });
  const routes = (appointments: UpcomingAppointment[]) => ({
    'GET /api/near/account': ok(account),
    'GET /api/calendar/connection': ok({ calendarName: 'Demo calendar', upcomingAppointmentCount: 3, connectedAt: '2026-11-11T17:00:00.000Z' }),
    'GET /api/appointments/upcoming': ok({ appointments, skippedEvents: [] }),
  });

  it('AC-REQ-09-05-02: "1 pass" and "2 passes" beside the title in the "1 bought" pill\'s style, with a spoken name; nothing at 0; a link to My passes', async () => {
    stubFetch(routes([
      appt('11111111-1111-4111-8111-111111111111', 'Client meeting', 1),
      appt('22222222-2222-4222-8222-222222222222', 'Lunch with a partner', 2),
      appt('33333333-3333-4333-8333-333333333333', 'Workshop', 0),
    ]));
    await refreshNearAccount();
    renderAt('/week');
    const pills = await screen.findAllByTestId('pass-pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent('1 pass');
    expect(pills[0]).toHaveTextContent('1 pass claimed for this stop');
    expect(pills[1]).toHaveTextContent('2 passes');
    expect(pills[1]).toHaveTextContent('2 passes claimed for this stop');
    const bought = screen.getAllByTestId('bought-pill')[0];
    expect(pills[0].className).toBe(bought.className);
    // beside the title, on the title's one line, so the card keeps its height
    expect(pills[0].parentElement).toBe(bought.parentElement);
    expect(pills[0].parentElement?.firstElementChild).toHaveClass('truncate');
    const rows = screen.getAllByTestId('appointment-row');
    expect(rows[2].querySelector('[data-testid="pass-pill"]')).toBeNull();
    expect(within(screen.getByTestId('my-passes-link')).getByRole('link', { name: 'My passes' })).toHaveAttribute('href', '/passes');
    // Ruling 69: an outlined button (the pick card's secondary style) with the ticket icon, first on its line, at least
    // 44 px tall; the sentence follows it as a caption in the secondary text style.
    const line = screen.getByTestId('my-passes-link');
    const link = within(line).getByRole('link', { name: 'My passes' });
    expect(line.firstElementChild).toBe(link);
    expect(link).toHaveClass('border', 'border-outline-border', 'bg-secondary', 'min-h-touch', 'rounded-full');
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(link).toHaveTextContent(/^My passes$/);
    const caption = link.nextElementSibling as HTMLElement;
    expect(caption).toHaveTextContent(/^Passes you claim are kept on NEAR testnet\.$/);
    expect(caption).toHaveClass('text-secondary-text');
  });
});
