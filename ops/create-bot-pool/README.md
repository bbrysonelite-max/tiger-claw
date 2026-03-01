# Tiger Claw — create-bot-pool

Automated Telegram bot creation using MTProto (gramjs). Logs into a Telegram user
account, creates bots via @BotFather, and imports each token into the Tiger Claw pool.

## Setup

```bash
cd ops/create-bot-pool
npm install
```

Get API credentials at https://my.telegram.org → "API Development Tools":
- App `api_id` → `TELEGRAM_API_ID`
- App `api_hash` → `TELEGRAM_API_HASH`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_API_ID` | ✅ | From https://my.telegram.org |
| `TELEGRAM_API_HASH` | ✅ | From https://my.telegram.org |
| `TELEGRAM_PHONE` | ✅ | Phone number(s), comma-separated for multi-account |
| `ADMIN_TOKEN` | ✅ | Tiger Claw API bearer token |
| `TIGER_CLAW_API_URL` | | API base URL (default: `http://localhost:4000`) |
| `BOT_NAME_PREFIX` | | Display name prefix (default: `Tiger Claw Agent`) |
| `BOT_USERNAME_PREFIX` | | Username prefix (default: `TC_Agent`) |
| `SESSIONS_DIR` | | Session file directory (default: `./sessions`) |

## Usage

```bash
# Create 10 bots (default), auto-detect starting N from pool
TELEGRAM_API_ID=123456 \
TELEGRAM_API_HASH=abcdef... \
TELEGRAM_PHONE=+1555000000 \
ADMIN_TOKEN=your-token \
npx ts-node index.ts

# Create 25 bots starting at N=50
npx ts-node index.ts --count 25 --start 50

# Dry run — verify BotFather conversation flow without creating real bots
npx ts-node index.ts --dry-run --count 3

# Multi-account: three phones, ~1 bot per 2.5 minutes
TELEGRAM_PHONE="+1555000001,+1555000002,+1555000003" \
npx ts-node index.ts --count 30
```

## Multi-account Rotation

Pass comma-separated phone numbers. The script maintains a separate session per account
and always picks the account whose cooldown expires next:

```
Account 1: creates → 7-min cooldown
Account 2: creates → 7-min cooldown  
Account 3: creates → 7-min cooldown
Account 1: available → creates again
...
```

Three accounts → one bot every ~2.5 minutes average.

## Session Files

On first run, the script prompts for a verification code for each phone number.
Sessions are saved to `sessions/{phone}.session` and reused on subsequent runs.

**Session files contain auth credentials — do not commit them.**
They are git-ignored by default.

## Rate Limiting

BotFather enforces a 7-minute cooldown per account after each bot creation.
If rate limited, the script backs off the affected account for 15 minutes and
continues with other accounts. All accounts rate limited → script waits for
the earliest available account.

## Bot Naming

Created bots follow this pattern (configurable via env vars):
- Display name: `Tiger Claw Agent {N}`  
- Username: `@TC_Agent_{N}_bot`

N auto-increments starting from the highest N already in the pool (or `--start`).

## Graceful Shutdown

Press Ctrl+C at any time. The script logs progress, disconnects all accounts cleanly,
and exits. Partially created bots already imported to the pool are retained.
