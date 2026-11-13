// The merchant dashboard's NEAR panel (F10.1 to F11.2; REQ-11-01, REQ-11-02, REQ-11-03, REQ-12-01, REQ-12-02;
// AC-REQ-11-01-01, AC-REQ-11-01-02, AC-REQ-11-03-01, AC-REQ-12-02-01), from GET /api/merchants/{merchantId}/passes:
// the merchant's testnet account, its balance, an explorer link and the Sample label; for each seeded offer the counts
// Open, Claimed, Redeemed and Refunded with Fund passes; the balance the contract still holds; Redeem; and the expired
// passes marked "Refund available" with Refund expired. A merchant with no NEAR account shows the notice only. Nothing
// is drawn while passes are off (AC-REQ-14-06-01).
import { useState } from 'react';
import type { FundPassesResult, MerchantPassesResult, OfferPassStats, PassView, RefundExpiredResult } from '@/shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { api, isApiError, useApiQuery } from '@/hooks/useApi';
import { usePassesOn } from '@/hooks/useNearAccount';
import { ExplorerLink, passLink } from './PassDetail';
import { FundedNote, FundPassesForm } from './FundPassesForm';
import { RedeemPass } from './RedeemPass';
import { formatExpiry } from './passFormat';

const COUNT_KEYS = [
  ['open', 'Open'],
  ['claimed', 'Claimed'],
  ['redeemed', 'Redeemed'],
  ['refunded', 'Refunded'],
] as const;

/** Open or Claimed at or past expiry: the merchant may take the balance back (F11.2). */
const refundDue = (p: PassView) => p.expired && (p.status === 'Open' || p.status === 'Claimed');

/** How many recent passes the list shows; the explorer has the rest. */
const LIST_MAX = 12;

function OfferPasses({ merchantId, stats, onFunded, storageEstimateYocto }: { merchantId: string; stats: OfferPassStats; onFunded: () => void; storageEstimateYocto?: string }) {
  const [open, setOpen] = useState(false);
  const [funded, setFunded] = useState<FundPassesResult | null>(null);
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-border p-4" data-testid="offer-passes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 text-[17px] font-bold">{stats.offerTitle}</h4>
        {!open && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`Fund passes for ${stats.offerTitle}`}>
            Fund passes
          </Button>
        )}
      </div>
      <dl className="m-0 grid grid-cols-4 gap-2 text-center">
        {COUNT_KEYS.map(([k, label]) => (
          <div key={k} className="rounded-tile bg-background px-1 py-2">
            <dt className="text-[12px] text-secondary-text">{label}</dt>
            <dd className="m-0 font-display text-xl font-bold" data-testid={`count-${k}`}>
              {stats[k]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-[13px] text-secondary-text">Held for this offer: {stats.heldText}</p>
      {open && (
        <FundPassesForm
          merchantId={merchantId}
          offerId={stats.offerId}
          offerTitle={stats.offerTitle}
          storageEstimateYocto={storageEstimateYocto}
          onCancel={() => setOpen(false)}
          onFunded={(r) => {
            setFunded(r);
            setOpen(false);
            onFunded();
          }}
        />
      )}
      {funded && <FundedNote result={funded} />}
    </li>
  );
}

function RefundExpired({ merchantId, due, onRefunded }: { merchantId: string; due: number; onRefunded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefundExpiredResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<RefundExpiredResult>(`/api/merchants/${encodeURIComponent(merchantId)}/passes/refund-expired`);
      setResult(r);
      onRefunded();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'The refund could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {due > 0 && (
        <Button type="button" className="self-start" onClick={() => void run()} disabled={busy}>
          {busy ? 'Refunding…' : 'Refund expired'}
        </Button>
      )}
      {result && (
        <div className="flex flex-col gap-1 rounded-panel bg-tint px-3.5 py-2.5" role="status" data-testid="refunded">
          {result.refunded.length === 0 ? (
            <p className="m-0 text-[15px] font-semibold text-primary">No expired pass to refund.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {result.refunded.map((r) => (
                <li key={r.tokenId} className="flex flex-wrap items-center gap-x-3 text-[15px]">
                  <span>
                    <span className="font-mono font-semibold">{r.tokenId}</span> refunded, {r.valueText} back to the merchant account.
                  </span>
                  <ExplorerLink href={r.txUrl}>Transaction</ExplorerLink>
                </li>
              ))}
            </ul>
          )}
          {result.balanceText && <p className="m-0 text-[15px] font-semibold text-primary">Account balance now: {result.balanceText}</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 rounded-panel border border-error px-3.5 py-2.5 text-[15px]">
          {error}
        </p>
      )}
    </div>
  );
}

function PassList({ passes }: { passes: PassView[] }) {
  if (passes.length === 0) return <p className="m-0 text-[15px] text-secondary-text">No passes yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
      {passes.slice(0, LIST_MAX).map((p) => {
        const link = passLink(p);
        return (
          <li key={p.tokenId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-[15px]" data-testid="merchant-pass">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold">{p.tokenId}</span>
              <span>{p.status}</span>
              {refundDue(p) && <Badge data-testid="refund-available">Refund available</Badge>}
              <span className="text-[13px] text-secondary-text">
                {p.valueText}, {p.expired ? 'expired' : 'expires'} {formatExpiry(p.expiresAt)}
              </span>
            </span>
            <ExplorerLink href={link.href}>
              <span className="sr-only">{p.tokenId} </span>Explorer
            </ExplorerLink>
          </li>
        );
      })}
    </ul>
  );
}

export function MerchantNearPanel({ merchantId }: { merchantId: string }) {
  const on = usePassesOn();
  if (!on) return null;
  return <Panel merchantId={merchantId} />;
}

function Panel({ merchantId }: { merchantId: string }) {
  const q = useApiQuery<MerchantPassesResult>(`/api/merchants/${encodeURIComponent(merchantId)}/passes`);
  const heading = (
    <h2 id="near-heading" className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold">
      Passes on NEAR
      <Badge variant="sample">Sample</Badge>
    </h2>
  );

  let body;
  if (q.loading && !q.data) {
    body = (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the NEAR account">
        <Skeleton className="h-6 w-72 rounded-tile bg-tint" />
        <Skeleton className="h-24 rounded-panel bg-tint" />
      </div>
    );
  } else if (q.error || !q.data) {
    body = <ErrorState title="The NEAR account did not load" message={q.error?.message ?? 'Try again in a moment.'} onRetry={q.reload} />;
  } else if (!q.data.nearEnabled) {
    body = (
      <p className="m-0 text-body-text" data-testid="near-not-set-up">
        {q.data.notice}
      </p>
    );
  } else {
    const d = q.data;
    const due = d.passes.filter(refundDue).length;
    body = (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 rounded-panel bg-background p-4" data-testid="near-account">
          <p className="m-0 text-[13px] text-secondary-text">Testnet account, sample merchant</p>
          <p className="m-0 break-all font-mono text-[15px] font-semibold" data-testid="near-account-id">
            {d.accountId}
          </p>
          <dl className="m-0 grid grid-cols-1 gap-2 text-[15px] sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-secondary-text">Balance</dt>
              <dd className="m-0 font-semibold" data-testid="near-balance">
                {d.balanceText ?? 'Not available right now'}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-secondary-text">Held in passes by the contract</dt>
              <dd className="m-0 font-semibold" data-testid="near-held">
                {d.heldText}
              </dd>
            </div>
          </dl>
          {d.explorerUrl && <ExplorerLink href={d.explorerUrl}>See the account on the explorer</ExplorerLink>}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="m-0 text-[19px] font-bold">Passes per offer</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {d.offers.map((o) => (
              <OfferPasses key={o.offerId} merchantId={merchantId} stats={o} onFunded={q.reload} storageEstimateYocto={d.storageEstimateYocto} />
            ))}
          </ul>
        </div>

        <RedeemPass merchantId={merchantId} onRedeemed={q.reload} />

        <div className="flex flex-col gap-3">
          <h3 className="m-0 text-[19px] font-bold">Recent passes</h3>
          <PassList passes={d.passes} />
          <RefundExpired merchantId={merchantId} due={due} onRefunded={q.reload} />
        </div>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4 rounded-section p-6" aria-labelledby="near-heading" role="region" data-testid="merchant-near-panel">
      {heading}
      {body}
    </Card>
  );
}
