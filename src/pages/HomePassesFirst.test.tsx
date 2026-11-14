// @vitest-environment jsdom
// The home page leads with passes when passes are on (ruling 60, PROPOSED; amends the Home row of the delta spec's
// 3.6.7; REQ-13-01). With passes off the page, the banner and the title are exactly as accepted.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AgentKeysResult, NearAccountResult } from '@/shared/types';
import { DEMONSTRATION_BANNER_TEXT } from '@/shared/types';
import { AppRoutes } from '@/client/App';
import { refreshNearAccount } from '@/hooks/useNearAccount';

const ON: NearAccountResult = { passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: 'a'.repeat(64), source: 'demo', explorerUrl: 'https://testnet.near.rocks/account/x' };
const OFF: NearAccountResult = { passesEnabled: false, claimsAvailable: false, unavailableReason: null, network: null, accountId: null, source: null, explorerUrl: null };
const KEYS: AgentKeysResult = {
  accountId: 'agent.nearby-passes.testnet', explorerUrl: 'https://testnet.near.rocks/account/agent.nearby-passes.testnet', contractId: 'contract.nearby-passes.testnet',
  contractSourceUrl: null, claimsPaused: false,
  keys: [{ publicKey: 'ed25519:K', kind: 'function_call', receiverId: 'contract.nearby-passes.testnet', methodNames: ['claim_pass'], allowanceYocto: '2997000000000000000000000', allowanceText: '2.997 testnet NEAR' }],
};

function stub(account: NearAccountResult) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const data = path === '/api/near/account' ? account : path === '/api/near/agent' ? KEYS : path === '/api/config/public' ? { repoUrl: null, googleMapsBrowserKey: null } : null;
    return data ? new Response(JSON.stringify({ success: true, data })) : new Response('{}', { status: 404 });
  }));
}
async function renderHome(account: NearAccountResult) {
  stub(account);
  await refreshNearAccount();
  document.title = 'Nearby';
  render(<MemoryRouter initialEntries={['/']}><AppRoutes /></MemoryRouter>);
  await screen.findByRole('heading', { level: 1, name: 'The deal that is already on your way.' });
}
const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the home page with passes on (ruling 60)', () => {
  it('the hero leads with passes: eyebrow, text, line, the two buttons, and the example card with the pass', async () => {
    await renderHome(ON);
    await screen.findByText('An AI agent for local offers, with passes on NEAR');
    expect(screen.getByText(/^NEARby reads where your calendar takes you this week and finds merchant offers near your stops\. Claim one as a pass, and NEARby’s agent puts it in your NEAR account: an NFT that holds money and pays you cash back when you show up to use it\.$/)).toBeInTheDocument();
    expect(screen.getByText('No account, no wallet and no setup. Testnet only: testnet NEAR has no value.')).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getAllByRole('link', { name: /Try the demo/ })[0]).toHaveAttribute('href', '/seats');
    expect(within(hero).getByRole('link', { name: 'How to test passes' })).toHaveAttribute('href', '#how-to-test-passes');
    const card = screen.getByRole('img', { name: 'Sample pick card' });
    expect(card).toHaveTextContent('Saguaro Bean Co.');
    expect(card).toHaveTextContent('Sample');
    expect(card).toHaveTextContent('Pass: You get 0.1 testnet NEAR back when you use this offer.');
    expect(card).not.toHaveTextContent('Pass: 0.1 testnet NEAR back');
    expect(card).toHaveTextContent('Claim as pass');
    expect(screen.queryByText('An AI agent for local offers, paid with PayPal')).not.toBeInTheDocument();
  });
  it('the sections in order: How a pass works, Passes on NEAR, then PayPal under one heading, then Bring your own agent last', async () => {
    await renderHome(ON);
    await screen.findByRole('heading', { name: 'How a pass works' });
    await screen.findByRole('heading', { name: 'Passes on NEAR' });
    const order = headings();
    const at = (t: string) => order.indexOf(t);
    expect(at('How a pass works')).toBe(0);
    expect(at('Passes on NEAR')).toBe(1);
    expect(at('Also in the app: pay with PayPal')).toBe(2);
    expect(at('A shopper says yes. A shop sees the sale.')).toBeGreaterThan(2);
    expect(at('Three steps, about two minutes.')).toBeGreaterThan(at('A shopper says yes. A shop sees the sale.'));
    expect(at('Bring your own agent')).toBe(order.length - 1);
    const how = screen.getByRole('heading', { name: 'How a pass works' }).closest('section')!;
    for (const t of ['A shop funds it.', 'The agent claims it for you.', 'You are paid when you show up.']) expect(within(how).getByText(t)).toBeInTheDocument();
    expect(how).toHaveTextContent("Its key can call one method and cannot move money.");
    expect(how).toHaveTextContent('An unused pass returns its balance to the shop after it expires.');
    expect(document.getElementById('how-to-test-passes')).not.toBeNull();
  });
  it('What is real and what is sample gains the two lines; the banner and the title say passes', async () => {
    await renderHome(ON);
    const sample = (await screen.findByRole('heading', { name: 'What is real and what is sample' })).closest('section')!;
    expect(sample).toHaveTextContent('Passes are NFTs on NEAR testnet. Testnet NEAR has no value.');
    expect(sample).toHaveTextContent('The contract, the agent’s key and every transaction are real, on the public testnet, and linked from this page.');
    await waitFor(() => expect(screen.getByRole('note', { name: 'Demonstration notice' })).toHaveTextContent(`${DEMONSTRATION_BANNER_TEXT} Passes run on NEAR testnet.`));
    await waitFor(() => expect(document.title).toBe('NEARby Passes'));
  });
});

describe('the home page with passes off: as accepted', () => {
  it('the hero, the section order, the banner and the title are as today', async () => {
    await renderHome(OFF);
    expect(screen.getByText('An AI agent for local offers, paid with PayPal')).toBeInTheDocument();
    expect(screen.getByText(/^Nearby reads where your calendar takes you this week, finds one or two offers that fit each stop, and tells you why in a sentence\. Say yes once and it pays with PayPal\.$/)).toBeInTheDocument();
    expect(screen.getByText('No account and no setup. One tap puts you in a seat.')).toBeInTheDocument();
    expect(headings()).toEqual(['A shopper says yes. A shop sees the sale.', 'Three steps, about two minutes.', 'What is real and what is sample', 'How to test', 'Bring your own agent']);
    expect(screen.getByRole('img', { name: 'Sample pick card' })).not.toHaveTextContent('Claim as pass');
    expect(screen.getByRole('note', { name: 'Demonstration notice' }).textContent).toBe(DEMONSTRATION_BANNER_TEXT);
    expect(document.title).toBe('Nearby');
    expect(screen.queryByText(/NEAR/)).not.toBeInTheDocument();
  });
});
