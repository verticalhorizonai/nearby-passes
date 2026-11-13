// @vitest-environment jsdom
// Claim as pass, end to end in the picks panel (Nearby Passes F8.4; REQ-09-04): accept with intent pass opens the pass
// confirm sheet with its facts and the agent sentence; Yes, claim it posts only the proposal and the token, then shows
// the pass number and the transaction link; a refusal shows the server's plain message and the same token works again.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { AcceptProposalResult, AppointmentPicks, ClaimPassResult, PassView, Pick } from '@/shared/types';
import { PASS_AGENT_SENTENCE } from '@/shared/types';
import { PicksPanel } from '@/components/picks/PicksPanel';

type Reply = { status: number; body: unknown };
type Handler = (init: RequestInit | undefined) => Reply;

function stubFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const h = routes[key];
    const r = h ? h(init) : { status: 404, body: { success: false, error: { code: 'not_found', message: key } } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const ok = (data: unknown, status = 200): Handler => () => ({ status, body: { success: true, data } });
const fail = (status: number, code: string, message: string): Reply => ({ status, body: { success: false, error: { code, message } } });

const APPT = '3f6b1c2e-8a4d-4f7e-9b1a-2c5d6e7f8a90';
const ACCOUNT = `3f2a${'b'.repeat(56)}9c1d`;
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
  pass: { openCount: 3, cashBackYocto: '100000000000000000000000', cashBackText: '0.1 testnet NEAR', expiresAt: '2026-11-19T16:30:00.000Z' },
  passClaim: null,
};
const picks: AppointmentPicks = { appointmentId: APPT, picks: [pick], noMatch: false };

const accept: AcceptProposalResult = {
  confirmSheet: { proposalId: 'p-1', merchantName: 'Saguaro Bean Co.', merchantIsSample: true, offerTitle: 'Any drink plus pastry', priceCents: 600, validWindow: pick.validWindow },
  confirmationToken: 'tok-pass',
  confirmationTokenExpiresAt: '2026-11-17T16:40:00.000Z',
  intent: 'pass',
  passSheet: {
    proposalId: 'p-1',
    merchantName: 'Saguaro Bean Co.',
    merchantIsSample: true,
    offerTitle: 'Any drink plus pastry',
    cashBackText: '0.1 testnet NEAR',
    expiresAt: '2026-11-19T16:30:00.000Z',
    receivingAccountId: ACCOUNT,
    agentSentence: PASS_AGENT_SENTENCE,
  },
};
const claimedView: PassView = {
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
const claimed: ClaimPassResult = { pass: claimedView, txHash: 'CLAIMTX', txUrl: 'https://testnet.near.rocks/tx/CLAIMTX' };

function renderPanel() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PicksPanel appointmentId={APPT} redirect={vi.fn()} />
      <Toaster />
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Claim as pass (REQ-09-04)', () => {
  it('AC-REQ-09-04-01: Claim as pass posts accept with { intent: "pass" } and the sheet shows the merchant with Sample, the cash back, the expiry, the receiving account, the agent sentence, Yes, claim it and Not now', async () => {
    let acceptBody: unknown;
    stubFetch({
      [`GET /api/appointments/${APPT}/picks`]: ok(picks),
      'POST /api/proposals/p-1/accept': (init) => {
        acceptBody = JSON.parse(String(init?.body));
        return { status: 200, body: { success: true, data: accept } };
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Claim as pass/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Claim this pass' });
    expect(acceptBody).toEqual({ intent: 'pass' });
    expect(sheet).toHaveTextContent('Saguaro Bean Co.');
    expect(within(sheet).getByText('Sample')).toBeInTheDocument();
    expect(within(sheet).getByTestId('claim-cash-back')).toHaveTextContent('0.1 testnet NEAR');
    expect(sheet).toHaveTextContent('Expires');
    expect(sheet).toHaveTextContent('Thu, Nov 19, 9:30 AM');
    expect(within(sheet).getByTestId('claim-receiving-account')).toHaveTextContent(ACCOUNT);
    expect(within(sheet).getByTestId('claim-agent-sentence')).toHaveTextContent("Nearby's agent claims it for you. It cannot move money.");
    expect(within(sheet).getByRole('button', { name: 'Yes, claim it' })).toHaveClass('h-12');
    const notNow = within(sheet).getByRole('button', { name: 'Not now' });
    expect(notNow).toHaveClass('h-12');
    fireEvent.click(notNow);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('AC-REQ-09-04-01: the PayPal Yes is unchanged: it posts accept with no intent and opens the PayPal confirm sheet', async () => {
    let acceptBody: unknown;
    stubFetch({
      [`GET /api/appointments/${APPT}/picks`]: ok(picks),
      'POST /api/proposals/p-1/accept': (init) => {
        acceptBody = JSON.parse(String(init?.body));
        return { status: 200, body: { success: true, data: { ...accept, intent: 'paypal', passSheet: null } } };
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Yes/ }));
    expect(await screen.findByRole('dialog', { name: 'Confirm your pick' })).toBeInTheDocument();
    expect(acceptBody).toEqual({});
  });

  it('AC-REQ-09-04-02: Yes, claim it posts only proposalId and confirmationToken; the sheet shows the pass number and the transaction link, and the card turns to Pass claimed', async () => {
    let claimBody: unknown;
    const fetchFn = stubFetch({
      [`GET /api/appointments/${APPT}/picks`]: ok(picks),
      'POST /api/proposals/p-1/accept': ok(accept),
      'POST /api/passes/claim': (init) => {
        claimBody = JSON.parse(String(init?.body));
        return { status: 201, body: { success: true, data: claimed } };
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Claim as pass/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Claim this pass' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, claim it' }));
    const done = await screen.findByRole('dialog', { name: 'Pass claimed' });
    expect(claimBody).toEqual({ proposalId: 'p-1', confirmationToken: 'tok-pass' });
    expect(within(done).getByTestId('claimed-pass-number')).toHaveTextContent('pass-7');
    const tx = within(done).getByRole('link', { name: /See the transaction on the explorer/ });
    expect(tx).toHaveAttribute('href', 'https://testnet.near.rocks/tx/CLAIMTX');
    expect(within(done).getByRole('link', { name: 'My passes' })).toHaveAttribute('href', '/passes');
    fireEvent.click(within(done).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('pick-status')).toHaveTextContent('Pass claimed');
    expect(screen.queryByRole('button', { name: /^Yes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull();
    // no amount, receiver or merchant ever leaves the browser
    const posts = fetchFn.mock.calls.filter(([, i]) => i?.method === 'POST').map(([, i]) => String(i?.body));
    expect(posts.join(' ')).not.toMatch(/cashBack|receiver|amount|merchant/i);
  });

  it('AC-REQ-09-04-02: a 409 shows the server\'s plain message and Yes, claim it tries again with the same token', async () => {
    const bodies: unknown[] = [];
    let n = 0;
    stubFetch({
      [`GET /api/appointments/${APPT}/picks`]: ok(picks),
      'POST /api/proposals/p-1/accept': ok(accept),
      'POST /api/passes/claim': (init) => {
        bodies.push(JSON.parse(String(init?.body)));
        n += 1;
        if (n === 1) return fail(409, 'pass_unavailable', 'No pass is left for this offer right now.');
        if (n === 2) return fail(503, 'near_unavailable', 'The NEAR testnet did not answer. Nothing was claimed. Try again.');
        return { status: 201, body: { success: true, data: claimed } };
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Claim as pass/ }));
    let sheet = await screen.findByRole('dialog', { name: 'Claim this pass' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, claim it' }));
    expect(await within(sheet).findByTestId('claim-error')).toHaveTextContent('No pass is left for this offer right now.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, claim it' }));
    expect(await within(sheet).findByText('The NEAR testnet did not answer. Nothing was claimed. Try again.')).toBeInTheDocument();
    sheet = screen.getByRole('dialog', { name: 'Claim this pass' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, claim it' }));
    expect(await screen.findByTestId('claimed-pass-number')).toHaveTextContent('pass-7');
    expect(bodies).toEqual([
      { proposalId: 'p-1', confirmationToken: 'tok-pass' },
      { proposalId: 'p-1', confirmationToken: 'tok-pass' },
      { proposalId: 'p-1', confirmationToken: 'tok-pass' },
    ]);
  });

  it('AC-REQ-09-04-01: when no pass is left, Claim as pass says so in plain words and the picks are read again', async () => {
    let reads = 0;
    stubFetch({
      [`GET /api/appointments/${APPT}/picks`]: () => {
        reads += 1;
        return { status: 200, body: { success: true, data: reads === 1 ? picks : { ...picks, picks: [{ ...pick, pass: null }] } } };
      },
      'POST /api/proposals/p-1/accept': () => fail(409, 'pass_unavailable', 'No pass is left for this offer right now.'),
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Claim as pass/ }));
    expect(await screen.findByText('No pass is left for this offer right now.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Claim as pass/ })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
