// The home page's "Passes on NEAR" section (F12.1, F12.2; REQ-13-01, REQ-13-02; AC-REQ-13-01-01, AC-REQ-13-02-01):
// "How to test passes" as numbered steps, and "What the agent can do": the agent account's keys as the network
// reports them now (GET /api/near/agent: one key, its contract, its one method, its remaining allowance in testnet
// NEAR), the table of spec 3.5, and links to the agent account on the explorer and to the contract's source (only when
// the server gives one). Nothing is drawn while passes are off (AC-REQ-14-06-01).
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AgentKey, AgentKeysResult } from '@/shared/types';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { ExplorerLink } from '@/components/passes/PassDetail';
import { useApiQuery } from '@/hooks/useApi';
import { usePassesOn } from '@/hooks/useNearAccount';

const label = 'text-label uppercase text-secondary-text';

/** Spec 3.5, the security claim, word for word. */
const AGENT_LIMITS: { q: string; a: string; by: string }[] = [
  { q: 'Which contract can the agent call?', a: 'The passes contract only', by: "The function-call key's receiver" },
  { q: 'Which method?', a: '`claim_pass` only', by: "The key's method list" },
  { q: 'Can it move NEAR?', a: 'No. A function-call key cannot attach a deposit', by: 'The protocol' },
  { q: 'How much gas can it spend?', a: "The key's allowance, 3 NEAR, which cannot be raised", by: 'The protocol' },
  { q: 'Can it claim a pass for anyone?', a: 'Only an Open, unexpired pass, one per account per offer', by: 'The contract' },
  { q: 'Can it redeem or refund?', a: "No. Redeem is the merchant's, with a deposit the key cannot attach", by: 'The contract and the protocol' },
  { q: 'Can a person stop it?', a: 'Yes. The owner pauses claiming on chain, or replaces the agent', by: 'The contract' },
  { q: 'Can the model reach the key?', a: "No. Claude has no claim tool; the claim route needs the shopper's single-use token", by: 'The app' },
];

/** `claim_pass` in backticks is drawn as code. */
function withCode(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') ? (
      <code key={i} className="font-mono text-[0.95em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function KeyCard({ k }: { k: AgentKey }) {
  return (
    <li className="flex flex-col gap-2 rounded-panel border border-border bg-background p-4" data-testid="agent-key">
      <p className="m-0 font-semibold">{k.kind === 'function_call' ? 'Function-call key' : 'Full-access key'}</p>
      <dl className="m-0 grid grid-cols-1 gap-2 text-[15px] sm:grid-cols-3">
        <div>
          <dt className="text-[13px] text-secondary-text">Contract</dt>
          <dd className="m-0 break-all font-mono text-[14px]" data-testid="agent-key-contract">
            {k.receiverId ?? 'Any'}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">{k.methodNames.length === 1 ? 'Method' : 'Methods'}</dt>
          <dd className="m-0 font-mono text-[14px]" data-testid="agent-key-methods">
            {k.methodNames.length > 0 ? k.methodNames.join(', ') : 'Any'}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">Gas allowance left</dt>
          <dd className="m-0" data-testid="agent-key-allowance">
            {k.allowanceText ?? 'No limit'}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function AgentKeys() {
  const agent = useApiQuery<AgentKeysResult>('/api/near/agent');
  if (agent.loading && !agent.data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Reading the agent's keys">
        <Skeleton className="h-6 w-64 rounded-tile bg-tint" />
        <Skeleton className="h-24 rounded-panel bg-tint" />
      </div>
    );
  }
  if (agent.error || !agent.data) {
    return <ErrorState title="The agent's keys did not load" message="The NEAR testnet did not answer just now. Try again in a moment." onRetry={agent.reload} />;
  }
  const a = agent.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-body-text">
        The agent account <span className="break-all font-mono text-[15px] text-foreground">{a.accountId}</span> holds{' '}
        {a.keys.length === 1 ? 'one key' : `${a.keys.length} keys`}, read from the network now:
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {a.keys.map((k) => (
          <KeyCard key={k.publicKey} k={k} />
        ))}
      </ul>
      {a.claimsPaused && (
        <p className="m-0 font-semibold text-foreground" data-testid="claims-paused">
          Claiming is paused on the contract right now.
        </p>
      )}
      <div className="flex flex-wrap gap-x-6">
        <ExplorerLink href={a.explorerUrl}>The agent account on the explorer</ExplorerLink>
        {a.contractSourceUrl && <ExplorerLink href={a.contractSourceUrl}>The contract&rsquo;s source</ExplorerLink>}
      </div>
    </div>
  );
}

export function PassesOnNear() {
  const on = usePassesOn();
  if (!on) return null;
  return (
    <section aria-labelledby="passes-heading" className="mx-auto flex max-w-content flex-col gap-8 px-4 pb-20 sm:px-8" data-testid="passes-on-near">
      <div className="flex flex-col gap-2">
        <p className={label}>NEAR testnet</p>
        <h2 id="passes-heading" className="font-display text-4xl font-bold leading-tight tracking-[-0.015em]">
          Passes on NEAR
        </h2>
        <p className="max-w-[720px] text-body-text">
          A pass is an offer that holds testnet NEAR. Claim one on a pick and show its number at the counter; when the merchant redeems it, the
          contract pays the cash back to your account. Every merchant is a sample and testnet NEAR has no value.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-6">
        <section aria-labelledby="passes-test-heading" className="flex flex-col gap-4 rounded-section bg-banner p-8 text-background" data-testid="how-to-test-passes">
          <h3 id="passes-test-heading" className="font-display text-[26px] font-bold">
            How to test passes
          </h3>
          <ol className="m-0 flex list-none flex-col gap-3 p-0 text-on-dark-muted">
            {[
              'Take the shopper seat. No wallet and no sign-in: Nearby makes a testnet account for this browser.',
              'Open the Tuesday 9:30 stop and claim the Saguaro Bean pass.',
              'Switch seat to Saguaro Bean Co., type the pass number and redeem.',
              'Follow the links to see each transaction on the explorer.',
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-display text-xl font-extrabold leading-6 text-background" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <span className="sr-only">Step {i + 1}. </span>
                  {step}
                </span>
              </li>
            ))}
          </ol>
          <Link
            to="/seats"
            className="flex min-h-touch items-center self-start rounded-full bg-background px-[26px] font-semibold text-foreground no-underline transition-colors duration-150 hover:bg-tint hover:text-foreground"
          >
            Choose a seat
          </Link>
        </section>

        <section aria-labelledby="agent-can-heading" className="flex flex-col gap-4 rounded-section border border-border bg-card p-8" data-testid="what-the-agent-can-do">
          <h3 id="agent-can-heading" className="flex flex-wrap items-center gap-2 font-display text-[26px] font-bold">
            What the agent can do
            <Badge>Read live</Badge>
          </h3>
          <AgentKeys />
        </section>
      </div>

      <div className="overflow-x-auto rounded-section border border-border bg-card">
        <table className="w-full min-w-[560px] border-collapse text-left text-[15px]" data-testid="agent-limits">
          <caption className="px-6 pt-5 text-left font-semibold text-foreground">What the agent&rsquo;s key can and cannot do</caption>
          <thead>
            <tr className="border-b border-border text-[13px] text-secondary-text">
              <th scope="col" className="px-6 py-3 font-semibold">Question</th>
              <th scope="col" className="px-6 py-3 font-semibold">Answer</th>
              <th scope="col" className="px-6 py-3 font-semibold">Enforced by</th>
            </tr>
          </thead>
          <tbody>
            {AGENT_LIMITS.map((r) => (
              <tr key={r.q} className="border-b border-border last:border-b-0 align-top">
                <th scope="row" className="px-6 py-3 font-semibold">{r.q}</th>
                <td className="px-6 py-3 text-body-text">{withCode(r.a)}</td>
                <td className="px-6 py-3 text-body-text">{r.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
