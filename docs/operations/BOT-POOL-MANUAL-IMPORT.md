# Bot Token Pool — Manual Import Guide

**Phase:** P4-5
**Related:** P3-0 (pool infrastructure), `ops/botpool/create_bots.ts`

This guide covers the manual process for creating Telegram bot tokens and loading them into the Tiger Claw bot token pool. The MTProto automation (`create_bots.ts`) is shelved for Phase 4 — all token creation is manual via @BotFather.

---

## Minimum Token Counts

| Milestone | Formula | Example |
|-----------|---------|---------|
| **First canary** | 5 canary tenants + 5 reserve = **10 minimum** | 10 tokens |
| **First fleet rollout** | total expected tenants + 20% buffer | 25 tenants → 30 tokens |
| **Low-pool alert threshold** | Fires when unassigned < 50 | Keep pool above 50 to avoid alerts |
| **Steady-state target** | 3 months of projected growth + 50 reserve | Varies |

> **For P4-4 (first canary deployment):** Create and load at least **10 tokens** before starting.

---

## Step 1 — Create Bot Tokens via @BotFather

Repeat this process for each token needed:

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. When prompted for a name, enter: `Tiger Claw Agent <N>` (e.g., `Tiger Claw Agent 001`)
4. When prompted for a username, enter: `tc_agent_<N>_bot` (e.g., `tc_agent_001_bot`)
   - Username must end in `bot` or `_bot`
   - Must be unique across all of Telegram
   - Naming convention: `tc_agent_NNN_bot` where NNN is a zero-padded sequential number
5. BotFather responds with the bot token: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`
6. **Copy the token immediately** — you cannot retrieve it later (only regenerate)

**Optional but recommended per-bot setup:**

```
/setdescription — Set description for the bot profile
/setabouttext — Set the "About" text
/setuserpic — Upload a profile photo
```

These are overwritten during onboarding (Phase 4 naming ceremony) but provide a professional default.

---

## Step 2 — Format the JSON Import File

Create a JSON file with all tokens. Each entry needs `botToken` and `botUsername`:

**File: `tokens.json`**

```json
[
  {
    "botToken": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
    "botUsername": "tc_agent_001_bot"
  },
  {
    "botToken": "0987654321:ZYXwvuTSRqpoNMLkjiHGFedcba",
    "botUsername": "tc_agent_002_bot"
  }
]
```

**Validation rules:**
- `botToken` must be a non-empty string (format: `<bot_id>:<alphanumeric_hash>`)
- `botUsername` must be a non-empty string ending in `bot` or `_bot`
- Each token must be unique — duplicates will be rejected by the `UNIQUE` constraint on `bot_pool.bot_token`

---

## Step 3 — Load Tokens into the Pool

### Option A: Bulk load via script

```bash
npx tsx ops/botpool/create_bots.ts --file tokens.json
```

The script reads each entry from the JSON file and POSTs it to the admin API.

### Option B: Load one at a time via API

```bash
curl -s -X POST http://localhost:4000/admin/pool/add \
  -H "Content-Type: application/json" \
  -d '{
    "botToken": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
    "botUsername": "tc_agent_001_bot"
  }'
```

Repeat for each token.

### Option C: Bulk load via shell loop

```bash
# Reads tokens.json and POSTs each entry
cat tokens.json | python3 -c "
import json, sys, subprocess
tokens = json.load(sys.stdin)
for t in tokens:
    r = subprocess.run([
        'curl', '-s', '-X', 'POST', 'http://localhost:4000/admin/pool/add',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(t)
    ], capture_output=True, text=True)
    print(f\"{t['botUsername']}: {r.stdout}\")
"
```

---

## Step 4 — Verify Pool Status

```bash
curl -s http://localhost:4000/admin/pool/status | python3 -m json.tool
```

**Expected output (after loading 10 tokens, none assigned yet):**

```json
{
  "total": 10,
  "assigned": 0,
  "unassigned": 10
}
```

**Confirm:** `unassigned` >= 10 before proceeding to P4-4 (first canary deployment).

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `duplicate key value violates unique constraint` | Token already in pool | Skip — token was already loaded |
| `unassigned: 0` after loading | Tokens were immediately assigned to existing tenants | Shouldn't happen unless provisioner ran concurrently — load more tokens |
| Script fails with `ECONNREFUSED` | API server not running | Start the API: `cd api && npm start` |
| BotFather says username taken | Another Telegram user has that username | Try a different username (e.g., increment the number) |

---

## Long-Term: MTProto Automation

The `ops/botpool/create_bots.ts` stub includes a placeholder for MTProto automation via GramJS. This would:

1. Log in to a Telegram user account via MTProto
2. Programmatically message @BotFather
3. Parse the `/newbot` conversation flow
4. Extract tokens and load them into the pool automatically

**Status:** Shelved. Target: Phase 5 or later.

**Requirements for implementation:**
- GramJS dependency (`npm install telegram`)
- A dedicated Telegram user account with phone number (NOT the admin's personal account)
- `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from https://my.telegram.org
- Session persistence for the MTProto connection
- Rate limiting to avoid Telegram's anti-flood (max ~20 bots per session)

**For now:** Manual creation via @BotFather is sufficient for pools up to ~100 tokens. Budget ~2 minutes per token.
