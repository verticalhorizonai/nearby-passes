// Fund passes on a seeded offer (F10.2; REQ-11-02; AC-REQ-11-02-01, AC-REQ-11-02-02): how many (1 to 5), the cash back
// each (0.05, 0.1 or 0.25 testnet NEAR), the expiry (5 minutes, 24 hours or 7 days), and the total: count x cash back
// plus count x the storage estimate, with the note that unused storage is refunded. Fund posts only the three choices;
// the server computes the deposit. On 201 the new passes show as Open with the transaction link.
import { useState } from 'react';
import type { FundPassesResult, PassCashBack, PassExpiry } from '@/shared/types';
import { PASS_CASH_BACK_OPTIONS, PASS_FUND_COUNT_MAX, PASS_FUND_COUNT_MIN } from '@/shared/types';
import { Button } from '@/components/ui/button';
import { api, isApiError } from '@/hooks/useApi';
import { ExplorerLink } from './PassDetail';

/**
 * The storage deposit per pass the server adds (PASS_STORAGE_ESTIMATE_NEAR, 0.03 testnet NEAR from the measured
 * figures, build ruling 52(e)), in hundredths of a NEAR. The server's value is not sent to the client; this is the
 * figure the form shows, and the contract refunds what is unused.
 */
const STORAGE_HUNDREDTHS = 3;
const CASH_BACK_HUNDREDTHS: Record<PassCashBack, number> = { '0.05': 5, '0.1': 10, '0.25': 25 };
const EXPIRY_LABEL: Record<PassExpiry, string> = { '5m': '5 minutes', '24h': '24 hours', '7d': '7 days' };
const EXPIRIES = Object.keys(EXPIRY_LABEL) as PassExpiry[];
const COUNTS = Array.from({ length: PASS_FUND_COUNT_MAX - PASS_FUND_COUNT_MIN + 1 }, (_, i) => PASS_FUND_COUNT_MIN + i);

/** 39 -> "0.39 testnet NEAR"; 140 -> "1.4 testnet NEAR". Integer arithmetic only. */
function hundredthsText(n: number): string {
  const frac = String(n % 100).padStart(2, '0').replace(/0+$/, '');
  return `${Math.floor(n / 100)}${frac ? `.${frac}` : ''} testnet NEAR`;
}

/** The total a funding takes: count x cash back + count x storage estimate (AC-REQ-11-02-01). */
/** The server's storage estimate (MerchantPassesResult.storageEstimateYocto) in hundredths of a NEAR, rounded up. */
function storageHundredths(yocto: string | undefined): number {
  if (!yocto || !/^\d+$/.test(yocto)) return STORAGE_HUNDREDTHS;
  const unit = 10n ** 22n;
  return Number((BigInt(yocto) + unit - 1n) / unit);
}

function fundTotal(count: number, cashBack: PassCashBack, storagePerPass: number): { cashBack: string; storage: string; total: string } {
  const cb = count * CASH_BACK_HUNDREDTHS[cashBack];
  const st = count * storagePerPass;
  return { cashBack: hundredthsText(cb), storage: hundredthsText(st), total: hundredthsText(cb + st) };
}

function Choice<T extends string | number>({ legend, options, value, onChange, text }: { legend: string; options: readonly T[]; value: T; onChange: (v: T) => void; text: (v: T) => string }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sm font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={String(o)}
            type="button"
            size="sm"
            variant={o === value ? 'default' : 'secondary'}
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className="min-w-11"
          >
            {text(o)}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

interface FundPassesFormProps {
  merchantId: string;
  offerId: string;
  offerTitle: string;
  onFunded: (result: FundPassesResult) => void;
  onCancel: () => void;
  /** The server's storage estimate per pass, in yocto (ruling 54(c)); 0.03 testnet NEAR when absent. */
  storageEstimateYocto?: string;
}

export function FundPassesForm({ merchantId, offerId, offerTitle, onFunded, onCancel, storageEstimateYocto }: FundPassesFormProps) {
  const [count, setCount] = useState(3);
  const [cashBack, setCashBack] = useState<PassCashBack>('0.1');
  const [expiry, setExpiry] = useState<PassExpiry>('24h');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totals = fundTotal(count, cashBack, storageHundredths(storageEstimateYocto));

  const fund = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<FundPassesResult>(
        `/api/merchants/${encodeURIComponent(merchantId)}/offers/${encodeURIComponent(offerId)}/passes`,
        { count, cashBack, expiry },
      );
      onFunded(result);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'The passes could not be funded. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-border bg-background p-4" data-testid="fund-form" aria-label={`Fund passes for ${offerTitle}`} role="group">
      <Choice legend="How many passes" options={COUNTS} value={count} onChange={setCount} text={(n) => String(n)} />
      <Choice legend="Cash back each" options={PASS_CASH_BACK_OPTIONS} value={cashBack} onChange={setCashBack} text={(v) => `${v} testnet NEAR`} />
      <Choice legend="Expires after" options={EXPIRIES} value={expiry} onChange={setExpiry} text={(v) => EXPIRY_LABEL[v]} />
      <div className="flex flex-col gap-1 rounded-panel bg-card p-3" aria-live="polite">
        <p className="m-0 font-semibold" data-testid="fund-total">
          Total: {totals.total}
        </p>
        <p className="m-0 text-[13px] text-body-text">
          {totals.cashBack} in cash back and {totals.storage} storage deposit. Unused storage is refunded.
        </p>
      </div>
      {error && (
        <p role="alert" className="m-0 rounded-panel border border-error px-3.5 py-2.5 text-[15px]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Button type="button" onClick={() => void fund()} disabled={busy}>
          {busy ? 'Funding…' : 'Fund'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** What a funding made: the new passes, Open, with the transaction link. */
export function FundedNote({ result }: { result: FundPassesResult }) {
  return (
    <div className="flex flex-col gap-1 rounded-panel bg-tint px-3.5 py-2.5" role="status" data-testid="funded">
      <p className="m-0 text-[15px] font-semibold text-primary">
        {result.passes.length === 1 ? '1 new pass' : `${result.passes.length} new passes`}, {result.depositText} deposited:
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[15px]">
        {result.passes.map((p) => (
          <li key={p.tokenId}>
            <span className="font-mono">{p.tokenId}</span> {p.status}
          </li>
        ))}
      </ul>
      <ExplorerLink href={result.txUrl}>See the transaction on the explorer</ExplorerLink>
    </div>
  );
}
