#!/usr/bin/env bash
# Nearby Passes: create the testnet accounts and write .env.near (spec 3.3, 3.7; REQ-14-01). Run by the operator.
# Usage: bash scripts/near/setup-testnet.sh <parent>      e.g. bash scripts/near/setup-testnet.sh nearby-passes
# Prints account ids and links only; every key goes to .env.near (mode 600, git-ignored). Testnet only.
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v near >/dev/null || { echo "Install near-cli-rs first: npm install -g near-cli-rs@0.31.1" >&2; exit 1; }
[ -d node_modules/near-api-js ] || npm ci
exec node scripts/near/setup-testnet.mjs "$@"
