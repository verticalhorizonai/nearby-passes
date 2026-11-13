// The app with passes on (Nearby Passes): the NEAR adapter's fake (it keeps the contract's rules), the four
// NEAR-enabled sample merchants seeded with their testnet accounts, and the same clock for the app and the fake.
// No test reaches testnet (spec 3.6.9).
import { createTestApp } from './testApp.js';
import { FakeNear } from '../../src/services/near/fakeNear.js';
import { loadNearConfig, type NearConfig } from '../../src/services/near/nearConfig.js';
import { seedSampleData } from '../../src/seed/seed.js';

export const CONTRACT = 'contract.nearby-passes.testnet';
export const AGENT = 'agent.nearby-passes.testnet';
export const OWNER = 'nearby-passes.testnet';
const m = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const o = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
export const SAGUARO = { id: m(1), offer: o(1), account: 'saguaro-bean.nearby-passes.testnet' };
export const NOODLE = { id: m(2), offer: o(2), account: 'noodle-bar.nearby-passes.testnet' };
export const RILLITO = { id: m(6), offer: o(6), account: 'rillito-tacos.nearby-passes.testnet' };
export const DOGWASH = { id: m(8), offer: o(8), account: 'dog-wash.nearby-passes.testnet' };
/** A merchant with no NEAR account (Sonoran Print Shop). */
export const SONORAN = { id: m(7), offer: o(7) };
/** A fake key; never a real one (the leak scan must not trip on tests). */
const FAKE_KEY = 'ed25519:1111111111111111111111111111111111111111111111111111111111111111';

export function nearEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NEAR_NETWORK: 'testnet',
    NEAR_RPC_URL: 'https://test.rpc.fastnear.com',
    NEAR_PASSES_CONTRACT_ID: CONTRACT,
    NEAR_AGENT_ACCOUNT_ID: AGENT,
    NEAR_AGENT_PRIVATE_KEY: FAKE_KEY,
    NEAR_MERCHANT_ACCOUNTS_JSON: JSON.stringify(Object.fromEntries([SAGUARO, NOODLE, RILLITO, DOGWASH].map((x) => [x.id, x.account]))),
    NEAR_MERCHANT_KEYS_JSON: JSON.stringify(Object.fromEntries([SAGUARO, NOODLE, RILLITO, DOGWASH].map((x) => [x.account, FAKE_KEY]))),
    NEAR_DEMO_ACCOUNT_SECRET: 'ab'.repeat(32),
    ...overrides,
  };
}

export function nearTestConfig(): NearConfig {
  return loadNearConfig(nearEnv())!;
}

export async function createPassesApp(opts: Parameters<typeof createTestApp>[0] = {}) {
  const config = nearTestConfig();
  let clockNow: () => Date = () => new Date();
  const fake = new FakeNear({ contractId: CONTRACT, ownerId: OWNER, agentId: AGENT }, () => clockNow());
  for (const x of [SAGUARO, NOODLE, RILLITO, DOGWASH]) fake.balances.set(x.account, 5n * 10n ** 24n);
  const t = await createTestApp({ ...opts, deps: { ...(opts.deps ?? {}), near: { adapter: fake, config } } });
  clockNow = () => t.clock.now();
  await seedSampleData(t.db, config.merchantAccounts);
  return { ...t, fake, config };
}
