// @vitest-environment jsdom
// The merchant dashboard's NEAR panel (Nearby Passes F10.1 to F11.2; REQ-11-01, REQ-11-02, REQ-11-03, REQ-12-01,
// REQ-12-02): the account, balance, explorer link and Sample label, or the notice; Fund passes with its total; the
// counts per offer and the balance held; Redeem by number; Refund available and Refund expired.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FundPassesResult, MerchantDashboard, MerchantPassesResult, NearAccountResult, PassView, RedeemPassResult, RefundExpiredResult } from '@/shared/types';
import { MERCHANT_PASSES_NOT_SET_UP } from '@/shared/types';
import { AppRoutes } from '@/client/App';
import { refreshNearAccount } from '@/hooks/useNearAccount';

type Reply = { status: number; body: unknown };
type Handler = (init: RequestInit | undefined) => Reply;
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
const ok = (data: unknown, status = 200): Handler => () => ({ status, body: { success: true, data } });

const MID = '00000000-0000-4000-8000-000000000001';
const OID = '00000000-0000-4000-8000-0000000000a1';
const MACCT = 'saguaro-bean.nearby-passes.testnet';
const HOLDER = `3f2a${'b'.repeat(56)}9c1d`;
const account: NearAccountResult = {
  passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: HOLDER, source: 'demo',
  explorerUrl: `https://testnet.near.rocks/account/${HOLDER}`,
};
const dashboard: MerchantDashboard = {
  merchant: {
    id: MID, name: 'Saguaro Bean Co.', type: 'Coffee shop', area: 'near the university', location: { lat: 32.2335, lng: -110.9515 }, isSample: true,
    createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
  },
  offers: [],
};
const pass = (over: Partial<PassView>): PassView => ({
  tokenId: 'pass-7', status: 'Claimed', expired: false, merchantAccountId: MACCT, merchantId: MID, merchantName: 'Saguaro Bean Co.', merchantIsSample: true,
  offerId: OID, title: 'Saguaro Bean Co. pass', description: 'Any drink plus pastry', valueYocto: '100000000000000000000000', valueText: '0.1 testnet NEAR',
  expiresAt: '2026-11-19T16:30:00.000Z', claimedAt: '2026-11-17T16:00:00.000Z', settledAt: null, ownerId: HOLDER,
  mediaUrl: 'http://localhost/passes/pass-7.svg', ownerExplorerUrl: `https://testnet.near.rocks/account/${HOLDER}`, lastTxUrl: null, ...over,
});
const passes: MerchantPassesResult = {
  nearEnabled: true,
  notice: null,
  accountId: MACCT,
  balanceYocto: '4800000000000000000000000',
  balanceText: '4.8 testnet NEAR',
  explorerUrl: `https://testnet.near.rocks/account/${MACCT}`,
  heldYocto: '400000000000000000000000',
  heldText: '0.4 testnet NEAR',
  offers: [{ offerId: OID, offerTitle: 'Any drink plus pastry', open: 3, claimed: 1, redeemed: 2, refunded: 1, heldYocto: '400000000000000000000000', heldText: '0.4 testnet NEAR' }],
  passes: [
    pass({ tokenId: 'pass-9', status: 'Open' }),
    pass({ tokenId: 'pass-8', status: 'Claimed', expired: true, expiresAt: '2026-11-17T15:00:00.000Z' }),
    pass({ tokenId: 'pass-7' }),
  ],
};
const base = (extra: Record<string, Handler> = {}) => ({
  'GET /api/near/account': ok(account),
  [`GET /api/merchants/${MID}/dashboard`]: ok(dashboard),
  [`GET /api/merchants/${MID}/passes`]: ok(passes),
  [`GET /api/merchants/${MID}/sales-feed`]: ok({ merchantId: MID, items: [] }),
  ...extra,
});

async function open(routes: Record<string, Handler>) {
  const fetchFn = stubFetch(routes);
  await refreshNearAccount();
  render(
    <MemoryRouter initialEntries={[`/merchant/${MID}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </MemoryRouter>,
  );
  const panel = await screen.findByTestId('merchant-near-panel');
  return { fetchFn, panel };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('merchant NEAR account (REQ-11-01)', () => {
  it('AC-REQ-11-01-01: the panel shows the testnet account, its balance in testnet NEAR, an explorer link and the Sample label', async () => {
    const { panel } = await open(base());
    expect(await within(panel).findByTestId('near-account-id')).toHaveTextContent(MACCT);
    expect(within(panel).getByTestId('near-balance')).toHaveTextContent('4.8 testnet NEAR');
    expect(within(panel).getByRole('link', { name: /See the account on the explorer/ })).toHaveAttribute('href', `https://testnet.near.rocks/account/${MACCT}`);
    expect(within(panel).getByRole('heading', { name: /Passes on NEAR/ })).toHaveTextContent('Sample');
  });

  it('AC-REQ-11-01-02: a merchant with no NEAR account reads "Passes are set up for four sample merchants in this demo." and offers no pass control', async () => {
    const { panel } = await open(
      base({
        [`GET /api/merchants/${MID}/passes`]: ok({ nearEnabled: false, notice: MERCHANT_PASSES_NOT_SET_UP, accountId: null, balanceYocto: null, balanceText: null, explorerUrl: null, heldYocto: '0', heldText: '0 testnet NEAR', offers: [], passes: [] }),
      }),
    );
    expect(await within(panel).findByTestId('near-not-set-up')).toHaveTextContent('Passes are set up for four sample merchants in this demo.');
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
  });
});

describe('fund passes (REQ-11-02)', () => {
  it('AC-REQ-11-02-01: Fund passes offers 1 to 5, 0.05/0.1/0.25 testnet NEAR and 5 minutes/24 hours/7 days, and shows count x cash back plus count x 0.03 storage, refunded if unused', async () => {
    const { panel } = await open(base());
    fireEvent.click(await within(panel).findByRole('button', { name: 'Fund passes for Any drink plus pastry' }));
    const form = within(panel).getByTestId('fund-form');
    const group = (name: string) => within(within(form).getByRole('group', { name })).getAllByRole('button').map((b) => b.textContent);
    expect(group('How many passes')).toEqual(['1', '2', '3', '4', '5']);
    expect(group('Cash back each')).toEqual(['0.05 testnet NEAR', '0.1 testnet NEAR', '0.25 testnet NEAR']);
    expect(group('Expires after')).toEqual(['5 minutes', '24 hours', '7 days']);
    // 3 x 0.1 + 3 x 0.03
    expect(within(form).getByTestId('fund-total')).toHaveTextContent('Total: 0.39 testnet NEAR');
    expect(form).toHaveTextContent('0.3 testnet NEAR in cash back and 0.09 testnet NEAR storage deposit. Unused storage is refunded.');
    fireEvent.click(within(form).getByRole('button', { name: '5' }));
    fireEvent.click(within(form).getByRole('button', { name: '0.25 testnet NEAR' }));
    expect(within(form).getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');
    // 5 x 0.25 + 5 x 0.03
    expect(within(form).getByTestId('fund-total')).toHaveTextContent('Total: 1.4 testnet NEAR');
    fireEvent.click(within(form).getByRole('button', { name: '1' }));
    fireEvent.click(within(form).getByRole('button', { name: '0.05 testnet NEAR' }));
    expect(within(form).getByTestId('fund-total')).toHaveTextContent('Total: 0.08 testnet NEAR');
  });

  it('AC-REQ-11-02-02: Fund posts only { count, cashBack, expiry } and shows the new passes as Open with the transaction link', async () => {
    let body: unknown;
    const funded: FundPassesResult = {
      tokenIds: ['pass-10', 'pass-11'],
      passes: [pass({ tokenId: 'pass-10', status: 'Open', ownerId: 'contract.nearby-passes.testnet' }), pass({ tokenId: 'pass-11', status: 'Open' })],
      depositYocto: '260000000000000000000000',
      depositText: '0.26 testnet NEAR',
      txHash: 'MINTTX',
      txUrl: 'https://testnet.near.rocks/tx/MINTTX',
    };
    const { panel } = await open(
      base({
        [`POST /api/merchants/${MID}/offers/${OID}/passes`]: (init) => {
          body = JSON.parse(String(init?.body));
          return { status: 201, body: { success: true, data: funded } };
        },
      }),
    );
    fireEvent.click(await within(panel).findByRole('button', { name: 'Fund passes for Any drink plus pastry' }));
    const form = within(panel).getByTestId('fund-form');
    fireEvent.click(within(form).getByRole('button', { name: '2' }));
    fireEvent.click(within(form).getByRole('button', { name: '5 minutes' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Fund' }));
    const note = await within(panel).findByTestId('funded');
    expect(body).toEqual({ count: 2, cashBack: '0.1', expiry: '5m' });
    expect(note).toHaveTextContent('pass-10 Open');
    expect(note).toHaveTextContent('pass-11 Open');
    expect(within(note).getByRole('link', { name: /See the transaction on the explorer/ })).toHaveAttribute('href', 'https://testnet.near.rocks/tx/MINTTX');
  });
});

describe('pass inventory (REQ-11-03)', () => {
  it('AC-REQ-11-03-01: each seeded offer shows Open, Claimed, Redeemed and Refunded, and the balance the contract still holds', async () => {
    const { panel } = await open(base());
    const offer = await within(panel).findByTestId('offer-passes');
    expect(within(offer).getByText('Any drink plus pastry')).toBeInTheDocument();
    for (const [k, v, label] of [['open', '3', 'Open'], ['claimed', '1', 'Claimed'], ['redeemed', '2', 'Redeemed'], ['refunded', '1', 'Refunded']] as const) {
      const dd = within(offer).getByTestId(`count-${k}`);
      expect(dd).toHaveTextContent(v);
      expect(dd.previousElementSibling).toHaveTextContent(label);
    }
    expect(within(panel).getByTestId('near-held')).toHaveTextContent('0.4 testnet NEAR');
  });
});

describe('redeem (REQ-12-01)', () => {
  it('AC-REQ-12-01-01: typing 7 looks up pass-7 and shows its merchant, offer, status, expiry and holder', async () => {
    const fetchFn = (await open(base({ 'GET /api/passes/pass-7': ok(pass({})) }))).fetchFn;
    const panel = screen.getByTestId('merchant-near-panel');
    fireEvent.change(await within(panel).findByLabelText('Pass number'), { target: { value: '7' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    const found = await within(panel).findByTestId('redeem-lookup');
    expect(fetchFn.mock.calls.map(([u]) => String(u))).toContain('/api/passes/pass-7');
    expect(found).toHaveTextContent('Saguaro Bean Co.');
    expect(found).toHaveTextContent('Any drink plus pastry');
    expect(within(found).getByTestId('redeem-status')).toHaveTextContent('Claimed');
    expect(found).toHaveTextContent('Thu, Nov 19, 9:30 AM');
    expect(within(found).getByTestId('redeem-holder')).toHaveTextContent(HOLDER);
  });

  it('AC-REQ-12-01-01: pass-7 is accepted as typed; a not-found number shows the server\'s words', async () => {
    await open(base({ 'GET /api/passes/pass-70': () => ({ status: 404, body: { success: false, error: { code: 'not_found', message: 'No pass has this number.' } } }) }));
    const panel = screen.getByTestId('merchant-near-panel');
    fireEvent.change(await within(panel).findByLabelText('Pass number'), { target: { value: 'pass-70' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('No pass has this number.');
  });

  it('AC-REQ-12-01-02: Redeem posts to the redeem route and shows "Redeemed. 0.1 testnet NEAR sent to the holder." with the transaction link', async () => {
    const redeemed: RedeemPassResult = {
      pass: pass({ status: 'Redeemed', lastTxUrl: 'https://testnet.near.rocks/tx/REDEEMTX' }),
      message: 'Redeemed. 0.1 testnet NEAR sent to the holder.',
      txHash: 'REDEEMTX',
      txUrl: 'https://testnet.near.rocks/tx/REDEEMTX',
    };
    let posted = false;
    await open(
      base({
        'GET /api/passes/pass-7': ok(pass({})),
        [`POST /api/merchants/${MID}/passes/pass-7/redeem`]: () => {
          posted = true;
          return { status: 200, body: { success: true, data: redeemed } };
        },
      }),
    );
    const panel = screen.getByTestId('merchant-near-panel');
    fireEvent.change(await within(panel).findByLabelText('Pass number'), { target: { value: 'pass-7' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Look up' }));
    fireEvent.click(await within(panel).findByRole('button', { name: 'Redeem' }));
    const done = await within(panel).findByTestId('redeemed');
    expect(posted).toBe(true);
    expect(done).toHaveTextContent('Redeemed. 0.1 testnet NEAR sent to the holder.');
    expect(within(done).getByRole('link', { name: /See the transaction on the explorer/ })).toHaveAttribute('href', 'https://testnet.near.rocks/tx/REDEEMTX');
    expect(within(panel).queryByRole('button', { name: 'Redeem' })).toBeNull();
  });
});

describe('refund expired (REQ-12-02)', () => {
  it('AC-REQ-12-02-01: an expired Open or Claimed pass shows "Refund available"; Refund expired posts and shows each refunded pass with its link and the new balance', async () => {
    const refunded: RefundExpiredResult = {
      refunded: [{ tokenId: 'pass-8', valueText: '0.1 testnet NEAR', txHash: 'REFUNDTX', txUrl: 'https://testnet.near.rocks/tx/REFUNDTX' }],
      balanceText: '4.9 testnet NEAR',
    };
    let posted = 0;
    const { panel } = await open(
      base({
        [`POST /api/merchants/${MID}/passes/refund-expired`]: () => {
          posted += 1;
          return { status: 200, body: { success: true, data: refunded } };
        },
      }),
    );
    const rows = await within(panel).findAllByTestId('merchant-pass');
    const row8 = rows.find((r) => r.textContent?.includes('pass-8'));
    expect(row8 && within(row8).getByTestId('refund-available')).toHaveTextContent('Refund available');
    // not expired: no refund
    const row7 = rows.find((r) => r.textContent?.includes('pass-7'));
    expect(row7 && within(row7).queryByTestId('refund-available')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Refund expired' }));
    const done = await within(panel).findByTestId('refunded');
    expect(posted).toBe(1);
    expect(done).toHaveTextContent('pass-8 refunded, 0.1 testnet NEAR back to the merchant account.');
    expect(within(done).getByRole('link', { name: /Transaction/ })).toHaveAttribute('href', 'https://testnet.near.rocks/tx/REFUNDTX');
    expect(done).toHaveTextContent('Account balance now: 4.9 testnet NEAR');
    await waitFor(() => expect(within(panel).getByTestId('near-balance')).toBeInTheDocument());
  });
});
