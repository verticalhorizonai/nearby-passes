# Nearby Passes

Nearby Passes turns a local offer into a NEAR NFT that holds money and pays it out by rule. A sample merchant funds a
few passes for an offer; Nearby's AI agent matches the offer to a stop on the shopper's calendar; after one tap the
agent's narrowly limited key claims a pass into the shopper's NEAR account; the merchant redeems it at the counter
and the contract pays the cash back to whoever holds the pass. Unused passes refund to the merchant after they expire.

Everything runs on **NEAR testnet**. Every merchant, offer and pass is sample data, and testnet NEAR has no value.

| Track | How it fits |
|---|---|
| `nfts` NFTs That Do Something | Each pass is an NEP-171 token that holds a balance, carries the right to an offer, and changes status, image and metadata as it is claimed, redeemed or refunded. |
| `security` AI Security & Defense | The agent's only key is a function-call key for one method (`claim_pass`) on one contract, with a 3 NEAR gas allowance and no way to attach a deposit. The contract accepts claims from that account alone, and the owner can pause claiming on chain. |
| `agents` Agent Economy | Nearby's agent acts on chain for the shopper and pays the gas for each claim; any outside agent can find funded passes through Nearby's public MCP server. |

> **Sample data notice.** Every merchant, offer, appointment and pass in this demo is made up and labelled as sample
> data. None is a real business or person. Passes use NEAR testnet only. Payments for offers run in the PayPal sandbox;
> no real money moves anywhere.

## Try it

The hosted demo is at **https://passes.verticalhorizon.ai**. No wallet, no account and no sign-in.

1. Open the demo. See the home page's **Passes on NEAR** section with **How to test passes** and **What the agent can
   do**.
2. Tap **Try the demo**, then the **A shopper's week** card. See **Passes go to** and a short account id in the
   header: a testnet demo account derived for this browser. Tap it to see the full id and its explorer link.
3. Open **Tuesday 9:30, Client meeting**. See the **Saguaro Bean Co.** pick with **Pass: 0.1 testnet NEAR back**.
4. Tap **Claim as pass**, read the sheet, tap **Yes, claim it**. Within about ten seconds see the pass number (for
   example `pass-12`) and a link to the claim transaction on the explorer.
5. Tap **Switch seat** and choose **Saguaro Bean Co.** In **Redeem a pass**, type the pass number and tap **Look up**,
   then **Redeem**. See **Redeemed. 0.1 testnet NEAR sent to the holder.** and the transaction link.
6. Switch back to the shopper and open **My passes**. See the pass as **Redeemed** with **0.1 testnet NEAR paid to
   your account**, and its image, which the app redraws from the pass's status.
7. To see a refund: as Saguaro Bean Co., tap **Fund passes** on its offer, choose an expiry of **5 minutes** and tap
   **Fund**. After five minutes the pass shows **Refund available**; tap **Refund expired** and see the balance
   return to the merchant's account.
8. A second browser (or a private window) gets its own demo account and can claim the same offer's pass.
9. Optional: in the account panel, tap **Use my NEAR testnet wallet** and sign in with a testnet wallet through NEAR
   Connect. Nothing is signed for a transaction; later passes go to your own account.
10. As the merchant, see **Pass activity** beside the sales: claims, fundings, redemptions and refunds, with links.

Every transaction is visible on the testnet explorer, with the contract's events in its logs.

## What the agent can do

The home page shows the agent account's keys as the network reports them at that moment.

| Question | Answer | Enforced by |
|---|---|---|
| Which contract can the agent call? | The passes contract only | The function-call key's receiver |
| Which method? | `claim_pass` only | The key's method list |
| Can it move NEAR? | No. A function-call key cannot attach a deposit | The protocol |
| How much gas can it spend? | The key's allowance, 3 NEAR, which cannot be raised | The protocol |
| Can it claim a pass for anyone? | Only an Open, unexpired pass, one per account per merchant and offer | The contract |
| Can it redeem or refund? | No. Redeem is the merchant's, with a deposit the key cannot attach | The contract and the protocol |
| Can a person stop it? | Yes. The owner pauses claiming on chain, or replaces the agent | The contract |
| Can the model reach the key? | No. Claude has no claim tool; the claim route needs the shopper's single-use token | The app |

Testnet accounts:

| Account | Role | Explorer |
|---|---|---|
| `contract.nearby-passes.testnet` | The passes contract (`contracts/passes/`) | https://testnet.near.rocks/account/contract.nearby-passes.testnet |
| `agent.nearby-passes.testnet` | Nearby's agent: one function-call key for `claim_pass` | https://testnet.near.rocks/account/agent.nearby-passes.testnet |
| `nearby-passes.testnet` | Contract owner (pause, set agent) | https://testnet.near.rocks/account/nearby-passes.testnet |
| `saguaro-bean.`, `noodle-bar.`, `rillito-tacos.`, `dog-wash.nearby-passes.testnet` | Sample merchants [Sample] | https://testnet.near.rocks/account/saguaro-bean.nearby-passes.testnet |

## How passes work

- **The contract** (`contracts/passes/`, Rust, `near-sdk` 5.30.1 and `near-contract-standards` 5.30.1) is an NEP-171
  NFT with NEP-177 metadata and NEP-181 enumeration. Each pass records its merchant, offer, balance, expiry and status
  (Open, Claimed, Redeemed, Refunded).
  - `mint_passes`: anyone may call; the caller is the merchant and attaches the balances plus the storage the passes
    use. The contract measures the storage, keeps what it needs and refunds the rest. Open passes are owned by the
    contract account and cannot be transferred.
  - `claim_pass`: the agent account only, while claiming is not paused. It moves the oldest Open, unexpired pass of
    that merchant and offer to the receiver, and allows one claim per receiving account per merchant and offer.
  - `redeem_pass`: the pass's merchant only, with exactly 1 yoctoNEAR (which a function-call key cannot attach), while
    the pass is Claimed and unexpired. The status changes first, then the balance is paid to whoever holds the pass.
  - `refund_expired`: anyone, at or after expiry, for an Open or Claimed pass. The balance returns to the merchant.
  - `set_claims_paused`, `set_agent`, `set_media_base_url`: the owner only, with 1 yoctoNEAR.
  - Every status change rewrites the token's metadata and logs `nft_metadata_update` (NEP-171 1.2.0) and Nearby's own
    `nearby_pass` events (`pass_funded`, `pass_claimed`, `pass_redeemed`, `pass_refunded`, `claims_paused`).
  - Each payout is followed by a private callback, `on_payout`: if the transfer fails, the pass returns to its earlier
    status and logs `payout_failed`, so the balance is never stranded and a second redeem or refund can pay.
- **The visitor's account** is derived, not created: an ed25519 key from HMAC-SHA256 of a server secret and the
  browser's session, and the 64-character implicit account of its public key. NEAR creates that account on its first
  incoming transfer, the cash back. The key never leaves the server. Reset demo moves the browser to a new account.
- **One yes.** Claim as pass uses the same single-use confirmation token as PayPal checkout, minted only by the
  shopper's tap and bound to the pick and the browser. A pick is settled one way: bought with PayPal, or claimed as a
  pass. The receiver, the merchant and the offer come from the server, never from the request.
- **The contract is the source of truth.** The app reads a pass's status from the contract's views (cached for at
  most ten seconds, never before an action) and keeps no copy of it.
- **Upkeep.** Every five minutes the app refunds sample passes that expired more than fifteen minutes ago and tops
  each sample offer back up to three open passes, unless the merchant account runs low.
- **Guardrails.** The app refuses to start unless every NEAR setting names testnet. Claims are limited to 5 per
  browser and 60 in all per hour. The app hides Claim as pass when claiming is paused or the agent runs low on gas.
  Every NEAR call goes through one adapter; the tests use a fake that keeps the contract's rules.

One honest limit: a pass is a token in one contract that keeps its balance for it, not an account of its own. Giving
each pass its own sub-account is out of scope.

## Run the tests

No key and no network are needed.

```bash
npm run test:contract   # the contract's unit tests (Rust; rust-toolchain.toml pins 1.95.0)
npm test                # the app's tests (Vitest; needs a local PostgreSQL, see below)
```

`npm test` uses a PostgreSQL database named by `TEST_DATABASE_URL` (default
`postgres://postgres@localhost:55432/nearby_test`; each test file uses its own throwaway schema). One way to start one:

```bash
docker run -d --name nearby-test-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=nearby_test -p 55432:5432 postgres:16-alpine
```

Prerequisites: Node 22.22.2 or later and npm (`npm ci` first); Rust through rustup for the contract tests. `npm run
lint` runs ESLint and the type checks; `npm run build` builds the app.

## Run it yourself

You need Node 22.22.2 or later, PostgreSQL, Rust through rustup, `cargo-near` 0.23.0 and `near-cli-rs` 0.31.1:

```bash
cargo install cargo-near --version 0.23.0 --locked
npm install -g near-cli-rs@0.31.1
```

Then, from this folder:

```bash
npm ci
bash scripts/near/setup-testnet.sh <your-parent-name>   # creates and funds the testnet accounts; writes .env.near (no key is printed)
bash scripts/near/deploy.sh                              # builds the contract, deploys it and calls new()
cp .env.example .env                                     # fill in DATABASE_URL, APP_BASE_URL and the optional keys
set -a; . ./.env; . ./.env.near; set +a
npm run build
npm run seed                                             # sample merchants and offers, with the four merchants' NEAR accounts
npm run near:seed                                        # tops each sample offer up to three open passes
npm start                                                # http://localhost:3000
```

`setup-testnet.sh` uses the NEAR testnet faucet (10 NEAR per new account) for the parent and three funding accounts,
then creates the contract, the agent (with its one function-call key) and four sample merchants. `node
scripts/near/smoke.mjs` runs mint, claim, redeem and refund on testnet and prints the four transaction links.
`scripts/near/rotate-agent.sh` replaces the agent when its gas allowance runs low; `scripts/near/push-railway.sh`
sends the NEAR variables to a linked Railway service through standard input.

Without `NEAR_NETWORK`, the app runs as Nearby does, with no pass controls.

## Disclosure

Nearby was first built in November 2026 as an entry to the PayPal AI Hackathon: calendar-aware local offers with
PayPal sandbox checkout (https://github.com/verticalhorizonai/nearby). Everything about passes is new in this
repository: the passes contract, the operator scripts, the agent's limited key, the visitors' NEAR accounts, and every
pass-related change to the app (claiming, My passes, the merchant's NEAR panel, funding, redeeming, refunds, upkeep,
the home page sections, and the pass facts given to the agent and the MCP tools). The comparison of the two tags shows
exactly what: https://github.com/verticalhorizonai/nearby-passes/compare/pre-hackathon...hackathon-submission

The code was written with Claude Code (Anthropic) as the coding agent, under the owner's direction.

Libraries: `near-sdk` and `near-contract-standards` 5.30.1 (contract); `near-api-js` 7.4.0 (server signing and views);
Fastify, React, Vite, Tailwind CSS with shadcn/ui, PostgreSQL (`pg`), Vitest, the MCP TypeScript SDK; Claude through
the Anthropic Messages API; the PayPal Orders v2 REST API (sandbox); Google Places and the Maps JavaScript API.

## How Nearby works (the app the passes build on)

- **The calendar, over MCP.** `nearby-calendar-mcp` is a small read-only MCP server in this repository
  (`src/services/calendarMcp/`). It has one tool, `list_upcoming_appointments`, and one back end: the demo calendar
  of five sample appointments around Tucson and two events that are skipped (a video call and an all-day reminder).
  Each is placed on the next occurrence of its weekday, so the demo never goes stale. The server runs as a child
  process over stdio; the agent service is its MCP client.
- **Matching is code, not the model.** For each appointment, plain code finds the offers within one mile (three if
  nothing fits), valid on that weekday and within 45 minutes before to 60 minutes after the appointment, not already
  bought, and with a sensible time fit for the category (coffee in the morning, dinner in the evening). Each gets a
  score from distance and time fit; ties go to the nearer one. All times are America/Phoenix.
- **The agent.** Claude, through the Anthropic Messages API with tool use, run on the server. It has four tools:
  `list_upcoming_appointments`, `find_places_near`, `find_offer_candidates` and `propose_offer`. It chooses at most two
  of the matched offers and writes a one-sentence reason for each. Its output is checked in code before anything is
  shown: only matched offers, at most two, at most 25 words. Distances shown are always the code's. While it runs, My
  week and the stop's page show its tool calls live, as they happen ("Reading your week", "Looking up places",
  "Checking 3 offers", "Choosing"), then what it came to ("2 picks", "1 pick", "Nothing fits").
- **One yes.** Claude has no payment tool. Tapping Yes mints a single-use confirmation token (256 random bits, stored
  only as a hash, valid for 10 minutes, bound to that pick and that browser). Only the purchase route can create a
  PayPal order, and only with that token. The amount is the offer's price read from the database, never from the
  browser or the model.
- **PayPal.** Orders v2 REST from the server, sandbox only: the app refuses to start unless `PAYPAL_BASE_URL` is the
  sandbox. Create the order, send the shopper to PayPal's sandbox page to approve, capture on return. A second return
  shows the same receipt and captures nothing; a cancel returns the shopper to the pick.
- **The demo never depends on the model or on Google.** With the kill switch on (`AGENT_DISABLED=true`), a model
  error or a 20-second timeout, output that fails the checks, or a rate limit reached (30 requests per browser per
  hour, 300 in all), picks are the top two by score with a templated reason. With no Google key, the map is a drawn
  plot of the appointment and Nearby's own merchants.
- **Merchants.** Any visitor can open a sample merchant's dashboard and post an offer. A posted offer belongs to the
  browser that posted it: it is shown, matched for picks and sold only there, and only that browser can edit or
  remove it. The eight sample offers are shared and never change; editing one makes that browser's own version,
  which replaces the sample offer in its demo only. Removing or editing an offer never changes a past sale or
  receipt; removing your version, or Reset demo, brings the sample offer back.
- **Every outside service is behind one adapter** (PayPal, Anthropic, Google Places), each with recorded fixtures.
  The automated tests use the fixtures only and never call a live service.

## Bring your own agent

Nearby's offers are open to any AI assistant that speaks MCP, and the purchase is still one person's yes. The app
serves a small read-only MCP server at `/mcp` on its own address (for a local run, `http://localhost:3000/mcp`):
Streamable HTTP, stateless, no sign-in.

Add it to an MCP client as a Streamable HTTP (or "HTTP") server with that URL. For example, in Claude Code:

```bash
claude mcp add --transport http nearby https://your-nearby-address/mcp
```

or, in a client that reads a JSON configuration:

```json
{ "mcpServers": { "nearby": { "type": "http", "url": "https://your-nearby-address/mcp" } } }
```

It has two tools. Neither can buy anything.

- **`find_offers_near`** takes `lat`, `lng`, `starts_at` (ISO 8601 with an offset, for example
  `2026-11-17T09:30:00-07:00`) and an optional `radius_miles` (at most 3). It runs the app's own matching for a stop
  at that place and time (treated as a one-hour appointment) and returns at most two offers, best first, each with
  `offer_id`, `merchant`, `sample`, `title`, `price` and `price_cents`, `deposit`, `distance` (as the app's card
  writes it, for example `0.2 mi`), `valid_window`, `time_fit`, `score` and `checkout_url`. Outside the demo area
  around Tucson, or for a start that is not within the next 7 days, the list is empty and `note` says why.
- **`get_offer`** takes an `offer_id` and returns the same fields without the distance. Given `lat`, `lng` and
  `starts_at` as well, it also returns that stop's `time_fit`, `score` and `checkout_url`; without them those are
  `null`.
- Both tools also take two optional strings, `title` (what the stop is, for example "Lunch with Sam") and `place` (a
  short name for the location, for example "Fourth Avenue, Tucson"). They are trimmed, cut to 80 characters and
  carried in `checkout_url`, so the person sees the stop by its name. They never change which offers match.

The tools call no model and no outside service, write nothing, and are rate limited per client address (60 requests
a minute). To buy, a person opens `checkout_url` in a browser. That page changes nothing: it shows the offer with its
Sample badge, the price from Nearby's database, the place and the time, and one button, **Review in Nearby**. The
button checks again that the offer still fits, adds the stop to that browser's week ("Added by your assistant") with
the offer as a pick ("Suggested by your assistant"), and opens the stop. From there it is the usual flow: Yes, the
confirmation sheet, approval on PayPal's sandbox page, the receipt. The pick's sentence is Nearby's own template. The
`title` and `place` in the link are shown as plain text (at most 80 characters each), in place of "Stop from your
assistant" and "Near <coordinates>", and are never given to the model. Reset demo removes these stops with their
picks.

Stack: TypeScript and Node with Fastify, React built with Vite, Tailwind CSS with shadcn/ui components, PostgreSQL,
Vitest.

With passes on, each offer the two tools return also carries `pass`: `null`, or `open_count` and `cash_back` (for
example `0.1 testnet NEAR`). The checkout link lands on the stop, where the pass is claimed with the same one yes.
Neither tool can claim one.

## Environment variables

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. |
| `APP_BASE_URL` | The app's public URL. PayPal returns here; changes are accepted only from this origin. |
| `ANTHROPIC_API_KEY` | Claude API key (optional: without it, every pick comes from the fallback). |
| `ANTHROPIC_MODEL` | The Claude model id. |
| `AGENT_DISABLED` | `true` turns the model off (the kill switch). |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | A PayPal sandbox REST app's credentials. |
| `PAYPAL_BASE_URL` | Must be `https://api-m.sandbox.paypal.com`. |
| `GOOGLE_MAPS_SERVER_KEY` | Places API (New) key, server side (optional). |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps JavaScript API key for the browser (optional). |
| `APP_REPO_URL` | When set, the home page links to the source and to the contract's source. |
| `NEAR_NETWORK` | `testnet` turns passes on; anything else stops the start; unset, passes are off. |
| `NEAR_RPC_URL` | Testnet RPC (default `https://test.rpc.fastnear.com`); a mainnet endpoint is refused. |
| `NEAR_EXPLORER_TX_URL`, `NEAR_EXPLORER_ACCOUNT_URL` | Explorer link patterns with `{hash}` and `{account}` (default `testnet.near.rocks`). |
| `NEAR_PASSES_CONTRACT_ID` | The passes contract, a `.testnet` account. |
| `NEAR_AGENT_ACCOUNT_ID`, `NEAR_AGENT_PRIVATE_KEY` | The agent account and its function-call key. Secret. |
| `NEAR_MERCHANT_ACCOUNTS_JSON` | Which sample merchants have NEAR accounts (merchant id to account id). |
| `NEAR_MERCHANT_KEYS_JSON` | The sample merchants' testnet keys. Secret. |
| `NEAR_DEMO_ACCOUNT_SECRET` | 32 random bytes, hex, from which visitors' demo accounts are derived. Secret. |
| `PASS_STORAGE_ESTIMATE_NEAR` | Storage attached per pass when funding (default `0.03`); the contract refunds the excess. |
| `NEAR_MERCHANT_FLOOR_NEAR`, `NEAR_AGENT_FLOOR_NEAR` | Upkeep floors (defaults `1` and `0.5`). |

Credentials live only in environment variables; `.env.example` holds placeholders and `scripts/near/setup-testnet.sh`
writes the NEAR ones to a git-ignored `.env.near`. Deployment: `DEPLOY.md`.

## The design

The three approved reference screens are in `design/` (`home.html`, `choose-a-seat.html`,
`appointment-detail.html`): the record of the look the app is built to.

## Licence

MIT. See `LICENSE`. The shadcn/ui components under `src/components/ui/` follow shadcn/ui's form (MIT); the Inter and
Bricolage Grotesque fonts are bundled under the SIL Open Font License.
