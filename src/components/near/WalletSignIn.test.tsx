// @vitest-environment jsdom
// F8.2 (Should; AC-REQ-09-02-01): "Use my NEAR testnet wallet" signs in with NEAR Connect on testnet (no transaction),
// posts the account to the server, and the panel then shows the wallet account. NEAR Connect is mocked: no network.
// Ruling 62: our modal panel made NEAR Connect's popup inert (pointer-events and the focus trap), so the panel closes
// while the wallet is open, does not pull focus back to the chip, and reopens when the sign-in settles.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NearAccountResult } from '@/shared/types';
import { AccountChip } from './AccountChip';
import { refreshNearAccount } from '@/hooks/useNearAccount';

const made: { network?: string }[] = [];
/** The open wallet chooser: the test decides when it answers. */
let gate: { approve: () => void; fail: () => void } | null = null;
vi.mock('@hot-labs/near-connect', () => ({
  NearConnector: class {
    private handler: ((t: { accounts: { accountId: string }[] }) => void) | null = null;
    constructor(opts: { network?: string }) { made.push(opts); }
    on(event: string, fn: (t: { accounts: { accountId: string }[] }) => void) { if (event === 'wallet:signIn') this.handler = fn; }
    connect() {
      return new Promise((resolve, reject) => {
        gate = {
          approve: () => { this.handler?.({ accounts: [{ accountId: 'alice.testnet' }] }); resolve({}); },
          fail: () => reject(new Error('User closed the wallet')),
        };
      });
    }
  },
}));

const demo: NearAccountResult = { passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: `3f2a${'b'.repeat(56)}9c1d`, source: 'demo', explorerUrl: 'https://testnet.near.rocks/account/x' };
const wallet: NearAccountResult = { ...demo, accountId: 'alice.testnet', source: 'wallet', explorerUrl: 'https://testnet.near.rocks/account/alice.testnet' };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); made.length = 0; gate = null; });

async function openPanelAndTapWallet() {
  let current = demo;
  const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/near/account' && init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); current = wallet; return new Response(JSON.stringify({ success: true, data: wallet })); }
    if (path === '/api/near/account') return new Response(JSON.stringify({ success: true, data: current }));
    return new Response('{}', { status: 404 });
  }));
  await refreshNearAccount();
  render(<MemoryRouter><AccountChip /></MemoryRouter>);
  const chip = await screen.findByTestId('account-chip');
  fireEvent.click(chip);
  fireEvent.click(await screen.findByRole('button', { name: 'Use my NEAR testnet wallet' }));
  // The wallet chooser is open: our panel is closed, so the page (and the chooser on it) is not inert.
  await waitFor(() => expect(gate).not.toBeNull());
  await waitFor(() => expect(screen.queryByTestId('account-panel')).not.toBeInTheDocument());
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(document.activeElement).not.toBe(chip);
  return { posts };
}

describe('Use my NEAR testnet wallet', () => {
  it('AC-REQ-09-02-01: the panel closes while the wallet is open, then reopens showing the wallet account', async () => {
    const { posts } = await openPanelAndTapWallet();
    await act(async () => { gate!.approve(); });
    await waitFor(() => expect(screen.getByTestId('account-id')).toHaveTextContent('alice.testnet'));
    expect(screen.getByTestId('account-panel')).toHaveTextContent('Your wallet, testnet');
    expect(made).toEqual([{ network: 'testnet' }]);
    expect(posts).toEqual([{ accountId: 'alice.testnet' }]);
  });
  it('AC-REQ-09-02-01: when the wallet does not connect, the panel reopens with the error line and the demo account', async () => {
    const { posts } = await openPanelAndTapWallet();
    await act(async () => { gate!.fail(); });
    expect(await screen.findByRole('alert')).toHaveTextContent('The wallet did not connect. Nothing changed.');
    expect(screen.getByTestId('account-panel')).toHaveTextContent('Demo account, testnet');
    expect(posts).toEqual([]);
  });
});
