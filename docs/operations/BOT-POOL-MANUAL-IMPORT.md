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

## Automated Creation (MTProto)

`create_bots.ts --mtproto` automates BotFather conversations via GramJS MTProto. It rotates across multiple Telegram accounts with configurable delay and flood-wait handling.

### Prerequisites

1. **Telegram API credentials:** Get `api_id` and `api_hash` from https://my.telegram.org/apps
2. **One or more dedicated Telegram accounts** (NOT personal accounts). Each account needs a phone number that can receive SMS.
3. **Install dependencies:** `cd ops/botpool && npm install`

### Step 1 — Generate session strings

For each Telegram account, run the auth helper once to generate a session string:

```bash
npx tsx ops/botpool/auth_session.ts --api-id 12345 --api-hash abc123def456
```

The script will prompt for the phone number, verification code, and 2FA password (if enabled). On success it prints a session string. Copy it.

### Step 2 — Create sessions.json

Create a `sessions.json` file with all account session strings:

```json
[
  { "accountLabel": "sim-001", "sessionString": "1BVtsOKABu..." },
  { "accountLabel": "sim-002", "sessionString": "1BVtsOKABu..." }
]
```

Each `accountLabel` is a human-readable name for logging. The `sessionString` is the full string from `auth_session.ts`.

### Step 3 — Run automated creation

```bash
npx tsx ops/botpool/create_bots.ts \
  --mtproto \
  --sessions ./sessions.json \
  --count 50 \
  --delay 480 \
  --api-id 12345 \
  --api-hash abc123def456
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--sessions <path>` | (required) | Path to sessions.json |
| `--count <n>` | 10 | Number of bots to create |
| `--delay <seconds>` | 480 (8 min) | Minimum seconds between reuses of the same account |
| `--api-id <id>` | `TELEGRAM_API_ID` env | Telegram API ID |
| `--api-hash <hash>` | `TELEGRAM_API_HASH` env | Telegram API hash |

**How it works:**

1. Picks the account with the longest idle time
2. Waits if the delay hasn't elapsed since its last use
3. Connects via GramJS, sends `/newbot` to @BotFather
4. Sends a random display name (`Tiger Agent a7x3k2`) and username (`tc_b9m2f4q1_bot`)
5. Parses the bot token from BotFather's reply
6. Disconnects (preserves session), POSTs token to `/admin/pool/add`
7. Logs progress: `[3/50] @tc_b9m2f4q1_bot created (sim-001, next: sim-002 in 6m)`

**Error handling:**

- **Username taken:** Retries with a new random name after 30s
- **Flood wait:** Marks the account as blocked until the flood clears, uses the next available account
- **Single account failure:** Logged and skipped — the run continues with other accounts

### Throughput estimates

| Accounts | Delay | Throughput |
|----------|-------|------------|
| 1 | 8 min | ~7.5 bots/hour |
| 2 | 8 min | ~15 bots/hour |
| 3 | 8 min | ~22 bots/hour |
| 5 | 8 min | ~37 bots/hour |

### Step 4 — Verify

```bash
curl -s http://localhost:4000/admin/pool/status | python3 -m json.tool
```

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `SESSION_REVOKED` | Telegram revoked the session | Re-run `auth_session.ts` for that account |
| All accounts flood-blocked | Too many bots created too fast | Wait for flood to clear, or add more accounts |
| `No token in BotFather reply` | BotFather conversation in unexpected state | Script auto-sends `/cancel` and retries |
| `Connection failed` | Network issue or Telegram DC unreachable | Script retries with 60s cooldown |
