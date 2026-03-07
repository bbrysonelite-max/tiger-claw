#!/bin/bash
export ADMIN_TOKEN=tiger-admin-dev
export TIGER_CLAW_API_URL=http://localhost:4000
npx tsx ops/botpool/create_bots.ts --tokens-file /Users/brentbryson/Desktop/tokens_clean.txt
