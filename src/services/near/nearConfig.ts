// NEAR settings and the testnet-only start-up guard (Nearby Passes spec rule 2, 3.6.8, F13.3; REQ-14-03, REQ-14-06).
// NEAR_NETWORK unset: passes are off and the app runs as Nearby does (returns null). Set: it must be exactly testnet,
// and every NEAR setting must name testnet, or the app refuses to start. Runs before the database pool or the
// listener is created, beside the PayPal sandbox guard (src/server.ts).
import { parseNear } from './format.js';

export interface NearConfig {
  network: 'testnet';
  rpcUrl: string;
  explorerTxUrl: string;
  explorerAccountUrl: string;
  contractId: string;
  agentAccountId: string;
  /** The agent's function-call key (secret; read only by the live adapter). */
  agentPrivateKey: string;
  /** App merchant uuid -> testnet account id (the four NEAR-enabled sample merchants). */
  merchantAccounts: Record<string, string>;
  /** Testnet account id -> its key (secret; read only by the live adapter). */
  merchantKeys: Record<string, string>;
  /** Derives visitors' demo accounts (secret). */
  demoAccountSecret: Buffer;
  storageEstimateYocto: bigint;
  merchantFloorYocto: bigint;
  agentFloorYocto: bigint;
}

export class NearConfigError extends Error {}

/** Known mainnet RPC hosts (3.6.8 "Refused if it is a known mainnet endpoint"); any host naming mainnet too.
 * The same list is in scripts/near/lib.mjs; test/near/nearConfig.test.ts keeps them equal. */
export const KNOWN_MAINNET_RPC_HOSTS = ['rpc.mainnet.near.org', 'rpc.near.org', 'rpc.mainnet.fastnear.com', 'rpc.fastnear.com', 'free.rpc.fastnear.com', 'near.lava.build', 'near.drpc.org', 'mainnet.neardata.xyz', 'archival-rpc.mainnet.near.org', 'beta.rpc.mainnet.near.org'];

const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isTestnetNamedAccount = (id: string) => id.length >= 2 && id.length <= 64 && NAMED.test(id) && id.endsWith('.testnet');
export const isImplicitAccount = (id: string) => /^[0-9a-f]{64}$/.test(id);
export const isTestnetAccount = (id: string) => isTestnetNamedAccount(id) || isImplicitAccount(id);

const get = (env: NodeJS.ProcessEnv, name: string) => {
  const v = env[name];
  return v && v.trim() !== '' ? v.trim() : null;
};
const need = (env: NodeJS.ProcessEnv, name: string) => {
  const v = get(env, name);
  if (!v) throw new NearConfigError(`${name} is not set. Passes need it when NEAR_NETWORK is testnet (spec 3.6.8).`);
  return v;
};
function json(env: NodeJS.ProcessEnv, name: string): Record<string, string> {
  try {
    const v = JSON.parse(need(env, name));
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.values(v).some((x) => typeof x !== 'string')) throw new Error();
    return v as Record<string, string>;
  } catch (e) {
    if (e instanceof NearConfigError) throw e;
    throw new NearConfigError(`${name} is not a JSON object of strings.`);
  }
}
function amount(env: NodeJS.ProcessEnv, name: string, fallback: string): bigint {
  try {
    return parseNear(get(env, name) ?? fallback);
  } catch {
    throw new NearConfigError(`${name} is not a NEAR amount.`);
  }
}
function url(env: NodeJS.ProcessEnv, name: string, fallback: string, placeholder: string): string {
  const v = get(env, name) ?? fallback;
  if (!v.startsWith('https://') || !v.includes(placeholder)) throw new NearConfigError(`${name} must be an https link containing ${placeholder}.`);
  if (/mainnet/i.test(new URL(v.replace(placeholder, 'x')).host) || /^https:\/\/(www\.)?nearblocks\.io/.test(v)) throw new NearConfigError(`${name} points at a mainnet explorer.`);
  return v;
}

/** null when NEAR_NETWORK is unset; otherwise the checked settings, or a NearConfigError naming the variable. */
export function loadNearConfig(env: NodeJS.ProcessEnv = process.env): NearConfig | null {
  const raw = env.NEAR_NETWORK;
  if (raw === undefined || raw.trim() === '') return null;
  if (raw.trim() !== 'testnet') {
    throw new NearConfigError(`NEAR_NETWORK must be testnet. It is "${raw.trim()}". Nearby Passes never runs on mainnet and will not start otherwise.`);
  }
  const rpcUrl = get(env, 'NEAR_RPC_URL') ?? 'https://test.rpc.fastnear.com';
  let host: string;
  try {
    const u = new URL(rpcUrl);
    if (u.protocol !== 'https:') throw new Error();
    host = u.hostname.toLowerCase();
  } catch {
    throw new NearConfigError('NEAR_RPC_URL must be an https URL.');
  }
  if (KNOWN_MAINNET_RPC_HOSTS.includes(host) || host.includes('mainnet')) {
    throw new NearConfigError(`NEAR_RPC_URL (${host}) is a mainnet endpoint. Nearby Passes runs on testnet only.`);
  }
  const contractId = need(env, 'NEAR_PASSES_CONTRACT_ID');
  if (!isTestnetNamedAccount(contractId)) throw new NearConfigError('NEAR_PASSES_CONTRACT_ID must be a .testnet account.');
  const agentAccountId = need(env, 'NEAR_AGENT_ACCOUNT_ID');
  if (!isTestnetNamedAccount(agentAccountId)) throw new NearConfigError('NEAR_AGENT_ACCOUNT_ID must be a .testnet account.');
  const agentPrivateKey = need(env, 'NEAR_AGENT_PRIVATE_KEY');
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(agentPrivateKey)) throw new NearConfigError('NEAR_AGENT_PRIVATE_KEY is not an ed25519 key.');
  const merchantAccounts = json(env, 'NEAR_MERCHANT_ACCOUNTS_JSON');
  for (const [m, a] of Object.entries(merchantAccounts)) {
    if (!/^[0-9a-f-]{36}$/i.test(m)) throw new NearConfigError('NEAR_MERCHANT_ACCOUNTS_JSON keys must be merchant ids.');
    if (!isTestnetNamedAccount(a)) throw new NearConfigError('NEAR_MERCHANT_ACCOUNTS_JSON must name .testnet accounts only.');
  }
  const merchantKeys = json(env, 'NEAR_MERCHANT_KEYS_JSON');
  for (const a of Object.values(merchantAccounts)) {
    if (!merchantKeys[a] || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(merchantKeys[a])) throw new NearConfigError(`NEAR_MERCHANT_KEYS_JSON has no ed25519 key for ${a}.`);
  }
  for (const a of Object.keys(merchantKeys)) if (!isTestnetNamedAccount(a)) throw new NearConfigError('NEAR_MERCHANT_KEYS_JSON must name .testnet accounts only.');
  const secret = need(env, 'NEAR_DEMO_ACCOUNT_SECRET');
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) throw new NearConfigError('NEAR_DEMO_ACCOUNT_SECRET must be 32 random bytes as hex.');
  return {
    network: 'testnet',
    rpcUrl,
    explorerTxUrl: url(env, 'NEAR_EXPLORER_TX_URL', 'https://testnet.near.rocks/tx/{hash}', '{hash}'),
    explorerAccountUrl: url(env, 'NEAR_EXPLORER_ACCOUNT_URL', 'https://testnet.near.rocks/account/{account}', '{account}'),
    contractId,
    agentAccountId,
    agentPrivateKey,
    merchantAccounts,
    merchantKeys,
    demoAccountSecret: Buffer.from(secret, 'hex'),
    storageEstimateYocto: amount(env, 'PASS_STORAGE_ESTIMATE_NEAR', '0.03'),
    merchantFloorYocto: amount(env, 'NEAR_MERCHANT_FLOOR_NEAR', '1'),
    agentFloorYocto: amount(env, 'NEAR_AGENT_FLOOR_NEAR', '0.5'),
  };
}
