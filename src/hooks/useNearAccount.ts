// The session's NEAR account and whether passes are on (GET /api/near/account; Nearby Passes F8.1, F13.3; REQ-09-01,
// REQ-14-03, REQ-14-06). One request per page load, shared by every component that asks (the header's account chip,
// My week, the home page's passes section, the merchant's NEAR panel). A failure reads as "passes off", so with
// NEAR_NETWORK unset, or the route missing, every screen is Nearby as before (AC-REQ-14-06-01). Reset demo moves the
// session to a new demo account, so it asks again (refreshNearAccount).
import { useEffect, useSyncExternalStore } from 'react';
import type { NearAccountResult } from '@/shared/types';
import { api } from './useApi';
import { productName, setPassesOnNow } from './productName';

const PASSES_OFF: NearAccountResult = {
  passesEnabled: false,
  claimsAvailable: false,
  unavailableReason: null,
  network: null,
  accountId: null,
  source: null,
  explorerUrl: null,
};

interface Store {
  /** undefined until the first answer. */
  value: NearAccountResult | undefined;
  inFlight: Promise<void> | null;
}

const store: Store = { value: undefined, inFlight: null };
/** Bumped by a refresh, so an older answer that lands late is dropped. */
let generation = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(): Promise<void> {
  if (store.inFlight) return store.inFlight;
  const mine = generation;
  store.inFlight = api
    .get<NearAccountResult>('/api/near/account')
    .then((r) => (r && typeof r === 'object' && r.passesEnabled === true ? r : PASSES_OFF))
    .catch(() => PASSES_OFF)
    .then((r) => {
      if (mine !== generation) return;
      store.value = r;
      store.inFlight = null;
      setPassesOnNow(r.passesEnabled === true);
      emit();
    });
  return store.inFlight;
}

/** Ask the server again (after Reset demo, which gives the session a new demo account). */
export function refreshNearAccount(): Promise<void> {
  generation += 1;
  store.inFlight = null;
  return load();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The account, or undefined while the first answer is on its way. */
export function useNearAccount(): NearAccountResult | undefined {
  const value = useSyncExternalStore(subscribe, () => store.value, () => undefined);
  useEffect(() => {
    if (store.value === undefined) void load();
  }, []);
  return value;
}

/** True only when the server says passes are on. */
export function usePassesOn(): boolean {
  return useNearAccount()?.passesEnabled === true;
}

/**
 * Passes on, for the banner and the tab's title on every page (ruling 60). It asks one tick after the page's own
 * requests (a page that reads the account itself has asked by then, and the request is shared), so a page's first
 * request is still its own, as it was before passes existed.
 */
export function usePassesOnDeferred(): boolean {
  const value = useSyncExternalStore(subscribe, () => store.value, () => undefined);
  useEffect(() => {
    if (store.value !== undefined) return;
    const t = setTimeout(() => {
      if (store.value === undefined) void load();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return value?.passesEnabled === true;
}

/** The product's visible name for a visitor: "NEARby" while passes are on, "Nearby" otherwise (ruling 63). */
export function useProductName(): string {
  return productName(usePassesOnDeferred());
}
