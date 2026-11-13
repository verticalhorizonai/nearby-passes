// F8.2 (Should; REQ-09-02): "Use my NEAR testnet wallet". NEAR Connect (@hot-labs/near-connect 0.12.0) is loaded only
// when the shopper taps the button, on testnet. Signing in signs no transaction (the connector's plain connect(), no
// limited key): it gives the account id, which the server accepts only if the account exists on testnet
// (POST /api/near/account). Later claims go to that account.
import { useState } from 'react';
import type { NearAccountResult } from '@/shared/types';
import { api, isApiError } from '@/hooks/useApi';
import { refreshNearAccount } from '@/hooks/useNearAccount';

export function useWalletSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { NearConnector } = await import('@hot-labs/near-connect');
      const connector = new NearConnector({ network: 'testnet' });
      const accountId = await new Promise<string>((resolve, reject) => {
        connector.on('wallet:signIn', (t: { accounts: { accountId: string }[] }) => {
          const id = t.accounts?.[0]?.accountId;
          if (id) resolve(id);
          else reject(new Error('The wallet gave no account.'));
        });
        connector.connect().catch(reject);
      });
      await api.post<NearAccountResult>('/api/near/account', { accountId });
      await refreshNearAccount();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'The wallet did not connect. Nothing changed.');
    } finally {
      setBusy(false);
    }
  };
  return { signIn, busy, error };
}
