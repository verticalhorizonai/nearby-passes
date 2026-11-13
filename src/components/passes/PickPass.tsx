// A pass on a pick card (F8.3, F8.5; REQ-09-03, REQ-09-05; AC-REQ-09-03-01, AC-REQ-09-05-01). The pass line "Pass: 0.1
// testnet NEAR back" (the pass's own amount, from the server), and the claimed state: "Pass claimed" with Show pass,
// in the bought pick's panel style, which opens the pass as it would be shown at the counter.
import { CheckCircle2, Ticket } from 'lucide-react';
import type { PickPassClaim } from '@/shared/types';
import { Button } from '@/components/ui/button';
import { PassDialog } from './PassDetail';

export function PassLine({ cashBackText, failedMessage }: { cashBackText: string; failedMessage: string | null }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid="pick-pass">
      <p className="m-0 flex items-center gap-[5px] text-[15px] font-semibold text-primary" data-testid="pick-pass-line">
        <Ticket className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
        Pass: {cashBackText} back
      </p>
      {failedMessage && <p className="m-0 text-[13px] text-secondary-text">The last claim did not go through: {failedMessage}</p>}
    </div>
  );
}

export function ClaimedPass({ claim, offerTitle }: { claim: PickPassClaim; offerTitle: string }) {
  if (claim.status === 'pending' || !claim.tokenId) {
    // The claim was sent and its outcome is not known yet; the server checks it by its hash before any retry (3.6.3).
    return (
      <div className="flex min-h-12 items-center rounded-panel bg-tint px-3.5 py-1.5" data-testid="pick-pass-pending">
        <p className="m-0 text-[15px] font-semibold text-primary" data-testid="pick-status">
          Your pass claim is being confirmed on NEAR testnet.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-panel bg-tint px-3.5 py-1.5" data-testid="pick-pass-claimed">
      <p className="m-0 flex items-center gap-2 text-[15px] font-semibold text-primary" data-testid="pick-status">
        <CheckCircle2 className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
        Pass claimed
      </p>
      <PassDialog
        tokenId={claim.tokenId}
        trigger={
          <Button type="button" variant="secondary" className="min-h-touch" aria-label={`Show pass for ${offerTitle}`}>
            <Ticket aria-hidden="true" />
            Show pass
          </Button>
        }
      />
    </div>
  );
}
