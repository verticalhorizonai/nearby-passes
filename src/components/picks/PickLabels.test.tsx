// @vitest-environment jsdom
// The pick card's buttons while passes are on (ruling 67, the spec owner's decision): "Yes" reads "Buy now" and
// "Not now" reads "Hide pick"; on a card with an open pass, Claim as pass is the filled button and Buy now the outlined
// one. The texts that name those buttons follow. With passes off the card is exactly as accepted.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Toaster } from 'sonner';
import type { AppointmentPicks, NearAccountResult, Pick } from '@/shared/types';
import { refreshNearAccount } from '@/hooks/useNearAccount';
import { PickCard } from './PickCard';
import { PicksPanel } from './PicksPanel';
import { HeroDrawing } from '@/components/home/HeroDrawing';

const ON: NearAccountResult = { passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: 'a'.repeat(64), source: 'demo', explorerUrl: 'https://testnet.near.rocks/account/x' };
const OFF: NearAccountResult = { passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null };
const APPT = '3f6b1c2e-8a4d-4f7e-9b1a-2c5d6e7f8a90';
const pick: Pick = {
  proposalId: 'p-1', merchantId: 'm1', merchantName: 'Saguaro Bean Co.', merchantIsSample: true, offerId: 'o1', offerTitle: 'Any drink plus pastry',
  priceCents: 600, regularPriceCents: null, validWindow: { validDays: ['mon', 'tue', 'wed', 'thu', 'fri'], validStartTime: '07:00', validEndTime: '11:00' },
  reason: 'Saguaro Bean is two blocks from your 9:30 and the deal runs until 11.', distanceMeters: 322, score: 0.9, source: 'agent', status: 'proposed',
  purchased: false, pass: null, passClaim: null,
};
const withPass: Pick = { ...pick, pass: { openCount: 3, cashBackYocto: '100000000000000000000000', cashBackText: '0.1 testnet NEAR', expiresAt: '2026-11-19T16:30:00.000Z' } };
const SUFFIX = ', Any drink plus pastry from Saguaro Bean Co.';

async function passes(account: NearAccountResult, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    const data = key === 'GET /api/near/account' ? account : extra[key];
    return data !== undefined ? new Response(JSON.stringify({ success: true, data })) : new Response('{}', { status: 404 });
  }));
  await refreshNearAccount();
}
const card = (p: Pick) => render(<PickCard pick={p} onYes={() => undefined} onNotNow={() => undefined} onClaimPass={() => undefined} />);
const buttonTexts = () => screen.getAllByRole('button').map((b) => b.textContent);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the pick card with passes on (ruling 67)', () => {
  it('a card with an open pass: Buy now (outlined), Claim as pass (filled), Hide pick, in that order', async () => {
    await passes(ON);
    card(withPass);
    const buy = await screen.findByRole('button', { name: `Buy now${SUFFIX}` });
    const claim = screen.getByRole('button', { name: `Claim as pass${SUFFIX}` });
    const hide = screen.getByRole('button', { name: `Hide pick${SUFFIX}` });
    expect(buttonTexts()).toEqual(['Buy now', 'Claim as pass', 'Hide pick']);
    expect(claim).toHaveClass('bg-primary');
    expect(buy).not.toHaveClass('bg-primary');
    expect(buy).toHaveClass('bg-secondary');
    for (const b of [buy, claim, hide]) expect(b).toHaveClass('h-12');
  });
  it('a card with no pass: Buy now (filled) and Hide pick', async () => {
    await passes(ON);
    card(pick);
    const buy = await screen.findByRole('button', { name: `Buy now${SUFFIX}` });
    expect(buy).toHaveClass('bg-primary');
    expect(buttonTexts()).toEqual(['Buy now', 'Hide pick']);
  });
  it('a pick said yes to and not paid tells the shopper to tap Buy now', async () => {
    await passes(ON);
    card({ ...pick, status: 'accepted', acceptIntent: 'paypal' });
    expect(await screen.findByTestId('pick-status')).toHaveTextContent('You said yes to this pick. Tap Buy now to pay with PayPal.');
  });
  it('the panel: the line under the cards names Buy now, and Hide pick says "Pick hidden for this stop."', async () => {
    const list: AppointmentPicks = { appointmentId: APPT, picks: [pick], noMatch: false };
    await passes(ON, { [`GET /api/appointments/${APPT}/picks`]: list, 'POST /api/proposals/p-1/decline': { id: 'p-1', status: 'declined' } });
    render(<><PicksPanel appointmentId={APPT} redirect={vi.fn()} /><Toaster /></>);
    expect(await screen.findByText('Nothing is bought until you tap Buy now and approve it on PayPal.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Hide pick${SUFFIX}` }));
    expect(await screen.findByText('Pick hidden for this stop.')).toBeInTheDocument();
  });
  it('the sample card in the hero shows Buy now (outlined), Claim as pass (filled) and Hide pick', async () => {
    await passes(ON);
    const { container } = render(<HeroDrawing withPass />);
    await waitFor(() => expect(container).toHaveTextContent('Buy now'));
    const spans = [...container.querySelectorAll('span')];
    const buy = spans.find((s) => s.textContent === 'Buy now')!;
    const claim = spans.find((s) => s.textContent === 'Claim as pass')!;
    expect(claim).toHaveClass('bg-primary');
    expect(buy).not.toHaveClass('bg-primary');
    expect(container).toHaveTextContent('Hide pick');
    expect(container).not.toHaveTextContent(/\bYes\b|Not now/);
  });
});

describe('the pick card with passes off (as accepted)', () => {
  it('Yes (filled) and Not now; the line under the cards names Yes', async () => {
    await passes(OFF);
    card(pick);
    await new Promise((r) => setTimeout(r, 20));
    const yes = screen.getByRole('button', { name: `Yes${SUFFIX}` });
    expect(yes).toHaveClass('bg-primary');
    expect(buttonTexts()).toEqual(['Yes', 'Not now']);
  });
  it('the hero sample card keeps Yes and Not now', async () => {
    await passes(OFF);
    const { container } = render(<HeroDrawing withPass={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toHaveTextContent('Yes');
    expect(container).toHaveTextContent('Not now');
  });
});
