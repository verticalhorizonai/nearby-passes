#!/usr/bin/env bash
# Nearby Passes: create a new agent account with a new limited key and call set_agent (spec 3.3, 3.7). Operator only.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/near/rotate-agent.mjs
