// The pass confirm sheet (F8.4; REQ-09-04; AC-REQ-09-04-01, AC-REQ-09-04-02; spec 3.6.7 "Confirm sheet, pass"): the
// merchant with its Sample badge, the cash back in testnet NEAR, the expiry, the receiving account, the sentence
// "Nearby's agent claims it for you. It cannot move money.", Yes, claim it and Not now. A Sheet from the bottom on a
// phone, a Dialog from 900 px wide, as the PayPal confirm sheet is. After the claim it shows the pass number and the
// transaction link; a refusal (409) or a NEAR failure (503) shows the server's plain message and Yes, claim it stays,
// since the token is released and still valid (3.6.3).
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ClaimPassResult, PassConfirmSheet } from '@/shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { ExplorerLink } from './PassDetail';
import { formatExpiry, passOffer } from './passFormat';

interface ClaimPassSheetProps {
  sheet: PassConfirmSheet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClaim: () => void;
  claiming: boolean;
  result: ClaimPassResult | null;
  /** The server's plain message after a refused or failed claim. */
  error: string | null;
}

const TITLE = 'Claim this pass';
const DONE_TITLE = 'Pass claimed';
const DESCRIPTION = 'A sample pass on NEAR testnet. Testnet NEAR has no value.';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-secondary-text">{term}</dt>
      <dd className="m-0 text-[15px] text-body-text">{children}</dd>
    </div>
  );
}

function Body({ sheet, onClaim, onClose, claiming, error }: { sheet: PassConfirmSheet; onClaim: () => void; onClose: () => void; claiming: boolean; error: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 flex flex-col gap-3 rounded-panel bg-background p-4">
        <div className="flex flex-col gap-1">
          <dt className="sr-only">Merchant</dt>
          <dd className="m-0 flex flex-wrap items-center gap-2 text-[17px] font-bold">
            {sheet.merchantName}
            {sheet.merchantIsSample && <Badge variant="sample">Sample</Badge>}
          </dd>
          <dd className="m-0 text-[15px] text-body-text">{sheet.offerTitle}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">Cash back</dt>
          <dd className="m-0 font-display text-price font-bold" data-testid="claim-cash-back">
            {sheet.cashBackText}
          </dd>
        </div>
        <Row term="Expires">{formatExpiry(sheet.expiresAt)}</Row>
        <Row term="Goes to your account">
          <span className="break-all font-mono text-[14px]" data-testid="claim-receiving-account">
            {sheet.receivingAccountId}
          </span>
        </Row>
      </dl>
      <p className="m-0 text-[15px] font-semibold text-foreground" data-testid="claim-agent-sentence">
        {sheet.agentSentence}
      </p>
      {error && (
        <p role="alert" className="m-0 rounded-panel border border-error px-3.5 py-2.5 text-[15px] text-foreground" data-testid="claim-error">
          {error}
        </p>
      )}
      {claiming && (
        <p role="status" className="m-0 text-[15px] text-secondary-text">
          The agent is claiming your pass on NEAR testnet. This takes about ten seconds.
        </p>
      )}
      <div className="flex gap-2.5">
        <Button type="button" className="h-12 flex-[2_1_0%] text-base" onClick={onClaim} disabled={claiming}>
          {claiming ? 'Claiming…' : 'Yes, claim it'}
        </Button>
        <Button type="button" variant="secondary" className="h-12 flex-[1_1_0%] text-base" onClick={onClose} disabled={claiming}>
          Not now
        </Button>
      </div>
    </div>
  );
}

function Done({ result, onClose }: { result: ClaimPassResult; onClose: () => void }) {
  const { pass } = result;
  return (
    <div className="flex flex-col gap-4" data-testid="claim-done">
      <div className="flex flex-col items-center gap-1.5 rounded-panel bg-background px-4 py-5 text-center">
        <p className="text-label uppercase text-secondary-text">Pass number</p>
        <p className="m-0 font-mono text-[36px] font-semibold leading-tight tracking-[0.12em] text-foreground" data-testid="claimed-pass-number">
          {pass.tokenId}
        </p>
        <p className="m-0 flex flex-wrap items-center justify-center gap-2 text-[17px] font-bold">
          {pass.merchantName ?? pass.merchantAccountId}
          {pass.merchantIsSample && <Badge variant="sample">Sample</Badge>}
        </p>
        <p className="m-0 text-[15px] text-body-text">{passOffer(pass.description)}</p>
      </div>
      <p className="m-0 text-[15px] text-body-text">
        It holds {pass.valueText} for you until {formatExpiry(pass.expiresAt)}. Show the number at the counter.
      </p>
      <ExplorerLink href={result.txUrl}>See the transaction on the explorer</ExplorerLink>
      <div className="flex flex-wrap gap-2.5">
        <Button type="button" className="h-12 flex-1 text-base" onClick={onClose}>
          Done
        </Button>
        <Link to="/passes" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-outline-border bg-card px-5 font-semibold text-foreground no-underline hover:bg-tint hover:text-foreground">
          My passes
        </Link>
      </div>
    </div>
  );
}

export function ClaimPassSheet({ sheet, open, onOpenChange, onClaim, claiming, result, error }: ClaimPassSheetProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (!sheet) return null;
  const close = () => onOpenChange(false);
  const title = result ? DONE_TITLE : TITLE;
  const body = result ? <Done result={result} onClose={close} /> : <Body sheet={sheet} onClaim={onClaim} onClose={close} claiming={claiming} error={error} />;

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{DESCRIPTION}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader className="mb-4">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{DESCRIPTION}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}
