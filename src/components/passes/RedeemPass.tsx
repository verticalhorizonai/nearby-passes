// Redeem a shopper's pass (F11.1; REQ-12-01; AC-REQ-12-01-01, AC-REQ-12-01-02): the merchant types the pass number
// (pass-7 or 7), looks it up (GET /api/passes/{tokenId}, read from the contract: merchant, offer, status, expiry,
// holder), then taps Redeem (POST .../passes/{tokenId}/redeem) and sees "Redeemed. 0.1 testnet NEAR sent to the
// holder." with the transaction link. The server re-reads the pass and decides; its plain message is shown on a refusal.
import { useId, useState, type FormEvent } from 'react';
import type { PassView, RedeemPassResult } from '@/shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, isApiError } from '@/hooks/useApi';
import { ExplorerLink } from './PassDetail';
import { formatExpiry, normalizePassNumber, passOffer } from './passFormat';

export function RedeemPass({ merchantId, onRedeemed }: { merchantId: string; onRedeemed: () => void }) {
  const fieldId = useId();
  const [raw, setRaw] = useState('');
  const [pass, setPass] = useState<PassView | null>(null);
  const [done, setDone] = useState<RedeemPassResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookUp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setPass(null);
    const id = normalizePassNumber(raw);
    if (!id) {
      setError('A pass number is pass- followed by digits, for example pass-7, or just the digits.');
      return;
    }
    setBusy(true);
    try {
      setPass(await api.get<PassView>(`/api/passes/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(isApiError(err) ? err.message : 'The pass could not be read. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const redeem = async () => {
    if (!pass) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<RedeemPassResult>(
        `/api/merchants/${encodeURIComponent(merchantId)}/passes/${encodeURIComponent(pass.tokenId)}/redeem`,
      );
      setDone(result);
      setPass(result.pass);
      onRedeemed();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'The pass could not be redeemed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const ownPass = pass ? pass.merchantId === merchantId : false;
  const redeemable = pass !== null && ownPass && pass.status === 'Claimed' && !pass.expired && !done;

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="flex flex-col gap-3" data-testid="redeem-pass">
      <h3 id={`${fieldId}-heading`} className="m-0 text-[19px] font-bold">
        Redeem a pass
      </h3>
      <form onSubmit={(e) => void lookUp(e)} className="flex flex-wrap items-end gap-2.5">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <Label htmlFor={fieldId}>Pass number</Label>
          <Input id={fieldId} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="pass-7" autoComplete="off" inputMode="text" spellCheck={false} />
        </div>
        <Button type="submit" variant="secondary" disabled={busy || raw.trim() === ''}>
          Look up
        </Button>
      </form>

      {pass && (
        <div className="flex flex-col gap-3 rounded-panel border border-border bg-background p-4" data-testid="redeem-lookup">
          <dl className="m-0 grid grid-cols-1 gap-2 text-[15px] sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-secondary-text">Pass</dt>
              <dd className="m-0 font-mono font-semibold">{pass.tokenId}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-secondary-text">Merchant</dt>
              <dd className="m-0 flex flex-wrap items-center gap-2 font-semibold">
                {pass.merchantName ?? pass.merchantAccountId}
                {pass.merchantIsSample && <Badge variant="sample">Sample</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-secondary-text">Offer</dt>
              <dd className="m-0">{passOffer(pass.description)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-secondary-text">Status</dt>
              <dd className="m-0 font-semibold" data-testid="redeem-status">
                {pass.status}
                {pass.expired && (pass.status === 'Open' || pass.status === 'Claimed') ? ', expired' : ''}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-secondary-text">Cash back</dt>
              <dd className="m-0">{pass.valueText}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-secondary-text">Expires</dt>
              <dd className="m-0">{formatExpiry(pass.expiresAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[13px] text-secondary-text">Holder</dt>
              <dd className="m-0 break-all font-mono text-[14px]" data-testid="redeem-holder">
                {pass.ownerId}
              </dd>
            </div>
          </dl>
          {!ownPass && <p className="m-0 text-[15px]">This pass belongs to another merchant.</p>}
          {ownPass && !done && pass.status !== 'Claimed' && <p className="m-0 text-[15px]">Only a claimed pass can be redeemed. This one is {pass.status}.</p>}
          {ownPass && !done && pass.status === 'Claimed' && pass.expired && <p className="m-0 text-[15px]">This pass has expired. Use Refund expired instead.</p>}
          {redeemable && (
            <Button type="button" className="self-start" onClick={() => void redeem()} disabled={busy}>
              {busy ? 'Redeeming…' : 'Redeem'}
            </Button>
          )}
        </div>
      )}

      {done && (
        <div className="flex flex-col gap-1 rounded-panel bg-tint px-3.5 py-2.5" role="status" data-testid="redeemed">
          <p className="m-0 text-[15px] font-semibold text-primary">{done.message}</p>
          <ExplorerLink href={done.txUrl}>See the transaction on the explorer</ExplorerLink>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 rounded-panel border border-error px-3.5 py-2.5 text-[15px]">
          {error}
        </p>
      )}
    </section>
  );
}
