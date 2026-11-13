// Showing a pass at the counter (F9.2; REQ-10-02; AC-REQ-10-02-01): the pass number (the token id, e.g. pass-7) in large
// type, the largest text on the view, in the system monospaced font as the redemption code is, with the merchant and
// the offer under it, then its status, cash back and expiry, read from the contract through the server.
// PassDialog opens it in the existing Dialog (Radix, shadcn/ui), from My passes or from Show pass on a claimed pick;
// given only a token id it reads the pass with GET /api/passes/{tokenId}.
import { useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PassView } from '@/shared/types';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/feedback/ErrorState';
import { api } from '@/hooks/useApi';
import { formatExpiry, passOffer } from './passFormat';

/** The transaction to link for a pass: the last one the app sent, else the holder's account (ruling 49(b)). */
export function passLink(pass: PassView): { href: string; label: string } {
  return pass.lastTxUrl
    ? { href: pass.lastTxUrl, label: 'See the transaction on the explorer' }
    : { href: pass.ownerExplorerUrl, label: 'See the account on the explorer' };
}

export function PassStatusLine({ pass }: { pass: PassView }) {
  if (pass.status === 'Redeemed') {
    return (
      <p className="m-0 text-[15px] font-semibold text-primary" data-testid="pass-paid">
        {pass.valueText} paid to your account
      </p>
    );
  }
  if (pass.status === 'Refunded') return <p className="m-0 text-[15px] text-body-text">Refunded to the merchant after it expired.</p>;
  if (pass.expired) return <p className="m-0 text-[15px] text-body-text">Expired. The merchant can take the cash back.</p>;
  return null;
}

export function PassDetail({ pass }: { pass: PassView }) {
  const link = passLink(pass);
  return (
    <div className="flex flex-col gap-4" data-testid="pass-detail">
      <div className="flex flex-col items-center gap-1.5 rounded-panel bg-background px-4 py-5 text-center">
        <p className="text-label uppercase text-secondary-text">Pass number</p>
        <p className="m-0 font-mono text-[36px] font-semibold leading-tight tracking-[0.12em] text-foreground" data-testid="pass-number">
          {pass.tokenId}
        </p>
        <p className="m-0 flex flex-wrap items-center justify-center gap-2 text-[17px] font-bold" data-testid="pass-merchant">
          {pass.merchantName ?? pass.merchantAccountId}
          {pass.merchantIsSample && <Badge variant="sample">Sample</Badge>}
        </p>
        <p className="m-0 text-[15px] text-body-text" data-testid="pass-offer">
          {passOffer(pass.description)}
        </p>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3 text-[15px]">
        <div>
          <dt className="text-[13px] text-secondary-text">Status</dt>
          <dd className="m-0 font-semibold">{pass.status}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-secondary-text">Cash back</dt>
          <dd className="m-0 font-semibold">{pass.valueText}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[13px] text-secondary-text">Expires</dt>
          <dd className="m-0">{formatExpiry(pass.expiresAt)}</dd>
        </div>
      </dl>
      <PassStatusLine pass={pass} />
      <ExplorerLink href={link.href}>{link.label}</ExplorerLink>
      <p className="m-0 text-[13px] text-secondary-text">Show this number at the counter. Testnet only; testnet NEAR has no value.</p>
    </div>
  );
}

/** A link that leaves for the explorer, at least 44 px tall. */
export function ExplorerLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-touch items-center gap-1.5 self-start font-semibold ${className ?? ''}`}>
      {children}
      <ExternalLink className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

interface PassDialogProps {
  /** The trigger, e.g. a Show pass button. */
  trigger: ReactNode;
  /** The pass when the caller has it (My passes); else it is read by its number. */
  pass?: PassView;
  tokenId: string;
}

export function PassDialog({ trigger, pass: given, tokenId }: PassDialogProps) {
  const [pass, setPass] = useState<PassView | null>(given ?? null);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setFailed(false);
    try {
      setPass(await api.get<PassView>(`/api/passes/${encodeURIComponent(tokenId)}`));
    } catch {
      setFailed(true);
    }
  };

  const shown = given ?? pass;
  return (
    <Dialog onOpenChange={(open) => open && !given && void load()}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your pass</DialogTitle>
          <DialogDescription>Show the number at the counter. The merchant redeems it and the cash back comes to your account.</DialogDescription>
        </DialogHeader>
        {shown ? (
          <PassDetail pass={shown} />
        ) : failed ? (
          <ErrorState title="The pass did not load" message="Nearby could not read this pass just now. Try again in a moment." onRetry={() => void load()} />
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the pass">
            <Skeleton className="h-28 rounded-panel bg-tint" />
            <Skeleton className="h-12 rounded-panel bg-tint" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
