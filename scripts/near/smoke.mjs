#!/usr/bin/env node
// Nearby Passes smoke test on testnet (spec 3.6.9 last paragraph; Part 5 step 3; REQ-14-02, REQ-13-02).
// Usage: node scripts/near/smoke.mjs      Reads .env.near; prints transaction links and results, never a key.
//
// 1. A sample merchant mints a pass for a smoke offer id (not a seeded offer, so the sample counts stay clean).
// 2. The agent claims it into a NEW implicit account (64 hex characters) that does not exist yet (spec 3.6.2).
// 3. The merchant redeems it with 1 yoctoNEAR and 50 TGas; the implicit account now exists and holds the cash back.
// 4. The merchant mints a pass that expires in about a minute; after it expires the owner refunds it.
// 5. Checks of spec 3.3 and 3.5: the agent's key list is one function-call key for claim_pass; the agent's key is
//    refused when it calls redeem_pass. Each step's events (spec 3.4.6) are checked in the transaction logs.
import { Account, KeyPair, keyToImplicitAddress } from 'near-api-js'
import { SAMPLE_MERCHANTS, failureOf, formatNear, logsOf, parseNear, readEnvFile, requireEnv, rpcUrl, txHashOf, txLink, viewAccount } from './lib.mjs'

const env = readEnvFile()
const url = rpcUrl(env)
const contractId = requireEnv(env, 'NEAR_PASSES_CONTRACT_ID')
const agentId = requireEnv(env, 'NEAR_AGENT_ACCOUNT_ID')
const merchantId = JSON.parse(requireEnv(env, 'NEAR_MERCHANT_ACCOUNTS_JSON'))[SAMPLE_MERCHANTS[0].merchantId]
const merchantKey = JSON.parse(requireEnv(env, 'NEAR_MERCHANT_KEYS_JSON'))[merchantId]
const merchant = new Account(merchantId, url, merchantKey)
const agent = new Account(agentId, url, requireEnv(env, 'NEAR_AGENT_PRIVATE_KEY'))
const owner = new Account(requireEnv(env, 'NEAR_OWNER_ACCOUNT_ID'), url, requireEnv(env, 'NEAR_OWNER_PRIVATE_KEY'))
const TGAS = 1_000_000_000_000n
const results = []
let failed = false

function check(ok, what) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed = true }
function event(logs, name) {
  return logs.map((l) => (l.startsWith('EVENT_JSON:') ? JSON.parse(l.slice(11)) : null)).filter(Boolean).find((e) => e.event === name)
}
async function call(account, methodName, args, deposit = 0n, gas = 100n * TGAS) {
  const res = await account.callFunctionRaw({ contractId, methodName, args, deposit, gas })
  const hash = txHashOf(res)
  const f = failureOf(res)
  if (f) throw new Error(`${methodName} failed: ${f} (${txLink(env, hash)})`)
  const status = res.status?.SuccessValue
  const value = status ? JSON.parse(Buffer.from(status, 'base64').toString()) : null
  return { hash, value, logs: logsOf(res) }
}
const view = (method, args) => merchant.provider.callFunction({ contractId, method, args })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** A payout's transfer lands a block or two after the transaction: poll the balance (up to 30 s) until `ok`. */
async function balanceWhen(account, ok) {
  let a = await viewAccount(url, account)
  for (let i = 0; i < 15 && !(a && ok(BigInt(a.amount))); i++) { await sleep(2000); a = await viewAccount(url, account) }
  return a ? BigInt(a.amount) : null
}

const offerId = `smoke-${Date.now()}`
const value = parseNear('0.05')
const storage = parseNear(env.get('PASS_STORAGE_ESTIMATE_NEAR') ?? '0.03')

console.log(`Smoke test on ${contractId} (RPC ${url}), merchant ${merchantId}`)
const cfg = await view('config', {})
console.log('config():', JSON.stringify(cfg))

// 1. Mint
const mint = await call(merchant, 'mint_passes', { offer_id: offerId, title: 'Saguaro Bean Co. pass', description: 'Smoke test pass', value: value.toString(), expires_at_ms: Date.now() + 15 * 60_000, count: 1 }, value + storage)
const tokenId = mint.value[0]
results.push(['mint', mint.hash])
check(!!event(mint.logs, 'nft_mint') && !!event(mint.logs, 'pass_funded'), `mint ${tokenId}: nft_mint and pass_funded logged`)

// 2. Claim into a new implicit account
const receiver = keyToImplicitAddress(KeyPair.fromRandom('ed25519').getPublicKey())
check((await viewAccount(url, receiver)) === null, `receiver ${receiver.slice(0, 8)}… does not exist before the claim`)
const t0 = Date.now()
const claim = await call(agent, 'claim_pass', { merchant_id: merchantId, offer_id: offerId, receiver_id: receiver })
results.push(['claim', claim.hash])
check(claim.value === tokenId, `claim returned ${claim.value} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
check(!!event(claim.logs, 'pass_claimed') && !!event(claim.logs, 'nft_transfer') && !!event(claim.logs, 'nft_metadata_update'), 'claim: pass_claimed, nft_transfer and nft_metadata_update logged')

// 3. Redeem
const redeem = await call(merchant, 'redeem_pass', { token_id: tokenId }, 1n, 50n * TGAS)
results.push(['redeem', redeem.hash])
check(!!event(redeem.logs, 'pass_redeemed') && !!event(redeem.logs, 'nft_metadata_update'), 'redeem: pass_redeemed and nft_metadata_update logged')
const paid = await balanceWhen(receiver, (b) => b >= value)
check(paid !== null && paid >= value, `the implicit account exists after the payout and holds ${paid !== null ? formatNear(paid) : 0} NEAR`)
const p = await view('get_pass', { token_id: tokenId })
check(JSON.stringify(p).includes('Redeemed'), 'get_pass shows Redeemed')

// 5. The agent's key (before the refund wait)
const keys = (await agent.getAccessKeyList()).keys ?? []
const fc = keys[0]?.access_key?.permission?.FunctionCall
check(keys.length === 1 && fc && fc.receiver_id === contractId && JSON.stringify(fc.method_names) === '["claim_pass"]', `agent holds exactly one key: function-call, ${fc?.receiver_id}, ${JSON.stringify(fc?.method_names)}, allowance ${fc?.allowance ? formatNear(fc.allowance) : 'none'} NEAR`)
let refused = null
try { await call(agent, 'redeem_pass', { token_id: tokenId }, 1n, 50n * TGAS) } catch (e) { refused = String(e.message ?? e).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/g, 'ed25519:<hidden>').slice(0, 200) }
check(refused !== null, `the agent's key is refused on redeem_pass: ${refused}`)

// 4. Refund an expired pass
const shortMint = await call(merchant, 'mint_passes', { offer_id: offerId, title: 'Saguaro Bean Co. pass', description: 'Smoke test pass, short expiry', value: value.toString(), expires_at_ms: Date.now() + 60_000, count: 1 }, value + storage)
const shortId = shortMint.value[0]
console.log(`waiting about 70 s for ${shortId} to expire …`)
await sleep(70_000)
const before = BigInt((await viewAccount(url, merchantId)).amount)
const refund = await call(owner, 'refund_expired', { token_id: shortId })
results.push(['refund', refund.hash])
check(!!event(refund.logs, 'pass_refunded') && !!event(refund.logs, 'nft_metadata_update'), 'refund: pass_refunded and nft_metadata_update logged')
const after = await balanceWhen(merchantId, (b) => b - before >= value - parseNear('0.001'))
check(after - before >= value - parseNear('0.001'), `the merchant got the balance back (+${formatNear(after - before)} NEAR)`)

console.log('')
for (const [step, hash] of results) console.log(`${step.padEnd(7)} ${txLink(env, hash)}`)
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED')
process.exit(failed ? 1 : 0)
