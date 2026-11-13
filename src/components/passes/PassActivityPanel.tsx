// Pass activity (F11.3, Should; REQ-12-03; AC-REQ-12-03-01): claims, fundings, redemptions and refunds of this
// merchant's passes, newest first, polled at the sales feed's rate (3 s) beside the PayPal sales. Shown only when
// passes are on and the merchant has a NEAR account; a failed poll keeps the last list and tries again.
import { useEffect, useState } from 'react';
import type { PassActivityItem, PassActivityResult } from '@/shared/types';
import { SALES_FEED_POLL_INTERVAL_MS } from '@/shared/types';
import { Card } from '@/components/ui/card';
import { api } from '@/hooks/useApi';
import { usePassesOn } from '@/hooks/useNearAccount';
import { formatDayShortTime } from '@/client/format';
import { ExplorerLink } from './PassDetail';

const VERB: Record<PassActivityItem['kind'], string> = { claim: 'claimed', fund: 'funded', redeem: 'redeemed', refund: 'refunded' };

export function PassActivityPanel({ merchantId, intervalMs = SALES_FEED_POLL_INTERVAL_MS }: { merchantId: string; intervalMs?: number }) {
  const on = usePassesOn();
  const [items, setItems] = useState<PassActivityItem[] | null>(null);

  useEffect(() => {
    if (!on) return;
    let live = true;
    let next: number | undefined;
    const poll = async () => {
      const startedAt = Date.now();
      try {
        const r = await api.get<PassActivityResult>(`/api/merchants/${encodeURIComponent(merchantId)}/passes/activity`);
        if (live) setItems(r.items);
      } catch {
        /* keep the last list; try again on the next tick */
      }
      if (live) next = window.setTimeout(poll, Math.max(0, intervalMs - (Date.now() - startedAt)));
    };
    void poll();
    return () => {
      live = false;
      if (next) window.clearTimeout(next);
    };
  }, [merchantId, intervalMs, on]);

  if (!on || !items || items.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 rounded-section p-6" aria-labelledby="pass-activity-heading">
      <h2 id="pass-activity-heading" className="font-display text-2xl font-bold">
        Pass activity
      </h2>
      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite" aria-label="Pass activity, newest first">
        {items.map((a) => (
          <li key={`${a.kind}-${a.tokenId}-${a.at}`} data-testid="pass-activity" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-panel border border-border bg-background px-4 py-2">
            <span className="min-w-0">
              <span className="block font-semibold">
                <span className="font-mono">{a.tokenId}</span> {VERB[a.kind]}
              </span>
              <span className="block text-[13px] text-secondary-text">{formatDayShortTime(a.at)}</span>
            </span>
            {a.txUrl && <ExplorerLink href={a.txUrl}>Explorer</ExplorerLink>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
