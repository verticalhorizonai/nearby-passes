#!/usr/bin/env node
// Nearby Passes: replace the agent account when its key's gas allowance runs low (spec 3.3, 3.7; REQ-14-01).
// A function-call key's allowance cannot be raised, so a new agent account agent-<n>.<parent> is created with one
// new function-call key (claim_pass on the contract, 3 NEAR allowance) and 4 NEAR, then the owner calls set_agent.
// .env.near gets the new NEAR_AGENT_ACCOUNT_ID and NEAR_AGENT_PRIVATE_KEY; the app picks them up at its next start
// (push-railway.sh for the hosted app). Run by the operator. Prints no key.
import { Account, KeyPair, actions } from 'near-api-js'
import { ONE_NEAR, failureOf, readEnvFile, requireEnv, rpcUrl, setEnvVar, txHashOf, txLink, viewAccount } from './lib.mjs'

const env = readEnvFile()
const url = rpcUrl(env)
const parent = requireEnv(env, 'NEAR_OWNER_ACCOUNT_ID')
const contractId = requireEnv(env, 'NEAR_PASSES_CONTRACT_ID')
const owner = new Account(parent, url, requireEnv(env, 'NEAR_OWNER_PRIVATE_KEY'))
let n = 2
while (await viewAccount(url, `agent-${n}.${parent}`)) n++
const newId = `agent-${n}.${parent}`
const kp = KeyPair.fromRandom('ed25519')
setEnvVar('NEAR_SETUP_NEXT_AGENT_KEY', kp.toString())
await owner.signAndSendTransaction({ receiverId: newId, actions: [actions.createAccount(), actions.transfer(4n * ONE_NEAR), actions.addFunctionCallAccessKey(kp.getPublicKey(), contractId, ['claim_pass'], 3n * ONE_NEAR)] })
const res = await owner.callFunctionRaw({ contractId, methodName: 'set_agent', args: { agent_id: newId }, deposit: 1n, gas: 30_000_000_000_000n })
const f = failureOf(res)
if (f) { console.error(`rotate-agent: set_agent failed: ${f}`); process.exit(1) }
setEnvVar('NEAR_AGENT_ACCOUNT_ID', newId)
setEnvVar('NEAR_AGENT_PRIVATE_KEY', kp.toString())
console.log(`new agent ${newId}; set_agent: ${txLink(env, txHashOf(res))}. Restart the app (and run push-railway.sh for the hosted one).`)
