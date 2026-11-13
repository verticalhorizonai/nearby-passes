#!/usr/bin/env node
// Nearby Passes: create the testnet accounts (spec 3.3, 3.7; F13.1; REQ-14-01). The OPERATOR runs this, once:
//   bash scripts/near/setup-testnet.sh <parent>      (for example: nearby-passes)
//
// What it does, testnet only:
//   1. Creates <parent>.testnet and three funding accounts with the faucet (10 NEAR each). Each key pair is made
//      here, in memory; only the PUBLIC key goes to the faucet (near-cli-rs, use-manually-provided-public-key).
//   2. Deletes each funding account with <parent>.testnet as beneficiary, which moves its NEAR to the parent.
//   3. From the parent, creates contract.<parent> (6 NEAR), agent.<parent> (4 NEAR) and the four sample merchants
//      (5 NEAR each). The agent account is created with ONE key: a function-call key for `claim_pass` on the
//      contract with a 3 NEAR gas allowance. It never has a full-access key, which is the end state of spec 3.3.
//   4. Writes the variables of spec 3.6.8 (and the operator-only owner and contract keys) to .env.near, mode 600,
//      git-ignored. Every key is written to .env.near BEFORE the account that uses it is created, so a failed run
//      can be run again and resumes where it stopped.
// It never prints, logs or echoes a key (spec rule 3). It prints account ids, balances and explorer links.

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Account, KeyPair, actions } from 'near-api-js'
import {
  DEFAULT_EXPLORER_ACCOUNT_URL, DEFAULT_EXPLORER_TX_URL, DEFAULT_RPC_URL, ENV_PATH, ONE_NEAR, SAMPLE_MERCHANTS,
  accountLink, deleteEnvVar, formatNear, readEnvFile, rpcUrl, setEnvVar, viewAccount,
} from './lib.mjs'

const AMOUNTS = { contract: 6n * ONE_NEAR, agent: 4n * ONE_NEAR, merchant: 5n * ONE_NEAR }
const AGENT_ALLOWANCE = 3n * ONE_NEAR
const FUNDERS = 3
const NEEDED_IN_PARENT = AMOUNTS.contract + AMOUNTS.agent + 4n * AMOUNTS.merchant + ONE_NEAR / 2n

function say(line) { process.stdout.write(`${line}\n`) }
function fail(line) { process.stderr.write(`setup-testnet: ${line}\n`); process.exit(1) }

const parentName = process.argv[2]
if (!parentName || !/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(parentName) || parentName.length > 40) {
  fail('give the parent name as the only argument, lowercase letters, digits and dashes, no ".testnet" (for example: nearby-passes).')
}
const parent = `${parentName}.testnet`
let env = readEnvFile()
if (env.get('NEAR_OWNER_ACCOUNT_ID') && env.get('NEAR_OWNER_ACCOUNT_ID') !== parent) {
  fail(`.env.near already belongs to ${env.get('NEAR_OWNER_ACCOUNT_ID')}. Use that name, or move .env.near aside first.`)
}
const url = rpcUrl(env)

async function waitForAccount(id, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const a = await viewAccount(url, id)
    if (a) return a
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

/** A key pair for `varName`: the one already in .env.near, or a new one written there first. Never printed. */
function keyFor(varName) {
  env = readEnvFile()
  const existing = env.get(varName)
  if (existing) return KeyPair.fromString(existing)
  const kp = KeyPair.fromRandom('ed25519')
  setEnvVar(varName, kp.toString())
  env = readEnvFile()
  return kp
}

async function faucetCreate(id, varName) {
  const state = await viewAccount(url, id)
  if (state) {
    if (!readEnvFile().get(varName)) fail(`${id} already exists and its key is not in .env.near. Choose another parent name.`)
    say(`  ${id} exists (${formatNear(state.amount)} NEAR)`)
    return
  }
  const kp = keyFor(varName)
  const pub = kp.getPublicKey().toString()
  say(`  asking the faucet for ${id} …`)
  const r = spawnSync('near', ['account', 'create-account', 'sponsor-by-faucet-service', id, 'use-manually-provided-public-key', pub, 'network-config', 'testnet', 'create'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (r.error) fail(`could not run near-cli-rs (${r.error.code}). Install it: npm install -g near-cli-rs@0.31.1`)
  const created = await waitForAccount(id)
  if (!created) {
    const msg = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /error|limit|exist|fail/i.test(l)).slice(0, 3).join(' / ')
    fail(`the faucet did not create ${id}. near-cli-rs said: ${msg || 'nothing useful'}. Wait a few minutes and run the same command again; it resumes.`)
  }
  say(`  ${id} created (${formatNear(created.amount)} NEAR)`)
}

async function main() {
  say(`Nearby Passes testnet setup for ${parent} (RPC ${url})`)

  say('1. Parent account')
  await faucetCreate(parent, 'NEAR_OWNER_PRIVATE_KEY')
  setEnvVar('NEAR_OWNER_ACCOUNT_ID', parent)
  const owner = new Account(parent, url, readEnvFile().get('NEAR_OWNER_PRIVATE_KEY'))

  say('2. Funding accounts (their NEAR moves to the parent)')
  for (let i = 1; i <= FUNDERS; i++) {
    const id = `${parentName}-fund-${i}.testnet`
    const done = `NEAR_SETUP_FUND_${i}_DONE`
    if (readEnvFile().get(done)) { say(`  ${id} already moved to the parent`); continue }
    const parentState = await viewAccount(url, parent)
    if (BigInt(parentState.amount) >= NEEDED_IN_PARENT) { say(`  the parent holds enough (${formatNear(parentState.amount)} NEAR); ${id} not needed`); continue }
    const keyVar = `NEAR_SETUP_FUND_${i}_KEY`
    await faucetCreate(id, keyVar)
    const funder = new Account(id, url, readEnvFile().get(keyVar))
    await funder.signAndSendTransaction({ receiverId: id, actions: [actions.deleteAccount(parent)] })
    setEnvVar(done, '1')
    deleteEnvVar(keyVar)
    say(`  ${id} deleted into ${parent}`)
  }
  // A deleted account's balance reaches the beneficiary a block or two after the transaction: wait for it.
  let parentState = await viewAccount(url, parent)
  for (let i = 0; i < 15 && BigInt(parentState.amount) < NEEDED_IN_PARENT; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    parentState = await viewAccount(url, parent)
  }
  say(`  parent balance: ${formatNear(parentState.amount)} NEAR`)

  const contractId = `contract.${parent}`
  const agentId = `agent.${parent}`
  const subs = [
    { id: contractId, amount: AMOUNTS.contract, keyVar: 'NEAR_CONTRACT_PRIVATE_KEY', kind: 'full' },
    { id: agentId, amount: AMOUNTS.agent, keyVar: 'NEAR_AGENT_PRIVATE_KEY', kind: 'agent' },
    ...SAMPLE_MERCHANTS.map((m) => ({ id: `${m.slug}.${parent}`, amount: AMOUNTS.merchant, keyVar: `NEAR_SETUP_MERCHANT_${m.slug.replace(/-/g, '_').toUpperCase()}_KEY`, kind: 'full' })),
  ]
  const missing = []
  for (const s of subs) if (!(await viewAccount(url, s.id))) missing.push(s)
  const need = missing.reduce((t, s) => t + s.amount, 0n) + ONE_NEAR / 2n
  if (missing.length && BigInt(parentState.amount) < need) {
    fail(`the parent holds ${formatNear(parentState.amount)} NEAR and needs about ${formatNear(need)} for the accounts still to create. Send it NEAR with the web faucet (https://docs.near.org/getting-started/faucet), then run the same command again.`)
  }

  say('3. Contract, agent and sample merchant accounts')
  for (const s of subs) {
    const state = await viewAccount(url, s.id)
    if (state) {
      if (!readEnvFile().get(s.keyVar)) fail(`${s.id} exists and its key is not in .env.near. Use a new parent name.`)
      say(`  ${s.id} exists (${formatNear(state.amount)} NEAR)`)
      continue
    }
    const kp = keyFor(s.keyVar)
    const pub = kp.getPublicKey()
    const keyAction = s.kind === 'agent'
      ? actions.addFunctionCallAccessKey(pub, contractId, ['claim_pass'], AGENT_ALLOWANCE)
      : actions.addFullAccessKey(pub)
    await owner.signAndSendTransaction({ receiverId: s.id, actions: [actions.createAccount(), actions.transfer(s.amount), keyAction] })
    const made = await waitForAccount(s.id)
    if (!made) fail(`${s.id} was not created. Run the same command again; it resumes.`)
    say(`  ${s.id} created (${formatNear(made.amount)} NEAR)${s.kind === 'agent' ? ', one function-call key: claim_pass on the contract, 3 NEAR allowance' : ''}`)
  }

  say('4. The app variables (.env.near, mode 600)')
  env = readEnvFile()
  const merchantAccounts = Object.fromEntries(SAMPLE_MERCHANTS.map((m) => [m.merchantId, `${m.slug}.${parent}`]))
  const merchantKeys = Object.fromEntries(SAMPLE_MERCHANTS.map((m) => [`${m.slug}.${parent}`, env.get(`NEAR_SETUP_MERCHANT_${m.slug.replace(/-/g, '_').toUpperCase()}_KEY`)]))
  const defaults = {
    NEAR_NETWORK: 'testnet',
    NEAR_RPC_URL: DEFAULT_RPC_URL,
    NEAR_EXPLORER_TX_URL: DEFAULT_EXPLORER_TX_URL,
    NEAR_EXPLORER_ACCOUNT_URL: DEFAULT_EXPLORER_ACCOUNT_URL,
    PASS_STORAGE_ESTIMATE_NEAR: '0.03',
    NEAR_MERCHANT_FLOOR_NEAR: '1',
    NEAR_AGENT_FLOOR_NEAR: '0.5',
  }
  for (const [k, v] of Object.entries(defaults)) if (!env.get(k)) setEnvVar(k, v)
  setEnvVar('NEAR_PASSES_CONTRACT_ID', contractId)
  setEnvVar('NEAR_AGENT_ACCOUNT_ID', agentId)
  setEnvVar('NEAR_MERCHANT_ACCOUNTS_JSON', JSON.stringify(merchantAccounts))
  setEnvVar('NEAR_MERCHANT_KEYS_JSON', JSON.stringify(merchantKeys))
  if (!readEnvFile().get('NEAR_DEMO_ACCOUNT_SECRET')) setEnvVar('NEAR_DEMO_ACCOUNT_SECRET', randomBytes(32).toString('hex'))

  const keys = await new Account(agentId, url).getAccessKeyList()
  const list = keys.keys ?? []
  const fc = list.filter((k) => k.access_key?.permission?.FunctionCall)
  say('')
  say(`Done. ${ENV_PATH} holds the variables and the keys; nothing was printed.`)
  say(`  parent   ${parent}  ${accountLink(env, parent)}`)
  say(`  contract ${contractId}  ${accountLink(env, contractId)}`)
  say(`  agent    ${agentId}  ${accountLink(env, agentId)}  keys: ${list.length} (${fc.length} function-call)`)
  for (const m of SAMPLE_MERCHANTS) say(`  merchant ${m.slug}.${parent}  ${accountLink(env, `${m.slug}.${parent}`)}`)
  say('Next: bash scripts/near/deploy.sh')
}

main().catch((e) => fail(String(e?.message ?? e).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/g, 'ed25519:<hidden>')))
