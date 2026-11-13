// Shared helpers for the operator's NEAR scripts (Nearby Passes spec 3.7, REQ-14-01, REQ-14-02).
// Rule 3 of the spec: no key is printed, logged or committed. These helpers write keys only into .env.near
// (mode 600, git-ignored) and never return a key to a caller that prints.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const ENV_PATH = resolve(BUILD_DIR, '.env.near')
export const NETWORK = 'testnet'
export const DEFAULT_RPC_URL = 'https://test.rpc.fastnear.com'
export const DEFAULT_EXPLORER_TX_URL = 'https://testnet.near.rocks/tx/{hash}'
export const DEFAULT_EXPLORER_ACCOUNT_URL = 'https://testnet.near.rocks/account/{account}'
export const ONE_NEAR = 10n ** 24n

/** The four NEAR-enabled sample merchants and their seeded offers (spec 3.3, 3.8; ids from src/seed/sampleData.ts). */
export const SAMPLE_MERCHANTS = [
  { slug: 'saguaro-bean', merchantId: '00000000-0000-4000-8000-000000000001', offerId: '00000000-0000-4000-8000-000000000101', name: 'Saguaro Bean Co.', offerTitle: 'Any drink plus pastry', cashBackNear: '0.1' },
  { slug: 'noodle-bar', merchantId: '00000000-0000-4000-8000-000000000002', offerId: '00000000-0000-4000-8000-000000000102', name: 'Fourth Ave Noodle Bar', offerTitle: '15% off lunch for one', cashBackNear: '0.1' },
  { slug: 'rillito-tacos', merchantId: '00000000-0000-4000-8000-000000000006', offerId: '00000000-0000-4000-8000-000000000106', name: 'Rillito Tacos', offerTitle: 'Free horchata with two tacos', cashBackNear: '0.2' },
  { slug: 'dog-wash', merchantId: '00000000-0000-4000-8000-000000000008', offerId: '00000000-0000-4000-8000-000000000108', name: 'Mesquite Dog Wash', offerTitle: 'Self-serve wash', cashBackNear: '0.1' },
]

/** Variables only the operator's machine holds; push-railway.sh never sends them. */
export const OPERATOR_ONLY = ['NEAR_OWNER_ACCOUNT_ID', 'NEAR_OWNER_PRIVATE_KEY', 'NEAR_CONTRACT_PRIVATE_KEY']

export function readEnvFile(path = ENV_PATH) {
  const env = new Map()
  if (!existsSync(path)) return env
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) env.set(m[1], unquote(m[2]))
  }
  return env
}

/** Values are written single-quoted, so `set -a; . ./.env.near` in a shell keeps JSON values intact. */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}
export function unquote(raw) {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/'\\''/g, "'")
  return raw
}

export function writeEnvFile(env, path = ENV_PATH) {
  const body = ['# Nearby Passes, testnet only. Written by scripts/near/*. Holds private keys: never commit, print or share.']
  for (const [k, v] of env) body.push(`${k}=${shellQuote(v)}`)
  writeFileSync(path, body.join('\n') + '\n', { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** Read-modify-write one variable, so a key is on disk before the account that uses it exists. */
export function setEnvVar(name, value, path = ENV_PATH) {
  const env = readEnvFile(path)
  env.set(name, value)
  writeEnvFile(env, path)
}

export function deleteEnvVar(name, path = ENV_PATH) {
  const env = readEnvFile(path)
  env.delete(name)
  writeEnvFile(env, path)
}

export function requireEnv(env, name) {
  const v = env.get(name) ?? process.env[name]
  if (!v) throw new Error(`${name} is not set in .env.near. Run scripts/near/setup-testnet.sh first.`)
  return v
}

/** Known mainnet RPC hosts (spec 3.6.8: "Refused if it is a known mainnet endpoint"); any host naming mainnet too. */
export const KNOWN_MAINNET_RPC_HOSTS = ['rpc.mainnet.near.org', 'rpc.near.org', 'rpc.mainnet.fastnear.com', 'rpc.fastnear.com', 'free.rpc.fastnear.com', 'near.lava.build', 'near.drpc.org', 'mainnet.neardata.xyz', 'archival-rpc.mainnet.near.org', 'beta.rpc.mainnet.near.org']

export function rpcUrl(env) {
  const url = env.get('NEAR_RPC_URL') ?? DEFAULT_RPC_URL
  const host = new URL(url).host.toLowerCase()
  if (KNOWN_MAINNET_RPC_HOSTS.includes(host) || host.includes('mainnet')) {
    throw new Error('NEAR_RPC_URL is a mainnet endpoint. These scripts run on testnet only.')
  }
  return url
}

export function assertTestnetAccount(id, label) {
  if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id) || !(id.endsWith('.testnet') || /^[0-9a-f]{64}$/.test(id))) {
    throw new Error(`${label} (${id}) is not a testnet account id.`)
  }
}

export function txLink(env, hash) {
  return (env.get('NEAR_EXPLORER_TX_URL') ?? DEFAULT_EXPLORER_TX_URL).replace('{hash}', hash)
}
export function accountLink(env, account) {
  return (env.get('NEAR_EXPLORER_ACCOUNT_URL') ?? DEFAULT_EXPLORER_ACCOUNT_URL).replace('{account}', account)
}

export async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'nearby-passes', method, params }) })
  const body = await res.json()
  return body
}

/** The account's state, or null when the network says it does not exist. */
export async function viewAccount(url, accountId) {
  const body = await rpc(url, 'query', { request_type: 'view_account', finality: 'final', account_id: accountId })
  if (body.result) return body.result
  const cause = body.error?.cause?.name
  if (cause === 'UNKNOWN_ACCOUNT') return null
  throw new Error(`RPC error reading ${accountId}: ${body.error?.cause?.name ?? body.error?.message ?? 'unknown'}`)
}

export function formatNear(yocto) {
  const v = BigInt(yocto)
  const whole = v / ONE_NEAR
  const frac = (v % ONE_NEAR).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : `${whole}`
}

export function parseNear(text) {
  const [w, f = ''] = String(text).split('.')
  return BigInt(w) * ONE_NEAR + BigInt((f + '0'.repeat(24)).slice(0, 24))
}

/** The transaction hash of a send result, and every log line of its receipts. */
export function txHashOf(res) {
  return res?.transaction?.hash ?? res?.transaction_outcome?.id
}
export function logsOf(res) {
  return (res?.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? [])
}
export function failureOf(res) {
  const all = [res?.status, ...(res?.receipts_outcome ?? []).map((r) => r.outcome?.status)]
  const f = all.find((s) => s && typeof s === 'object' && 'Failure' in s)
  return f ? JSON.stringify(f.Failure).slice(0, 300) : null
}
