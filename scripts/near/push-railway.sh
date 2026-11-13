#!/usr/bin/env bash
# Nearby Passes: send the app's NEAR variables from .env.near to the linked Railway service (spec 3.7).
# Each value goes through standard input (railway variable set NAME --stdin), never on a command line or the screen.
# The operator-only variables (the owner's and the contract's keys, and the setup script's working values) stay on
# this machine. Run by the operator in the folder linked to the Railway service (railway link), never against the
# PayPal entry's service "nearby" (spec rule 1): the script refuses that service name.
# Usage: bash scripts/near/push-railway.sh [--service <name>]
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.near ] || { echo "push-railway: .env.near is missing; run setup-testnet.sh first" >&2; exit 1; }
service_args=()
if [ "${1:-}" = "--service" ]; then
  [ "${2:-}" = "nearby" ] && { echo "push-railway: refusing the service 'nearby' (the frozen PayPal entry)" >&2; exit 1; }
  service_args=(--service "$2")
fi
names=(NEAR_NETWORK NEAR_RPC_URL NEAR_EXPLORER_TX_URL NEAR_EXPLORER_ACCOUNT_URL NEAR_PASSES_CONTRACT_ID NEAR_AGENT_ACCOUNT_ID
       NEAR_AGENT_PRIVATE_KEY NEAR_MERCHANT_ACCOUNTS_JSON NEAR_MERCHANT_KEYS_JSON NEAR_DEMO_ACCOUNT_SECRET
       PASS_STORAGE_ESTIMATE_NEAR NEAR_MERCHANT_FLOOR_NEAR NEAR_AGENT_FLOOR_NEAR)
# The shell reads .env.near itself (its values are single-quoted, scripts/near/lib.mjs#shellQuote), so JSON values
# arrive intact. Each value is then piped to railway, never echoed.
set -a; . ./.env.near; set +a
for name in "${names[@]}"; do
  value="${!name-}"
  if [ -z "$value" ]; then echo "push-railway: ${name} is not in .env.near; skipped"; continue; fi
  printf '%s' "$value" | railway variable set "$name" --stdin --skip-deploys ${service_args[@]+"${service_args[@]}"} >/dev/null
  echo "push-railway: ${name} set"
done
unset value
echo "push-railway: done. Redeploy the service to apply them."
