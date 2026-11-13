// My passes (F9.1 to F9.3; REQ-10-01, REQ-10-02, REQ-10-03; AC-REQ-10-01-01, AC-REQ-10-02-01, AC-REQ-10-03-01): the
// passes the session's NEAR account holds (GET /api/passes/mine), each with its live image, merchant and Sample badge,
// offer, balance, status, expiry, number and explorer link. The status is the contract's, read through the server on
// every visit; the client keeps none. A redeemed pass says "0.1 testnet NEAR paid to your account" with the redeem
// transaction. Show pass opens the number in large type for the counter. With passes off the page says so and asks for
// nothing (AC-REQ-14-06-01).
import { Ticket } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MyPassesResult, PassView } from '@/shared/types';
import { PageShell } from '@/components/layout/PageShell';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ExplorerLink, PassDialog, PassStatusLine, passLink } from '@/components/passes/PassDetail';
import { formatExpiry, passOffer, shortAccount } from '@/components/passes/passFormat';
import { useApiQuery } from '@/hooks/useApi';
import { useNearAccount } from '@/hooks/useNearAccount';

function PassCard({ pass }: { pass: PassView }) {
  const link = passLink(pass);
  const headingId = `pass-${pass.tokenId}-name`;
  return (
    <Card role="group" className="flex w-full flex-col gap-4 rounded-card p-[18px] shadow-pick" aria-labelledby={headingId} data-testid="pass-card">
      <img
        src={pass.mediaUrl}
        alt={`Pass ${pass.tokenId}, ${pass.status}, from ${pass.merchantName ?? pass.merchantAccountId}`}
        className="aspect-[3/2] w-full rounded-panel border border-border bg-background object-contain"
        loading="lazy"
        data-testid="pass-image"
      />
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="m-0 flex flex-wrap items-center gap-2 text-[17px] font-bold leading-snug">
          {pass.merchantName ?? pass.merchantAccountId}
          {pass.merchantIsSample && <Badge variant="sample">Sample</Badge>}
        </h2>
        <p className="m-0 text-[15px] text-body-text">{passOffer(pass.description)}</p>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3 text-[15px]">
        <div>
          <dt className="text-[13px] text-secondary-text">Status</dt>
          <dd className="m-0 font-semibold" data-testid="pass-status">
            {pass.status}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">Balance</dt>
          <dd className="m-0 font-semibold" data-testid="pass-balance">
            {pass.status === 'Claimed' || pass.status === 'Open' ? pass.valueText : '0 testnet NEAR'}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">Number</dt>
          <dd className="m-0 font-mono font-semibold" data-testid="pass-card-number">
            {pass.tokenId}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">Expires</dt>
          <dd className="m-0">{formatExpiry(pass.expiresAt)}</dd>
        </div>
      </dl>
      <PassStatusLine pass={pass} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ExplorerLink href={link.href}>{link.label}</ExplorerLink>
        <PassDialog
          pass={pass}
          tokenId={pass.tokenId}
          trigger={
            <Button type="button" variant="secondary" aria-label={`Show pass ${pass.tokenId}`}>
              <Ticket aria-hidden="true" />
              Show pass
            </Button>
          }
        />
      </div>
    </Card>
  );
}

function PassList() {
  const mine = useApiQuery<MyPassesResult>('/api/passes/mine');
  if (mine.loading && !mine.data) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4" aria-busy="true" aria-label="Loading your passes">
        <Skeleton className="h-[420px] rounded-card" />
        <Skeleton className="h-[420px] rounded-card" />
      </div>
    );
  }
  if (mine.error || !mine.data) {
    return <ErrorState title="Your passes did not load" message={mine.error?.message ?? 'Try again in a moment.'} onRetry={mine.reload} />;
  }
  const { passes, accountId } = mine.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-secondary-text">
        Held by <span className="font-mono">{shortAccount(accountId)}</span>, read from the passes contract on NEAR testnet.
      </p>
      {passes.length === 0 ? (
        <p className="rounded-card border border-border bg-card px-[18px] py-6 text-center text-[17px] font-semibold" data-testid="passes-empty">
          No passes yet. Open a stop in{' '}
          <Link to="/week" className="font-semibold">
            My week
          </Link>{' '}
          and tap Claim as pass on a pick that has one.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4 p-0">
          {passes.map((p) => (
            <li key={p.tokenId} className="flex">
              <PassCard pass={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MyPassesPage() {
  const account = useNearAccount();
  let content;
  if (account === undefined) content = <Skeleton className="h-[200px] rounded-card" aria-label="Loading" />;
  else if (!account.passesEnabled) content = <p className="text-body-text" data-testid="passes-off">Passes are not on in this demo.</p>;
  else content = <PassList />;
  return (
    <PageShell side="shopper" mainClassName="pt-6">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="font-display text-4xl font-bold leading-tight">My passes</h1>
        <p className="text-body-text">Sample passes on NEAR testnet. Show a pass number at the counter; the merchant redeems it and the cash back comes to your account.</p>
      </div>
      {content}
    </PageShell>
  );
}
