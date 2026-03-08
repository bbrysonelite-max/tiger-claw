# Tiger Claw — Channel Wizard Spec v1
# Status: APPROVED
# Aligns with: TIGERCLAW-MASTER-SPEC-v2.md, PHASE-3.md

---

## Philosophy

UX must be simple enough that an 8-year-old can complete it.
Hand-holding all the way. No assumed technical knowledge.
Inline screenshots, 1-click copy buttons, and an "Ask my agent"
escape hatch at every step.

---

## Day 0 Experience — What Every New Customer Gets Automatically

| Channel | Status | Notes |
|---|---|---|
| Telegram | ✅ LIVE — no steps required | Pre-assigned from bot_pool at provisioning. Webhook registered automatically. |
| LINE | Optional — guided wizard | Thailand-market priority. Guided setup with screenshots and test connection. |
| WhatsApp | Optional — guided wizard | Via Baileys. Future priority. |

---

## Telegram — Default Channel (Zero Steps)

Every tenant receives a Telegram bot automatically when provisioned.
The bot is assigned from the platform `bot_pool`, the webhook is registered
to `https://api.tigerclaw.io/webhooks/telegram/{tenantId}`, and the agent
is live immediately.

The customer sees their bot username (e.g. `@Tiger_Theera_bot`) on the
dashboard with a "Start chatting" deep link. Nothing to configure.

---

## LINE — Optional, Guided Wizard (Thailand Market Priority)

### Why
Thailand customers expect LINE as their primary channel.

### Wizard Flow

**Step 1** — Button: "Open LINE Developers" (auto-opens developers.line.biz in new tab)

**Step 2** — Checklist with inline screenshots:
- Create a Provider (e.g. "My Tiger Claw Agent")
- Create a Messaging API Channel under that Provider

**Step 3** — Three input fields, each with 1-click copy example and screenshot:
- Channel ID
- Channel Secret
- Channel Access Token (with "How to generate" link)

**Step 4** — We display the callback URL they must paste back into the LINE console.
1-click copy button. Screenshot showing exactly where to paste it.

**Step 5** — "Test Connection" button
- Backend verifies credentials with LINE API
- Green checkmark on success
- Specific error message on failure (wrong token, wrong webhook URL, etc.)

**"Ask my agent" button** on every step — sends a pre-written message to their
Telegram bot so Tiger Claw walks them through the step in real time.

### Engineering Requirements

- Credentials stored on tenant: `line_channel_secret`, `line_channel_access_token`
  (schema already exists in `db.ts`)
- `POST /wizard/channels/line/connect` — validate credentials + register webhook
- `POST /wizard/channels/line/test` — send test message to confirm live
- Token expiry monitoring + dashboard alert when LINE token needs renewal

---

## Telegram — "Bring Your Own Bot" Wizard (Optional Add-On)

For customers who want a custom-named Telegram bot instead of the platform-assigned one.

### Wizard Flow

**Step 1** — Button: "Open BotFather" (opens t.me/botfather in new tab)

**Step 2** — Pre-written commands shown with 1-click copy:
```
/newbot
```
Prompts for bot name and username. Screenshots for each step.

**Step 3** — Token input field. Format validated before submission.

**Step 4** — "Test Connection" button
- Backend calls `getMe` with the token
- Shows bot username + green checkmark on success

**Step 5** — Old platform bot released back to the pool. New custom bot registered.

**"Ask my agent" button** on every step.

### Engineering Requirements

- Validate token via `GET https://api.telegram.org/bot{token}/getMe`
- Store in `bot_pool` (same pattern as platform tokens)
- Register webhook via `services/provisioner.ts` (already implemented)

---

## Dashboard Channel Cards

Every tenant sees a channel status dashboard:

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Telegram           │  │  LINE               │  │  WhatsApp           │
│  ✅ Active          │  │  [ Connect ]        │  │  [ Coming Soon ]    │
│  @Tiger_Theera_bot  │  │  Thailand market    │  │                     │
│  Last msg: 1h ago   │  │  Guided setup →     │  │                     │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

Each active card shows:
- Connection status (green / yellow / red)
- Bot username or channel name
- Last message timestamp
- Error alert if webhook is down or token has expired
- Quick actions: Test / Reconnect / Settings

---

## Implementation Priority

1. Dashboard channel cards UI (Telegram status for all current customers)
2. LINE wizard — HIGH PRIORITY (Thailand market is active; customers will land on Telegram and immediately want LINE)
3. Telegram "bring your own bot" wizard (lower priority — platform tokens work)
4. WhatsApp via Baileys (future)

---

## Locked Decisions

- Telegram is the DEFAULT channel. Every customer gets it automatically at provisioning.
- LINE is the priority optional wizard for the Thailand market.
- "Ask my agent" help button is required on every wizard step — not optional UX polish.
- All credential storage uses AES-256-GCM via `encryptToken`/`decryptToken` in `pool.ts`.
- Webhook registration for all channels goes through `services/provisioner.ts`.
