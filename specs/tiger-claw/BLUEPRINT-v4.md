# Tiger Claw — System Blueprint v4
# Date: 2026-03-07
# Status: APPROVED — CURRENT ARCHITECTURE

---

## What Tiger Claw Is

Tiger Claw is a **multi-tenant AI sales and recruiting SaaS platform**.

A customer signs up, pays, and receives a dedicated AI agent that runs 24/7 —
discovering prospects, scoring them, sending personalized outreach, managing
objections, nurturing leads, and delivering a daily briefing via Telegram.

The customer does not send messages. The agent does. The customer watches
the pipeline fill.

**Scale target:** 1,000+ tenants.
**AI engine:** Google Gemini (`gemini-2.5-flash`).
**Primary channel:** Telegram (auto-provisioned at signup, zero setup).
**Secondary channel:** LINE (guided wizard, Thailand priority).

---

## Architecture Overview

```
Customer pays (Stripe)
        │
        ▼
POST /webhooks/stripe
        │
        ├─── Create user + bot + ai_config in PostgreSQL
        ├─── Assign bot token from bot_pool
        ├─── Send provisioning email with activation link
        └─── Enqueue provisioning job → BullMQ
                        │
                        ▼
                provisionWorker
                        │
                        ├─── Register Telegram webhook
                        └─── Tenant is LIVE

Customer messages Telegram bot
        │
        ▼
POST /webhooks/telegram/:tenantId
        │
        └─── Enqueue → BullMQ telegram-webhooks queue
                        │
                        ▼
                telegramWorker
                        │
                        └─── processTelegramMessage() in ai.ts
                                        │
                                        ├─── Resolve tenant context from DB
                                        ├─── Resolve API key (4-layer system)
                                        ├─── Load chat history from Redis
                                        ├─── Call Gemini with all 19 tools
                                        ├─── Execute tool calls in loop
                                        ├─── Store updated history in Redis
                                        └─── Send response via Telegram

BullMQ global-cron (every minute)
        │
        └─── Enqueue nurture_check for all active tenants
                        │
                        ▼
                routineWorker
                        │
                        └─── tiger_nurture, tiger_briefing, tiger_scout
```

---

## The 4-Layer Key System

Every tenant's API calls are paid by one of four key layers, resolved in order:

```
Layer 1: Platform Onboarding Key
  - Embedded in the platform, operator pays
  - 72-hour expiry, 50 message limit
  - Purpose: onboarding only — get the customer to add their own key
  - Deactivated permanently after onboarding period

Layer 2: Tenant Primary Key (BYOK)
  - Customer's own Google API key
  - Collected in wizard Step 3, validated server-side, AES-256-GCM encrypted
  - No limit — customer pays Google directly
  - This is the normal operating state

Layer 3: Tenant Fallback Key
  - Second key the customer can optionally register
  - 20 messages/day limit
  - Activates automatically if Layer 2 fails

Layer 4: Platform Emergency Key
  - Operator pays — emergency compute only
  - 5 messages total, 24-hour window then auto-pause
  - PURPOSE: bot is NEVER brain dead — always has enough to say
    "Your key expired. Here's how to fix it." and guide reactivation
  - Key abuse tracking: 1st use = warning email, 2nd = stronger warning,
    3rd = bot auto-paused until customer adds key
```

**Resolution order:** Layer 1 (if in onboarding) → Layer 2 → Layer 3 → Layer 4.
Never skip. Never reverse.

---

## Tiger Hive — Collective Intelligence

Every Tiger Claw agent has memory. Every interaction improves it.

```
Agent receives reply → tiger_hive tool logs what worked
        │
        └─── POST /hive/patterns (anonymous, no PII)
                        │
                        ▼
                Hive PostgreSQL table
                        │
                        └─── All agents query patterns at runtime
                                        │
                                        └─── "Other agents in your flavor
                                              found this approach converts 3x
                                              better" → agent adapts
```

**Fleet-wide:** Scripts that convert for any network marketer in Thailand get
surfaced to all network marketers in Thailand. Anonymously.

**Per-tenant:** Each agent's history improves its own future responses via
Redis chat history (7-day TTL).

---

## The 19 Tools

All 19 tools are registered in `ai.ts` toolsMap. Gemini calls them as functions.
Missing a tool registration causes an infinite loop — the model keeps requesting
a tool that never responds.

| Tool | Role |
|------|------|
| `tiger_scout` | Prospect discovery — scans sources for buying signals |
| `tiger_score` | Scores prospects 0-100, threshold 80 (LOCKED) |
| `tiger_score_1to10` | Quick 1-10 scoring for rapid triage |
| `tiger_lead` | Creates and manages lead records |
| `tiger_move` | Moves leads through pipeline stages |
| `tiger_contact` | Contact database CRUD |
| `tiger_note` | Notes on leads and contacts |
| `tiger_search` | Searches the prospect/lead database |
| `tiger_nurture` | Automated nurture sequences |
| `tiger_aftercare` | Post-sale follow-up sequences |
| `tiger_objection` | Objection handling coach |
| `tiger_convert` | Lead-to-customer conversion tracking |
| `tiger_briefing` | Daily briefing generation (7 AM delivery) |
| `tiger_onboard` | 5-phase tenant onboarding interview |
| `tiger_settings` | Tenant config and channel management |
| `tiger_keys` | 4-layer key resolution, rotation, switching |
| `tiger_hive` | Hive pattern submission and retrieval |
| `tiger_import` | Data import from files |
| `tiger_export` | Data export (CSV, JSON) |

---

## Skills System

On top of the 19 built-in tools, agents can discover and install skills from
the OpenClaw ecosystem marketplace.

```
skills/tiger-capabilities/
  ├── scripts/scanner.py    — discovers skills, scores vs active flavor
  ├── scripts/vetter.py     — security gate (12 checks before install)
  ├── scripts/xfeed.py      — trend intelligence by flavor
  ├── scripts/rss_gen.py    — operator RSS feed
  ├── scripts/capabilities.sh — CLI: list, search, scan, vet, install, trending
  └── flavors/              — per-industry keyword/compliance profiles
```

New skills extend what the agent can do without modifying core code.

---

## Business Flavors (11)

Each flavor is a JSON file in `api/src/config/flavors/`. Adding a new flavor
requires only a new JSON file — zero code changes.

Each flavor defines: persona, opening message, score keywords, objection scripts,
nurture cadence, compliance rules, preferred channels.

| Flavor | Market |
|--------|--------|
| `network-marketer` | MLM / direct sales |
| `real-estate` | Property agents |
| `health-wellness` | Health coaches, supplements |
| `airbnb-host` | Short-term rental operators |
| `baker` | Specialty food businesses |
| `candle-maker` | Artisan/craft businesses |
| `doctor` | Medical professionals |
| `gig-economy` | Freelancers, contractors |
| `lawyer` | Legal professionals |
| `plumber` | Trades and home services |
| `sales-tiger` | General B2B/B2C sales |

---

## Data Architecture

| Data type | Storage | TTL |
|-----------|---------|-----|
| Tenant/bot/config records | PostgreSQL (Cloud SQL) | Permanent |
| Chat history | Redis (Memorystore) | 7 days |
| BullMQ job queues | Redis (Memorystore) | Auto-managed |
| Prospect/lead data | Per-tenant SQLite in `workdir` | Permanent |
| Bot tokens | PostgreSQL `bot_pool` (AES-256-GCM encrypted) | Until retired |
| API keys | PostgreSQL `ai_configs` (AES-256-GCM encrypted) | Until rotated |
| Hive patterns | PostgreSQL `hive_patterns` | Permanent |

**Never store prospect/lead data in the main PostgreSQL.**
It goes in the per-tenant `workdir` only.

---

## Infrastructure

```
Google Cloud Platform (GCP) — project: hybrid-matrix-472500-k5

GKE (Kubernetes Engine)
  └── API deployment: 2-10 replicas, rolling update, HPA at 70% CPU / 80% memory

Cloud SQL (PostgreSQL 15)
  └── HA REGIONAL, PITR enabled, private VPC, automated backups

Memorystore (Redis)
  └── STANDARD_HA, 5GB, cross-zone replication, private VPC

Cloud Run (API deployment path)
  └── Stateless, 1-10 instances, 2GB RAM, private env via Secret Manager

GCP Secret Manager
  └── All secrets: DATABASE_URL, REDIS_URL, GOOGLE_API_KEY, STRIPE keys,
      ADMIN_TOKEN, ENCRYPTION_KEY, SERPER keys, etc.
```

---

## Channels

### Telegram (Default — Zero Setup)
1. Provisioning fires → `assignBotFromPool()` → bot token assigned
2. Webhook registered: `https://api.tigerclaw.io/webhooks/telegram/{tenantId}`
3. Bot is live immediately
4. Customer gets bot username + deep link in provisioning email

### LINE (Optional — Thailand Priority — HIGH)
Guided 5-step wizard in the customer dashboard:
1. Open LINE Developers
2. Create Provider + Messaging API Channel
3. Enter Channel ID, Secret, Access Token
4. Paste callback URL into LINE console
5. Test Connection → green checkmark

"Ask my agent" button on every step — Telegram bot walks them through live.

Credentials stored encrypted: `line_channel_secret`, `line_channel_access_token`.

### WhatsApp (Future)
Via Baileys. Not in current build scope.

---

## Bot Token Pool

Target: 1,000+ unassigned tokens.

**Creation pipeline:**
```
SMS-MAN API
  └── Buy 50 phone numbers ($6-60 depending on country)
          │
          └─── Receive Telegram verification codes
                          │
                          └─── GramJS MTProto: register 50 Telegram accounts
                                          │
                                          └─── BotFather: 20 bots per account
                                                          │
                                                          └─── 1,000 tokens
                                                                   │
                                                                   └─── Import to bot_pool
```

Pool health: Alert operator when unassigned count drops below 50.

---

## Error Handling (Non-Negotiable)

- No silent failures. Ever.
- All tool errors: logged with full context, surfaced to operator dashboard.
- Dead agent: operator alerted via admin Telegram bot + dashboard red indicator.
- Customer notified with clear message + recovery instructions.
- Webhook failures: exponential backoff retry (3 attempts), then alert.
- Key failures: loud error to customer + operator alert.
- BYOK key validated before storage — bad key never reaches the bot.

---

## Site Map

| URL | Purpose |
|-----|---------|
| `thegoods.ai` | Public marketing site (needs copy update) |
| `botcraftwrks.ai` | Operator admin dashboard (live, data wiring pending) |
| `app.tigerclaw.io` | Customer dashboard (to be built — GAP 9) |
| `api.tigerclaw.io` | Tiger Claw API (Cloud Run) |

---

## What Is NOT Tiger Claw

- ~~Anthropic SDK~~ — Gemini only
- ~~OpenAI~~ — Gemini only
- ~~Tiger Credits~~ — hallucination, deleted, never add back
- ~~Per-tenant containers~~ — stateless multi-tenancy, one API process
- ~~Manual provisioning~~ — everything auto-provisions via Stripe
- ~~User sends messages~~ — the agent sends autonomously
- ~~Silent failures~~ — all errors are loud
