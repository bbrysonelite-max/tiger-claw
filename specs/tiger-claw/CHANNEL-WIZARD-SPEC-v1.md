# Tiger Claw — Channel Wizard Spec v1
# Authored: 2026-03-03 (Birdie session), committed 2026-03-07
# Status: APPROVED — implement next after web wizard Stripe gap is closed

---

## Philosophy

UX must be simple enough that an 8-year-old can complete it.
Hand-holding all the way. No assumed technical knowledge.
Inline screenshots, 1-click copy buttons, and an "Ask my agent" escape hatch at every step.

---

## Day 0 Experience — What Every New Customer Gets Automatically

| Channel | Status | Notes |
|---|---|---|
| WhatsApp | ✅ LIVE — no steps required | Pre-provisioned from Telnyx number pool. Auto-assigned at signup. |
| Telegram | Optional — guided wizard | Customer creates bot via BotFather with our step-by-step help |
| LINE | Optional — guided wizard | Customer creates LINE Messaging API channel with our help |

---

## WhatsApp — Heavy Lift Once, Easy Forever

### Tiger Claw Internal Setup (one-time, operator does this)

1. Complete Meta Business verification for Tiger Claw (the platform, not per-customer)
2. Register a WABA (WhatsApp Business Account) under Tiger Claw
3. Set up Telnyx as BSP (Business Service Provider)
4. Pre-provision a pool of WhatsApp numbers via Telnyx API
5. Pre-load approved message templates
6. Build admin UI: operator can assign a number to a new customer in one click

### Customer Experience (zero steps)

- Customer completes signup → WhatsApp number auto-assigned from pool
- Dashboard shows "WhatsApp ✅ Ready" badge immediately
- Messaging, automations, and analytics work from minute one
- Customer never touches Meta, Telnyx, or any configuration

### Engineering Requirements

- `services/whatsapp.ts` — Telnyx API client: number pool management, template management, health monitoring
- `routes/whatsapp.ts` — webhook receiver for inbound WhatsApp messages
- `services/provisioner.ts` — extend `provisionTenant()` to auto-assign WhatsApp number from pool
- Admin UI: number pool status dashboard, manual reassignment
- Health monitoring: 24h message windows, template approval status, error alerts
- Database: `whatsapp_pool` table (number, waba_id, status, tenant_id, assigned_at)

---

## LINE — Optional, Guided Wizard (Thailand market priority)

### Why

Thailand customers expect LINE as the primary channel. It must be available and simple.

### Wizard Flow (tab in channel settings modal)

**Step 1** — "Click this link → LINE Developers" (button auto-opens developers.line.biz)

**Step 2** — Checklist with inline screenshots:
- Create Provider (e.g. "My Tiger Claw Agent")
- Create Messaging API Channel

**Step 3** — Three input boxes:
- Channel ID (with copy-ready example + screenshot)
- Channel Secret (with inline help tooltip)
- Channel Access Token (with "click here to generate" script link)

**Step 4** — We display the callback URL for them to paste back into LINE console (1-click copy)

**Step 5** — "Test Connection" button
- We ping LINE with the credentials
- Show green checkmark on success, specific error message on failure

**"Ask my agent" button** — triggers a pre-written WhatsApp message so their Tiger Claw agent walks them through the flow in real time.

### Engineering Requirements

- Store: `line_channel_id`, `line_channel_secret`, `line_channel_access_token` on tenant record (already in schema)
- Endpoint: `POST /wizard/channels/line/connect` — validate credentials + register webhook
- Endpoint: `POST /wizard/channels/line/test` — send test message to confirm
- Token expiry monitoring + alert when LINE token needs renewal

---

## Telegram — Optional, Guided Wizard

### Wizard Flow (tab in channel settings modal)

**Step 1** — "Open BotFather" button (opens t.me/botfather in new tab)

**Step 2** — Pre-written commands shown with 1-click copy:
```
/newbot
[Your bot name]
[Your bot username]_bot
```

**Step 3** — Token input field (we validate format before submission)

**Step 4** — "Test Connection" button
- We call Telegram getMe with the token
- Show bot username + green checkmark on success

**"Need help?" button** — triggers WhatsApp chat where the agent guides them live.

### Engineering Requirements

- Validate token via `GET https://api.telegram.org/bot{token}/getMe`
- Store token in `bot_pool` table (same as platform-assigned tokens)
- Register Telegram webhook to `https://api.tigerclaw.io/webhooks/telegram/{tenantId}`
- Already implemented in `services/provisioner.ts` — wizard just needs to call it

---

## Dashboard Channel Cards

Every tenant sees a channel dashboard with status cards:

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  WhatsApp           │  │  LINE               │  │  Telegram           │
│  ✅ Active          │  │  [ Connect ]        │  │  ✅ Active          │
│  Last msg: 2h ago   │  │  Thailand market    │  │  @Tiger_Theera_bot  │
│  Templates: 3 active│  │  Guided setup →     │  │  Last msg: 1h ago   │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

Each card shows:
- Connection status (green/yellow/red)
- Last message timestamp
- Error alerts (token expired, webhook down, template rejected)
- Quick action button (Reconnect / Test / Settings)

---

## Implementation Priority

1. WhatsApp Telnyx integration (requires Meta verification first — operator action)
2. Channel dashboard UI with status cards
3. LINE wizard (Thailand customers are paying now)
4. Telegram wizard (simpler, lower priority since platform tokens cover this)

---

## Locked Decisions

- WhatsApp is the DEFAULT channel. Every customer gets it automatically. Not optional.
- LINE is Thailand-first priority for the optional wizard.
- "Ask my agent" help button is required on every wizard step — not optional UX polish.
- Telnyx is the BSP. No other WhatsApp provider.
- Token/credential storage follows the same encryption pattern as bot_pool (AES-256-GCM via encryptToken/decryptToken in pool.ts).
