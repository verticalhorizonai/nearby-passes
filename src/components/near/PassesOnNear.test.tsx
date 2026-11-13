// @vitest-environment jsdom
// The home page's "Passes on NEAR" (Nearby Passes F12.1, F12.2; REQ-13-01, REQ-13-02): How to test passes as numbered
// steps, and What the agent can do read live from GET /api/near/agent, with the table of spec 3.5 and its links.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AgentKeysResult, NearAccountResult } from '@/shared/types';
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
  passesEnabled: true, claimsAvailable: true, unavailableReason: null, network: 'testnet', accountId: ACCOUNT, source: 'demo',
  explorerUrl: `https://testnet.near.rocks/account/${ACCOUNT}`,
};
const agent: AgentKeysResult = {
  accountId: 'agent.nearby-passes.testnet',
  explorerUrl: 'https://testnet.near.rocks/account/agent.nearby-passes.testnet',
  contractId: 'contract.nearby-passes.testnet',
  contractSourceUrl: 'https://github.com/verticalhorizonai/nearby-passes/tree/main/contracts/passes',
  claimsPaused: false,
  keys: [
    {
      publicKey: 'ed25519:AgentPublicKey',
      kind: 'function_call',
      receiverId: 'contract.nearby-passes.testnet',
      methodNames: ['claim_pass'],
      allowanceYocto: '2990000000000000000000000',
      allowanceText: '2.99 testnet NEAR',
    },
  ],
};

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('How to test passes (REQ-13-01)', () => {
  it('AC-REQ-13-01-01: the home page carries "Passes on NEAR" with "How to test passes" as numbered steps: shopper seat, the Tuesday 9:30 stop and the Saguaro Bean pass, Saguaro Bean Co. redeems the number, the explorer links', async () => {
    stubFetch({ 'GET /api/near/account': ok(account), 'GET /api/near/agent': ok(agent) });
    await refreshNearAccount();
    renderHome();
    const section = await screen.findByTestId('passes-on-near');
    expect(within(section).getByRole('heading', { level: 2, name: 'Passes on NEAR' })).toBeInTheDocument();
    const howTo = within(section).getByTestId('how-to-test-passes');
    expect(within(howTo).getByRole('heading', { name: 'How to test passes' })).toBeInTheDocument();
    const steps = within(howTo).getAllByRole('listitem');
    expect(howTo.querySelector('ol')).not.toBeNull();
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent(/Step 1\..*Take the shopper seat/);
    expect(steps[1]).toHaveTextContent('Open the Tuesday 9:30 stop and claim the Saguaro Bean pass.');
    expect(steps[2]).toHaveTextContent('Switch seat to Saguaro Bean Co., type the pass number and redeem.');
    expect(steps[3]).toHaveTextContent('Follow the links to see each transaction on the explorer.');
    expect(within(howTo).getByRole('link', { name: 'Choose a seat' })).toHaveAttribute('href', '/seats');
  });
});

describe('What the agent can do (REQ-13-02)', () => {
  it('AC-REQ-13-02-01: lists the key as read now (one key, its contract, its one method claim_pass, its allowance left in testnet NEAR), the table of 3.5, the agent account on the explorer and the contract source', async () => {
    const fetchFn = stubFetch({ 'GET /api/near/account': ok(account), 'GET /api/near/agent': ok(agent) });
    await refreshNearAccount();
    renderHome();
    const box = await screen.findByTestId('what-the-agent-can-do');
    expect(within(box).getByRole('heading', { name: /What the agent can do/ })).toBeInTheDocument();
    const keys = await within(box).findAllByTestId('agent-key');
    expect(keys).toHaveLength(1);
    expect(box).toHaveTextContent('holds one key');
    expect(within(keys[0]).getByText('Function-call key')).toBeInTheDocument();
    expect(within(keys[0]).getByTestId('agent-key-contract')).toHaveTextContent('contract.nearby-passes.testnet');
    expect(within(keys[0]).getByTestId('agent-key-methods')).toHaveTextContent(/^claim_pass$/);
    expect(within(keys[0]).getByTestId('agent-key-allowance')).toHaveTextContent('2.99 testnet NEAR');
    expect(within(box).getByRole('link', { name: /The agent account on the explorer/ })).toHaveAttribute('href', 'https://testnet.near.rocks/account/agent.nearby-passes.testnet');
    expect(within(box).getByRole('link', { name: /The contract’s source/ })).toHaveAttribute('href', agent.contractSourceUrl);
    expect(fetchFn.mock.calls.map(([u]) => String(u))).toContain('/api/near/agent');

    const table = screen.getByTestId('agent-limits');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("Which contract can the agent call?The passes contract onlyThe function-call key's receiver");
    expect(rows[1]).toHaveTextContent("Which method?claim_pass onlyThe key's method list");
    expect(rows[2]).toHaveTextContent('Can it move NEAR?No. A function-call key cannot attach a depositThe protocol');
    expect(rows[3]).toHaveTextContent("How much gas can it spend?The key's allowance, 3 NEAR, which cannot be raisedThe protocol");
    expect(rows[7]).toHaveTextContent("Can the model reach the key?No. Claude has no claim tool; the claim route needs the shopper's single-use tokenThe app");
  });

  it('AC-REQ-13-02-01: no contract source link when the server gives none (APP_REPO_URL unset)', async () => {
    stubFetch({ 'GET /api/near/account': ok(account), 'GET /api/near/agent': ok({ ...agent, contractSourceUrl: null }) });
    await refreshNearAccount();
    renderHome();
    const box = await screen.findByTestId('what-the-agent-can-do');
    await within(box).findAllByTestId('agent-key');
    expect(within(box).queryByRole('link', { name: /source/ })).toBeNull();
    expect(within(box).getByRole('link', { name: /The agent account on the explorer/ })).toBeInTheDocument();
  });
});
