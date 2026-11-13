#!/usr/bin/env node
// Nearby Passes: deploy contracts/passes/target/near/passes.wasm and initialise it once (spec 3.7, F13.2).
// new(owner_id, agent_id, media_base_url): the owner is the parent account; the media base is NEAR_MEDIA_BASE_URL,
// else the planned hosted address (open item B), changeable later with set_media_base_url. Prints no key.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Account } from 'near-api-js'
import { BUILD_DIR, readEnvFile, requireEnv, rpcUrl, txHashOf, txLink, failureOf } from './lib.mjs'

const env = readEnvFile()
const url = rpcUrl(env)
const contractId = requireEnv(env, 'NEAR_PASSES_CONTRACT_ID')
const wasmPath = resolve(BUILD_DIR, 'contracts/passes/target/near/passes.wasm')
if (!existsSync(wasmPath)) { console.error(`deploy: ${wasmPath} is missing; run bash scripts/near/deploy.sh`); process.exit(1) }
const contract = new Account(contractId, url, requireEnv(env, 'NEAR_CONTRACT_PRIVATE_KEY'))

async function initialised() {
  try { await contract.provider.callFunction({ contractId, method: 'config', args: {} }); return true } catch { return false }
}

const code = readFileSync(wasmPath)
const dep = await contract.deployContract(new Uint8Array(code))
console.log(`deployed ${code.length} bytes to ${contractId}: ${txLink(env, txHashOf(dep))}`)
if (await initialised()) {
  console.log('already initialised: code only (no new()).')
} else {
  const mediaBase = env.get('NEAR_MEDIA_BASE_URL') ?? 'https://passes.verticalhorizon.ai/passes/'
  const args = { owner_id: requireEnv(env, 'NEAR_OWNER_ACCOUNT_ID'), agent_id: requireEnv(env, 'NEAR_AGENT_ACCOUNT_ID'), media_base_url: mediaBase }
  const res = await contract.callFunctionRaw({ contractId, methodName: 'new', args, gas: 100_000_000_000_000n, deposit: 0n })
  const f = failureOf(res)
  if (f) { console.error(`deploy: new() failed: ${f}`); process.exit(1) }
  console.log(`initialised: owner ${args.owner_id}, agent ${args.agent_id}, media ${mediaBase}: ${txLink(env, txHashOf(res))}`)
}
console.log('config():', JSON.stringify(await contract.provider.callFunction({ contractId, method: 'config', args: {} })))
