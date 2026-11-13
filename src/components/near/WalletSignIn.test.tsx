// @vitest-environment jsdom
// F8.2 (Should; AC-REQ-09-02-01): "Use my NEAR testnet wallet" signs in with NEAR Connect on testnet (no transaction),
// posts the account to the server, and the panel then shows the wallet account. NEAR Connect is mocked: no network.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NearAccountResult } from '@/shared/types';
import { AccountChip } from './AccountChip';
import { refreshNearAccount } from '@/hooks/useNearAccount';

const made: { network?: string }[] = [];
vi.mock('@hot-labs/near-connect', () => ({
  NearConnector: class {
    private handler: ((t: { accounts: { accountId: string }[] }) => void) | null = null;
    constructor(opts: { network?: string }) { made.push(opts); }
    on(event: string, fn: (t: { accounts: { accountId: string }[] }) => void) { if (event === 'wallet:signIn') this.handler = fn; }
    async connect() { this.handler?.({ accounts: [{ accountId: 'alice.testnet' }] }); return {}; }
  },
}));

const demo: NearAccountResult = { passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: `3f2a${'b'.repeat(56)}9c1d`, source: 'demo', explorerUrl: 'https://testnet.near.rocks/account/x' };
const wallet: NearAccountResult = { ...demo, accountId: 'alice.testnet', source: 'wallet', explorerUrl: 'https://testnet.near.rocks/account/alice.testnet' };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); made.length = 0; });

describe('Use my NEAR testnet wallet', () => {
  it('AC-REQ-09-02-01: signs in on testnet, posts the account, and the panel shows the wallet account', async () => {
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
    fireEvent.click(await screen.findByTestId('account-chip'));
    fireEvent.click(await screen.findByRole('button', { name: 'Use my NEAR testnet wallet' }));
    await waitFor(() => expect(screen.getByTestId('account-id')).toHaveTextContent('alice.testnet'));
    expect(made).toEqual([{ network: 'testnet' }]);
    expect(posts).toEqual([{ accountId: 'alice.testnet' }]);
    expect(screen.getByTestId('account-panel')).toHaveTextContent('Your wallet, testnet');
  });
});
