# Deploying Nearby (and Nearby Passes)

Nearby runs as one container: the Fastify server applies the database schema at start, serves the API under `/api`
and serves the built React client. It needs a PostgreSQL database. It is built for Railway with Railway's
PostgreSQL (spec 3.1), and runs anywhere that runs a Dockerfile.

## Environment variables

Every variable is set on the deployed service, never committed. `.env.example` lists the same names with
placeholder values.

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. On Railway, reference the PostgreSQL service's `DATABASE_URL`. |
| `APP_BASE_URL` | Yes | The public URL of the app, e.g. `https://nearby-production.up.railway.app`. PayPal returns the shopper here, and a request that changes anything is accepted only from this origin. |
| `PAYPAL_BASE_URL` | Yes | Must be `https://api-m.sandbox.paypal.com`. The app refuses to start with any other value, unset included. |
| `PAYPAL_CLIENT_ID` | Yes, to take payments | Client id of a PayPal **sandbox** REST app (developer.paypal.com, Apps & Credentials, Sandbox). |
| `PAYPAL_CLIENT_SECRET` | Yes, to take payments | Secret of the same sandbox app. |
| `ANTHROPIC_API_KEY` | No | Claude API key. Without it, every pick comes from the fallback (top two by score, template reason). |
| `ANTHROPIC_MODEL` | No | The Claude model id the agent uses. |
| `AGENT_DISABLED` | No | `true` turns the model off (the kill switch); every pick then comes from the fallback. Read on every request: no restart needed. |
| `GOOGLE_MAPS_SERVER_KEY` | No | Server-side key restricted to the Places API (New). Without it, the map is the SVG plot of Nearby's own merchants. |
| `GOOGLE_MAPS_BROWSER_KEY` | No | Browser key restricted to the Maps JavaScript API and your domain. Without it, the map is the SVG plot. |
| `APP_REPO_URL` | No | When set, the home page footer links to the source repository. |

### Nearby Passes (NEAR testnet)

Without `NEAR_NETWORK` the app runs as Nearby, with no pass controls. With `NEAR_NETWORK=testnet` it needs the
variables below; the operator's `scripts/near/setup-testnet.sh` writes them to `.env.near`, and
`scripts/near/push-railway.sh` sends them to the linked Railway service through standard input (never on a command
line). The app refuses to start if any of them names anything but testnet.

| Variable | Required with passes | What it is |
|---|---|---|
| `NEAR_NETWORK` | Yes | `testnet`. |
| `NEAR_RPC_URL` | No | Default `https://test.rpc.fastnear.com`. A mainnet endpoint is refused. |
| `NEAR_EXPLORER_TX_URL`, `NEAR_EXPLORER_ACCOUNT_URL` | No | Default `https://testnet.near.rocks/tx/{hash}` and `https://testnet.near.rocks/account/{account}`. |
| `NEAR_PASSES_CONTRACT_ID` | Yes | e.g. `contract.nearby-passes.testnet`. |
| `NEAR_AGENT_ACCOUNT_ID` | Yes | e.g. `agent.nearby-passes.testnet`. |
| `NEAR_AGENT_PRIVATE_KEY` | Yes | The agent's function-call key. Secret. |
| `NEAR_MERCHANT_ACCOUNTS_JSON` | Yes | Merchant id to testnet account, for the four NEAR-enabled sample merchants. |
| `NEAR_MERCHANT_KEYS_JSON` | Yes | Testnet account to key, the same four. Secret. |
| `NEAR_DEMO_ACCOUNT_SECRET` | Yes | 32 random bytes, hex; derives visitors' demo accounts. Secret. Keep it stable: changing it gives every browser a new account. |
| `PASS_STORAGE_ESTIMATE_NEAR` | No | Default `0.03` per pass. |
| `NEAR_MERCHANT_FLOOR_NEAR`, `NEAR_AGENT_FLOOR_NEAR` | No | Defaults `1` and `0.5`. |

The owner's and the contract's keys (`NEAR_OWNER_PRIVATE_KEY`, `NEAR_CONTRACT_PRIVATE_KEY` in `.env.near`) never go to
the hosted service. At every start the seed sets the four merchants' NEAR accounts; within the first upkeep run
(about 15 seconds after start, then every five minutes) the app tops each sample offer up to three open passes. The
pass images and metadata are served at `/passes/<id>.svg` and `.json` on `APP_BASE_URL`; the contract's
`media_base_url` must name that address (`set_media_base_url`, owner only, if the host changes). The Google browser
key's allowed sites must include the new address.

`PORT` is set by Railway itself; the server listens on it (3000 when it is not set).

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Builds the client (`dist/client`) and the server (`dist/server`). |
| `npm start` | Applies the schema (from `src/models/schema/`, copied into `dist`), then starts the server. |
| `npm run seed` | Applies the schema and loads the sample data: eight sample merchants and their offers. Safe to run again: it never duplicates. The demo calendar ships with the app. **The container runs it at every start** (`CMD ["sh", "-c", "npm run seed && npm start"]`), so a deploy needs no separate seed step. |

## Railway, step by step

1. Create a project and add a **PostgreSQL** service.
2. Add a service from the GitHub repository. The Dockerfile is detected. If the app is not at the repository root,
   set the service's **Root Directory** to the folder that holds the `Dockerfile`.
3. In the service's **Variables**, set the variables above. `DATABASE_URL` references the PostgreSQL service.
4. In **Settings, Networking**, generate a domain, then set `APP_BASE_URL` to it (with `https://`, no trailing slash).
5. Nothing to seed by hand: the container seeds the sample data at every start, before the server starts (the seed is
   idempotent, so restarts never duplicate data).
6. Deploy. The log line `Server listening` means it is up; `Nearby did not start: PAYPAL_BASE_URL must be the PayPal
   sandbox` means the PayPal variable is wrong.

## Trying a sandbox purchase

Use a PayPal **sandbox personal (buyer)** account (developer.paypal.com, Testing Tools, Sandbox Accounts). Open the
app, Try the demo, choose the Shopper seat, open the week, open an appointment, tap Yes, then Pay with PayPal, and log
in on PayPal's sandbox page with the buyer account. Back in Nearby the receipt shows a redemption code; the sale
appears on that merchant's dashboard within 5 seconds. No real money moves.
