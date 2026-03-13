#!/bin/bash
# Import Telegram bot tokens into the bot pool.
# Set required env vars before running (e.g. via .env.deploy or export):
#
#   export ADMIN_TOKEN=<your-admin-token>
#   export TIGER_CLAW_API_URL=https://<your-api-host>
#   export TOKENS_FILE=/path/to/tokens.txt
#
set -euo pipefail

: "${ADMIN_TOKEN:?ERROR: ADMIN_TOKEN must be set}"
: "${TIGER_CLAW_API_URL:?ERROR: TIGER_CLAW_API_URL must be set}"
: "${TOKENS_FILE:?ERROR: TOKENS_FILE must be set (path to tokens text file, one per line)}"

npx tsx ops/botpool/create_bots.ts --tokens-file "$TOKENS_FILE"
