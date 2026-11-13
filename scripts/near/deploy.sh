#!/usr/bin/env bash
# Nearby Passes: build the passes contract and deploy it to the contract account (spec 3.7; F13.2; REQ-14-02).
# The first run deploys and calls new(); a later run redeploys the code only. Run by the operator.
# Usage: bash scripts/near/deploy.sh          Reads .env.near (written by setup-testnet.sh); prints no key.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
( cd contracts/passes && cargo near build non-reproducible-wasm )
[ -d node_modules/near-api-js ] || npm ci
exec node scripts/near/deploy.mjs
