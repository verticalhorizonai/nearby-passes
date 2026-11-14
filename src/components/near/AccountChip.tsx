// The shopper's NEAR account (F8.1; REQ-09-01; AC-REQ-09-01-01, AC-REQ-09-01-02): a chip "Passes go to 3f2a…9c1d" in
// the header of the Shopper seat, opening the account panel with the full account id, "Demo account, testnet" for the
// derived account, and a link to the account on the explorer. No wallet, no sign-in, nothing signed. Nothing at all
// is drawn while passes are off (AC-REQ-14-06-01).
import { useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DEMO_ACCOUNT_LABEL, PASSES_PRODUCT_NAME } from '@/shared/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useNearAccount } from '@/hooks/useNearAccount';
import { ExplorerLink } from '@/components/passes/PassDetail';
import { shortAccount } from '@/components/passes/passFormat';
import { Button } from '@/components/ui/button';
import { useWalletSignIn } from './useWalletSignIn';

export function AccountChip() {
  const account = useNearAccount();
  const wallet = useWalletSignIn();
  // Ruling 62: the panel is a modal dialog, which makes everything outside it inert (pointer-events on the body and
  // the focus trap), and NEAR Connect draws its wallet chooser outside it. So "Use my NEAR testnet wallet" closes the
  // panel first, and the sign-in starts only once the close has finished (Radix calls onCloseAutoFocus after the panel
  // and its inert layer are gone). Focus is not handed back to the chip, so the chooser keeps it. When the sign-in
  // settles the panel reopens: with the wallet account, or with the error line.
  const [open, setOpen] = useState(false);
  const walletPending = useRef(false);
  const startWallet = () => {
    walletPending.current = true;
    setOpen(false);
  };
  const onCloseAutoFocus = (e: Event) => {
    if (!walletPending.current) return;
    walletPending.current = false;
    e.preventDefault();
    void wallet.signIn().finally(() => setOpen(true));
  };
  if (!account?.passesEnabled || !account.accountId) return null;
  const { accountId, explorerUrl, source } = account;
  const chipText = `Passes go to ${shortAccount(accountId)}`;

  return (
    // Its own line under the header's bar: beside the seat chip and Switch seat it would not fit a 375 px phone.
    <div className="mx-auto flex max-w-content px-4 pb-1 sm:px-8">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="account-chip"
          aria-label={`${chipText}. Open the account panel`}
          className="flex min-h-touch items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-primary">
            <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
            {chipText}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Where your passes go</DialogTitle>
          <DialogDescription>
            {source === 'demo'
              ? `${PASSES_PRODUCT_NAME} made this NEAR testnet account for this browser. You need no wallet, and there is nothing to sign.`
              : 'Your NEAR testnet wallet account receives the passes you claim.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3" data-testid="account-panel">
          <div className="flex flex-col gap-1 rounded-panel bg-background p-4">
            <p className="m-0 text-[13px] text-secondary-text">{source === 'demo' ? DEMO_ACCOUNT_LABEL : 'Your wallet, testnet'}</p>
            <p className="m-0 break-all font-mono text-[15px] text-foreground" data-testid="account-id">
              {accountId}
            </p>
          </div>
          {explorerUrl && <ExplorerLink href={explorerUrl}>See the account on the explorer</ExplorerLink>}
          <Link to="/passes" className="inline-flex min-h-touch items-center self-start font-semibold">
            My passes
          </Link>
          {source === 'demo' && (
            // F8.2 (Should): optional; signing in signs no transaction.
            <div className="flex flex-col gap-1.5">
              <Button type="button" variant="outline" className="min-h-touch self-start" disabled={wallet.busy} onClick={startWallet}>
                {wallet.busy ? 'Opening your wallet…' : 'Use my NEAR testnet wallet'}
              </Button>
              {wallet.error && (
                <p role="alert" className="m-0 text-[13px] text-error">
                  {wallet.error}
                </p>
              )}
            </div>
          )}
          <p className="m-0 text-[13px] text-secondary-text">Testnet only. Testnet NEAR has no value. Reset demo gives this browser a new account.</p>
        </div>
      </DialogContent>
    </Dialog>
    </div>
  );
}
