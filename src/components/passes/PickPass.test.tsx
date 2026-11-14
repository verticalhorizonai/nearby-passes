// @vitest-environment jsdom
// A pass on a pick card (Nearby Passes F8.3, F8.5; REQ-09-03, REQ-09-05): the pass line and Claim as pass beside Yes,
// nothing extra without a pass, and the claimed pick with Pass claimed and Show pass instead of any Yes.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PassView, Pick } from '@/shared/types';
import { PickCard } from '@/components/picks/PickCard';

const pick: Pick = {
  proposalId: 'p-1',
  merchantId: 'm1',
  merchantName: 'Saguaro Bean Co.',
  merchantIsSample: true,
  offerId: 'o1',
  offerTitle: 'Any drink plus pastry',
  priceCents: 600,
  regularPriceCents: null,
  validWindow: { validDays: ['mon', 'tue', 'wed', 'thu', 'fri'], validStartTime: '07:00', validEndTime: '11:00' },
  reason: 'Saguaro Bean is two blocks from your 9:30 and the deal runs until 11.',
  distanceMeters: 322,
  score: 0.9,
  source: 'agent',
  status: 'proposed',
  purchased: false,
  pass: null,
  passClaim: null,
};
const withPass: Pick = {
  ...pick,
  pass: { openCount: 3, cashBackYocto: '100000000000000000000000', cashBackText: '0.1 testnet NEAR', expiresAt: '2026-11-19T16:30:00.000Z' },
};
const ACCOUNT = `3f2a${'b'.repeat(56)}9c1d`;
const view: PassView = {
  tokenId: 'pass-7',
  status: 'Claimed',
  expired: false,
  merchantAccountId: 'saguaro-bean.nearby-passes.testnet',
  merchantId: 'm1',
  merchantName: 'Saguaro Bean Co.',
  merchantIsSample: true,
  offerId: 'o1',
  title: 'Saguaro Bean Co. pass',
  description: 'Any drink plus pastry',
  valueYocto: '100000000000000000000000',
  valueText: '0.1 testnet NEAR',
  expiresAt: '2026-11-19T16:30:00.000Z',
  claimedAt: '2026-11-17T16:00:00.000Z',
  settledAt: null,
  ownerId: ACCOUNT,
  mediaUrl: 'http://localhost/passes/pass-7.svg',
  ownerExplorerUrl: `https://testnet.near.rocks/account/${ACCOUNT}`,
  lastTxUrl: 'https://testnet.near.rocks/tx/CLAIMTX',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a pick with an open pass (REQ-09-03)', () => {
  it('AC-REQ-09-03-01: shows "Pass: You get 0.1 testnet NEAR back when you use this offer." (ruling 71) and Claim as pass beside Yes, 48 px tall', () => {
    const onClaimPass = vi.fn();
    render(<PickCard pick={withPass} onYes={() => undefined} onNotNow={() => undefined} onClaimPass={onClaimPass} />);
    expect(screen.getByTestId('pick-pass-line')).toHaveTextContent(/^Pass: You get 0.1 testnet NEAR back when you use this offer\.$/);
    const claim = screen.getByRole('button', { name: /^Claim as pass/ });
    const yes = screen.getByRole('button', { name: /^Yes/ });
    expect(claim).toHaveTextContent('Claim as pass');
    expect(claim).toHaveClass('h-12');
    expect(claim.className).toMatch(/focus-visible:ring-2/);
    // beside Yes: the same row, right after it
    expect(yes.parentElement).toBe(claim.parentElement);
    expect(yes.nextElementSibling).toBe(claim);
    expect(screen.getByRole('button', { name: /^Not now/ })).toBeInTheDocument();
    fireEvent.click(claim);
    expect(onClaimPass).toHaveBeenCalledWith(withPass);
  });

  it('AC-REQ-09-03-01: the amount is the pass\'s own, as the server wrote it', () => {
    render(
      <PickCard
        pick={{ ...withPass, pass: { ...withPass.pass!, cashBackText: '0.2 testnet NEAR' } }}
        onYes={() => undefined}
        onNotNow={() => undefined}
        onClaimPass={() => undefined}
      />,
    );
    expect(screen.getByTestId('pick-pass-line')).toHaveTextContent(/^Pass: You get 0.2 testnet NEAR back when you use this offer\.$/);
  });
});

describe('a pick with no open pass (REQ-09-03)', () => {
  it('AC-REQ-09-03-02: shows no pass line and no Claim as pass, and keeps Yes twice as wide as Not now', () => {
    render(<PickCard pick={pick} onYes={() => undefined} onNotNow={() => undefined} onClaimPass={() => undefined} />);
    expect(screen.queryByTestId('pick-pass-line')).toBeNull();
    expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Yes/ })).toHaveClass('flex-[2_1_0%]');
    expect(screen.getByRole('button', { name: /^Not now/ })).toHaveClass('flex-[1_1_0%]');
  });

  it('AC-REQ-09-03-02: a bought pick shows no pass line even if its offer has a pass', () => {
    render(<PickCard pick={{ ...withPass, status: 'accepted', purchased: true }} onYes={() => undefined} onNotNow={() => undefined} onClaimPass={() => undefined} />);
    expect(screen.queryByTestId('pick-pass-line')).toBeNull();
    expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull();
  });
});

describe('a claimed pick (REQ-09-05)', () => {
  it('AC-REQ-09-05-01: shows Pass claimed and Show pass, with no Yes, no Claim as pass and no Not now; Show pass opens the pass', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: view }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <PickCard
        pick={{ ...pick, status: 'accepted', passClaim: { status: 'claimed', tokenId: 'pass-7', error: null } }}
        onYes={() => undefined}
        onNotNow={() => undefined}
        onClaimPass={() => undefined}
      />,
    );
    expect(screen.getByTestId('pick-status')).toHaveTextContent('Pass claimed');
    expect(screen.queryByRole('button', { name: /^Yes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Not now/ })).toBeNull();
    const show = screen.getByRole('button', { name: /^Show pass/ });
    expect(show).toHaveTextContent('Show pass');
    expect(show.className).toMatch(/min-h-touch/);
    fireEvent.click(show);
    const dialog = await screen.findByRole('dialog', { name: 'Your pass' });
    expect(await within(dialog).findByTestId('pass-number')).toHaveTextContent('pass-7');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(String(url)).toBe('/api/passes/pass-7');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('AC-REQ-09-05-01: a claim still being confirmed offers no Yes either', () => {
    render(
      <PickCard
        pick={{ ...withPass, status: 'accepted', passClaim: { status: 'pending', tokenId: null, error: null } }}
        onYes={() => undefined}
        onNotNow={() => undefined}
        onClaimPass={() => undefined}
      />,
    );
    expect(screen.getByTestId('pick-pass-pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Yes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull();
  });
});
