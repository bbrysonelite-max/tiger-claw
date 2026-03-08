# Tiger Claw — Agent Briefing (v4)

**Read this file first. Every time. No exceptions.**

This is the master briefing for any AI agent (Claude Code, Cursor, or any other) working on Tiger Claw. It tells you what this project is, where everything lives, what phase we are in, and what the rules are.

---

## What Tiger Claw Is

Tiger Claw is a **multi-tenant AI sales and recruiting engine** delivered as a SaaS platform. Tenants sign up through a web wizard, pay via Stripe, and receive a dedicated AI agent — powered by Google Gemini — that handles prospect discovery, outreach, nurture sequences, and follow-up automatically via Telegram. Tenants can bring their own Google API key (BYOK) or use the platform-managed 4-layer key system.

**Target market:** Network marketers, real estate agents, health & wellness professionals, and 8 other business flavors.

**Scale target:** 1,000+ tenants on GKE at launch maturity.

**Architecture:** Stateless multi-tenancy. One API process handles all tenants. Tenant context is resolved per-request via slug/ID. No per-tenant containers.

**Current version:** `v2026.03.04.1` (see `deployment_state.json`)

---

## Repository Structure

```
tiger-claw/
├── CLAUDE.md                        ← YOU ARE HERE
├── deployment_state.json            ← Build/version tracking
├── api/                             ← Tiger Claw API (Express, port 4000)
│   └── src/
│       ├── index.ts                 ← Server entry point, route mounting
│       ├── routes/                  ← 9 route files (see below)
│       ├── services/                ← 6 service files (see below)
│       ├── tools/                   ← 19 Anthropic-native tools (see below)
│       └── config/                  ← Flavor/region config system
├── web-onboarding/                  ← Next.js 5-step wizard (port 3000)
│   └── src/
│       ├── app/                     ← Next.js app router
│       └── components/
│           └── wizard/              ← StepNichePicker, StepIdentity, StepAIConnection,
│                                       StepReviewPayment, PostPaymentSuccess
├── ops/
│   ├── admin-bot/                   ← Telegram admin bot (fleet management)
│   ├── botpool/                     ← BotFather token pool scripts (MTProto + manual import)
│   ├── gcp-terraform/               ← GKE, Cloud SQL, Memorystore (Terraform)
│   └── k8s/                         ← Kubernetes manifests
├── skill/                           ← Legacy OpenClaw skills (not active in v4)
├── docker/                          ← Container definitions (legacy + dev compose)
├── specs/
│   ├── tiger-claw/                  ← TIGERCLAW-MASTER-SPEC-v2.md, BLUEPRINT-v3.md, PRD-v3.md
│   └── openclaw/                    ← OpenClaw platform specs (18 files)
├── tasks/                           ← Phase work orders (PHASE-0 through PHASE-4)
└── docs/
    └── adr/                         ← Architectural Decision Records
```

---

## v4 Architecture

### How It Works

1. Tenant signs up at `app.tigerclaw.io/wizard` — 5-step Next.js wizard
2. Stripe payment processed via webhook
3. `POST /webhooks/stripe` → creates tenant + bot record in PostgreSQL → enqueues provisioning job in BullMQ
4. `provisionWorker` calls K8s provisioner to deploy tenant pod on GKE
5. Tenant's Telegram bot receives messages → Telegram webhook → `POST /webhooks/telegram/:token`
6. Message enqueued in BullMQ `telegram-webhooks` queue
7. `telegramWorker` picks up job → calls `processTelegramMessage()` in `ai.ts`
8. `ai.ts` resolves tenant's Google API key (BYOK or 4-layer platform key) → creates Gemini client → runs function-calling tool execution loop
9. All 19 tools available in the loop. Tool context includes `workdir` (per-tenant data directory), tenant config, and DB access
10. BullMQ `global-cron` heartbeat fires every minute → enqueues `nurture_check` for all active tenants

### Key Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API | Express/TypeScript | Webhook router, admin API, wizard backend |
| AI Orchestrator | `services/ai.ts` + Google Gemini (`gemini-2.5-flash`) | Stateless function-calling tool loop per message |
| Queues | BullMQ + Redis | `tenant-provisioning`, `telegram-webhooks`, `ai-routines`, `global-cron` |
| Database | PostgreSQL (Cloud SQL) | Tenants, bots, ai_configs, bot_pool, admin events |
| Cache / Queue broker | Redis (Memorystore) | Chat history (7-day TTL), BullMQ |
| Infrastructure | GKE + Terraform + GCP | Kubernetes cluster, HA Postgres, HA Redis — Google Cloud |
| Web Wizard | Next.js 16 | 5-step onboarding flow with real Stripe Checkout (GAP 4 — in progress) |
| Customer Dashboard | Next.js 16 | Post-login channel status, LINE wizard, bot management (GAP 9 — in progress) |
| Admin Dashboard | TBD (spec in progress) | Fleet management, bot pool, demo provisioning, alert center |
| Bot Token Pool | `services/pool.ts` + SMS-MAN pipeline | Unassigned Telegram bot tokens. Target: 1,000+ |

### Chat History

Stored in Redis as `chat_history:{tenantId}:{chatId}` with 7-day TTL. System routine jobs use chatId `0`. Cleared on demand via `docker exec <redis-container> sh -c 'redis-cli KEYS "chat_history:*" | while read k; do redis-cli DEL "$k"; done'`.

---

## Routes (`api/src/routes/`)

| File | Key Endpoints |
|------|--------------|
| `admin.ts` | `POST /admin/provision`, `GET /admin/fleet`, fleet suspend/resume/delete/logs, admin alerts |
| `health.ts` | `GET /health`, `GET /healthz`, `GET /readyz` |
| `hive.ts` | `GET /hive/patterns`, `POST /hive/patterns` — cross-tenant pattern learning |
| `keys.ts` | `POST /tenants/:id/keys/activate` — BYOK key activation |
| `subscriptions.ts` | Stripe subscription management |
| `tenants.ts` | `PATCH /tenants/:id/status`, `POST /tenants/:id/scout` |
| `update.ts` | `POST /admin/update/build`, canary, advance, rollback |
| `webhooks.ts` | `POST /webhooks/stripe` — payment + provisioning trigger |
| `wizard.ts` | `GET /wizard/:slug`, `POST /wizard/:slug/save` — channel configuration UI |

---

## Services (`api/src/services/`)

| File | Purpose |
|------|---------|
| `ai.ts` | Core AI orchestrator. Resolves BYOK key, runs Anthropic tool loop, stores chat history in Redis. Loads all 19 tools. |
| `db.ts` | PostgreSQL pool, schema init, tenant/bot/ai_config CRUD, admin event logging |
| `deploymentState.ts` | Build version read/write (`deployment_state.json`) |
| `pool.ts` | Bot token pool: assign, status, replenish, encrypt/decrypt tokens |
| `provisioner.ts` | K8s container lifecycle: create, start, stop, restart, logs |
| `queue.ts` | BullMQ workers: `provisionWorker`, `telegramWorker`, `routineWorker`, `cronWorker`. Global heartbeat scheduler. |

---

## Tools (`api/src/tools/`)

All 19 tools are registered in `ai.ts` `toolsMap`. Each exports a `{ name, description, parameters, execute }` object following the Gemini function-calling schema. The AI engine is **Google Gemini (`gemini-2.5-flash`)** via `@google/generative-ai` SDK — not Anthropic.

| Tool | Purpose |
|------|---------|
| `tiger_aftercare` | Post-sale follow-up sequences |
| `tiger_briefing` | Daily briefings with lead summaries |
| `tiger_contact` | Contact database CRUD |
| `tiger_convert` | Lead-to-customer conversion |
| `tiger_export` | Data export (CSV, JSON) |
| `tiger_hive` | Hive pattern submission and retrieval |
| `tiger_import` | Data import from files |
| `tiger_keys` | **4-layer API key management** — resolution, rotation, layer switching |
| `tiger_lead` | Lead creation and lifecycle |
| `tiger_move` | Lead movement between pipeline stages |
| `tiger_note` | Notes on leads and contacts |
| `tiger_nurture` | Automated nurture sequences |
| `tiger_objection` | Objection handling coach |
| `tiger_onboard` | 5-phase tenant onboarding flow |
| `tiger_score` | Lead scoring (threshold: 80, LOCKED) |
| `tiger_score_1to10` | Quick 1-10 scoring |
| `tiger_scout` | Prospect discovery and research |
| `tiger_search` | Search prospects and leads |
| `tiger_settings` | Tenant config and channel management |

`flavorConfig.ts` is a helper (not a tool) that loads flavor/region JSON configs.

---

## Business Flavors (11)

`network-marketer`, `real-estate`, `health-wellness`, `airbnb-host`, `baker`, `candle-maker`, `doctor`, `gig-economy`, `lawyer`, `plumber`, `sales-tiger`

---

## Infrastructure

### GCP / GKE (Terraform in `ops/gcp-terraform/`)
- **GKE:** Regional cluster, workload identity, deletion protection
- **Node pool:** e2-standard-4, 1-10 auto-scaling (3 initial across zones)
- **Cloud SQL:** PostgreSQL 15, HA (REGIONAL), PITR enabled, private IP
- **Memorystore:** Redis STANDARD_HA, 5GB, cross-zone replication, private VPC

### Kubernetes (`ops/k8s/api-deployment.yaml`)
- Deployment: 2-10 replicas, rolling update
- HPA: CPU 70% / Memory 80%
- Readiness: `/health` (10s initial, 5s period)
- Liveness: `/health` (15s initial, 20s period)

### Local Dev Environment
Docker Compose in `docker/dev/docker-compose.dev.yml`. Running containers:
- `tiger-claw-api` — API image (port 4000), compiled from `api/dist/`
- `tiger-claw-redis` — Redis (port 6379), used by API container internally as `redis:6379`
- `tiger-staging-redis` — Staging Redis (port 6380)
- `tiger-claw-postgres` — PostgreSQL (port 5434)
- `tiger-staging-postgres` — Staging PostgreSQL (port 5433)

**To update the running API container after a code change:**
```bash
cd api && npm run build
cd dist/services
docker cp ai.js <container-id>:/app/dist/services/ai.js
docker restart <container-id>
```

---

## Web Onboarding (`web-onboarding/`)

Next.js 16 / React 19 / Tailwind 4 / Stripe.js / Framer Motion

5-step wizard:
1. **StepNichePicker** — Choose business flavor (11 options)
2. **StepIdentity** — Name, email, preferred language, timezone
3. **StepAIConnection** — Provider selection, BYOK API key input
4. **StepReviewPayment** — Stripe payment (subscription)
5. **PostPaymentSuccess** — Confirmation + Telegram bot link

Playwright E2E tests cover the full wizard flow.

---

## Bot Token Pool

- Stored in PostgreSQL `bot_pool` table (status: `unassigned`, `assigned`, `retired`)
- Managed by `services/pool.ts`
- New tokens added via `ops/botpool/create_bots.ts --tokens-file <file>` (plain text, one token per line)
- MTProto automation available (`--mtproto` flag, requires GramJS session strings in `sessions.json`)
- 11 tokens currently loaded; minimum 10 needed before canary deployment

---

## Locked Decisions (Non-Negotiable)

| # | Decision |
|---|----------|
| 1 | Lead scoring threshold is **80**. Not 70. Not configurable. |
| 2 | Four-layer API key system (tiger_keys). Layer order: Platform Onboarding → Tenant Primary → Tenant Fallback → Platform Emergency. Never skip layers. |
| 3 | Layer 1 (Platform Onboarding): 50 messages total, 72h expiry. Deactivated after onboarding. |
| 4 | Layer 3 (Tenant Fallback): 20 messages/day. |
| 5 | Layer 4 (Platform Emergency): 5 messages total, 24h then auto-pause. |
| 6 | Canary group: 5 tenants, 24h soak minimum before fleet rollout. |
| 7 | All 19 tools must be registered in `ai.ts` toolsMap. Missing tools cause infinite loop. |
| 8 | Chat history lives in Redis (`chat_history:{tenantId}:{chatId}`, 7-day TTL). Never in PostgreSQL. |
| 9 | BYOK key decryption via `decryptToken()` in `services/pool.ts`. Never store plaintext keys. |
| 10 | BullMQ job deduplication: use `jobId` to prevent duplicate routines per tenant. |

---

## Current Phase: PHASE 5 (Build-Out — Gemini Architecture)

Phase 0-4 task docs (`tasks/`) were written for the old OpenClaw per-container architecture.
They are **superseded**. Do not use them as guidance. The active work is defined by the GAPs below.

### Active GAPs (approved 2026-03-07)

| GAP | Description | Status |
|-----|-------------|--------|
| GAP 1 | Config-driven flavor system (JSON files per flavor, zero code changes) | Pending |
| GAP 2 | `POST /admin/demo` — 72-hour trial tenant for demos, no payment | Pending |
| GAP 3 | Bot pool scale to 1,000 tokens (SMS-MAN + MTProto pipeline, admin dashboard UI) | Pending |
| GAP 4 | Wire Stripe into web wizard — real checkout, BYOK key collected + validated | Pending |
| GAP 5 | GCP infrastructure — `terraform apply`, secrets loaded, API deployed to Cloud Run | Pending |
| GAP 6 | Bot token auto-creation pipeline (complete MTProto → BotFather → pool import) | Pending |
| GAP 7 | Server-side BYOK key validation before storage + loud error on failure | Pending |
| GAP 8 | Database migrations system (`migrations/` folder, versioned SQL, auto-applied at startup) | Pending |
| GAP 9 | Customer dashboard UI — channel cards, LINE wizard, bot status (Next.js) | Pending |
| GAP 10 | CLAUDE.md full rewrite for Gemini architecture | ✅ Done (this file) |

---

## What NOT To Do

- Do NOT add tools to `skill/tools/` — that is the legacy OpenClaw path, not active in v4
- Do NOT skip registering a new tool in `ai.ts` `toolsMap` — unregistered tools cause infinite loops
- Do NOT set the scoring threshold to anything other than 80
- Do NOT store tenant prospect/lead data in PostgreSQL — use the per-tenant `workdir` (SQLite or files)
- Do NOT put plaintext API keys in logs, database, or environment output
- Do NOT deploy canary without 10+ bot pool tokens
- Do NOT modify the tool execution loop in `ai.ts` without understanding the full Gemini function-calling cycle
- Do NOT use the Anthropic SDK — the AI engine is Google Gemini (`@google/generative-ai`)
- Do NOT silently swallow errors — all failures must be logged, alerted, and surfaced
- Do NOT use "tiger_credits" anywhere — it is a hallucination, deleted from the codebase

---

## When In Doubt

STOP and ask. Flag with: `DECISION REQUIRED: [description]` and wait for instruction. Do not guess.

---

## IDE Rule — Non-Negotiable

When the operator asks you to work on this project in an IDE or deploy it, you use **Anti-Gravity (Project IDX)** and the Anti-Gravity workspace only. You do not stay in the terminal. You do not use the Desktop path (`/Users/brentbryson/Desktop/tiger-claw`). The Anti-Gravity workspace is the source of truth for all active development. If you are not in IDX, stop and say so.

---

## GitHub Repository

`https://github.com/bbrysonelite-max/tiger-claw`

---

## Session Decisions — 2026-03-07 (LOCKED)

### Customer Journey
- On payment: provisioning email sent with activation link. Customer clicks it → bot activates.
- A web dashboard is required. Telegram alone is not sufficient UX.
- The tiger_onboard 5-phase interview triggers automatically on first bot interaction.

### Key System (4-Layer — Non-Negotiable)
- Layer 1 (Platform): embedded free key, provisioning only, 72h expiry, 50 messages.
- After 72h or 50 messages: bot prompts customer to add their own API key via wizard.
- The wizard must be so good customers want to add their key BEFORE the 72h expires.
- Layer 4 (Emergency): bot is NEVER brain dead. Always has enough compute to guide
  the customer through re-entering a key. Tiger Claw must always be able to speak.
- The 4-layer rotation system is in tiger_keys.ts (1313 lines). It is complete.
  The gap is the wizard never collects and stores the customer's key. Fix the wizard.
- "Tiger Credits" — HALLUCINATION. Never in any spec. Delete from codebase entirely.

### Language
- Tiger Claw speaks all 130 languages via Gemini. This is not partial. This is all.
- Language is set per tenant at provisioning and respected throughout.

### Tiger Hive — Self-Improving Agents
- Agents have memory. They get better every single interaction.
- Hive = agents share what works anonymously across the fleet.
- Every agent self-improves from its own history AND from fleet-wide patterns.
- This is not just pattern sharing. This is continuous autonomous improvement.

### Flavors
- 11 flavors exist. Config-driven. New flavor = new JSON file, zero code changes.

### Sales / Provisioning
- Everything auto-provisions. There is no manual provisioning.
- Stripe is primary self-serve channel (website wizard → Stripe Checkout → provision).
- Stan Store integrates with Stripe — same webhook, same auto-provisioning path.
- Every signup triggers provisioning AND customer care email sequence automatically.
- ONE exception: POST /admin/demo — creates a 72-hour trial tenant for demos. No payment.
  Assigns a bot from pool, activates Layer 1 key, auto-suspends when Layer 1 expires.
- "Tiger Credits" connection type is deleted. Only: byok | managed.

### Key Abuse Protection (Non-Negotiable)
- The platform tracks how many times a tenant has consumed emergency (Layer 4) compute.
- First incident: warning email — "Your bot ran out of compute. Here's how to add your key."
- Second incident: stronger warning email — platform compute is not a free service.
- Third incident: bot auto-paused. Tenant must add their own key to reactivate.
- Operator receives an alert on every Layer 4 consumption event.
- This protects the operator from tenants who repeatedly drain platform keys at operator cost.

### Error Handling (Non-Negotiable Principle)
- NO silent failures. Ever.
- Dead agents must alert the operator (admin bot / dashboard) AND notify the customer.
- Key failures are loud: customer sees a clear message, operator gets an alert.
- Webhook failures are logged, alerted, and retried with exponential backoff.
- Tool failures are logged with full context. No swallowed errors.
- BYOK keys are validated before storage. A bad key never reaches the bot.
- The admin dashboard surfaces all failure states in real time.
- "If something is going to break, it breaks loud." — Operator directive, 2026-03-07.

### Channels
- Telegram is the DEFAULT. Auto-provisioned from bot_pool. Zero steps for customer.
- LINE wizard: guided setup, Thailand priority.
- Telegram BYO bot: optional wizard to swap platform bot for custom-named bot.
- WhatsApp: future, via Baileys.
- UX standard: simple enough for an 8-year-old. Hand-holding. Always.

### IDE Rule
- All development in Anti-Gravity (Project IDX). No Desktop path. Ever.
