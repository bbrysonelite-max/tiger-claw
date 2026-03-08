# Tiger Claw — Anti-Gravity (Project IDX) Master Prompt v2
# Date: 2026-03-07
# Status: APPROVED — USE THIS PROMPT EVERY SESSION

---

## STRICT RULES — READ BEFORE TOUCHING ANY FILE

1. **Read CLAUDE.md first. Every session. No exceptions.**
   Path: `/home/user/tiger-claw/CLAUDE.md`
   If you have not read it, stop and read it now.

2. **Read the spec documents before writing any code.**
   Path: `/home/user/tiger-claw/specs/tiger-claw/`
   These are the source of truth. Not your training data. Not assumptions.

3. **Do not guess. Do not hallucinate features.**
   If something is not in the specs, ask. Flag with: `DECISION REQUIRED: [description]`

4. **Do not work outside Anti-Gravity.**
   The repo is at `/home/user/tiger-claw/`. All work happens here.
   Do not reference `/Users/brentbryson/Desktop/` — that path is dead.

5. **Commit to GitHub after every completed GAP.**
   Remote: `https://github.com/bbrysonelite-max/tiger-claw`
   Commit message must describe what was done and why.

6. **One GAP at a time. Do not start GAP N+1 until GAP N is complete and committed.**

7. **Never delete a locked decision.**
   Locked decisions are in `CLAUDE.md` under "Locked Decisions" and "Session Decisions."
   If something seems wrong, flag it. Do not silently override it.

8. **Never store plaintext API keys. Never log keys. Never put keys in responses.**

9. **All 19 tools must remain registered in `ai.ts` toolsMap.**
   Touching the tool loop without understanding the full Gemini function-calling cycle
   will break every tenant. Do not modify `ai.ts` without reading it completely first.

10. **No silent failures. All errors must be logged, alerted, and surfaced.**
    See Error Handling principle in CLAUDE.md.

---

## WHAT THIS PROJECT IS

Tiger Claw is a **multi-tenant AI sales and recruiting SaaS platform**.

- **AI engine:** Google Gemini (`gemini-2.5-flash`) via `@google/generative-ai`
- **NOT Anthropic. NOT OpenAI. NOT GPT.** Gemini only.
- **Architecture:** Stateless multi-tenancy. One API, all tenants.
- **Default channel:** Telegram (auto-provisioned from bot_pool)
- **Optional channel:** LINE (wizard for Thailand market, HIGH PRIORITY)
- **Languages:** 130 via Gemini
- **Flavors:** 11 industries, config-driven (JSON files)
- **Scoring:** 80 threshold. Locked. Not 70. Not configurable.
- **Key system:** 4-layer (Platform Onboarding → Tenant Primary → Tenant Fallback → Platform Emergency)
- **Bot never brain dead.** Layer 4 always has compute to guide re-activation.
- **Tiger Hive:** Agents share what works anonymously. Fleet-wide continuous improvement.
- **Skills:** `skills/tiger-capabilities/` — agents discover and install capabilities.

---

## WHAT HAS BEEN BUILT (DO NOT REBUILD)

| Component | Status | Location |
|-----------|--------|---------|
| API server | ✅ Built | `api/src/index.ts` |
| All 19 tools | ✅ Built | `api/src/tools/` |
| AI orchestrator (Gemini) | ✅ Built, confirmed working | `api/src/services/ai.ts` |
| BullMQ workers | ✅ Built | `api/src/services/queue.ts` |
| DB service | ✅ Built | `api/src/services/db.ts` |
| Bot pool | ✅ Built | `api/src/services/pool.ts` |
| Provisioner | ✅ Built | `api/src/services/provisioner.ts` |
| Stripe webhook | ✅ Built | `api/src/routes/webhooks.ts` |
| 4-layer key system | ✅ Built (1313 lines) | `api/src/tools/tiger_keys.ts` |
| Web wizard (5 steps) | ✅ Stripe wired, BYOK validated | `web-onboarding/src/` |
| 52 shadcn/ui components | ✅ Ready to use | `web-onboarding/src/components/ui/` |
| Dashboard types | ✅ Ready to use | `web-onboarding/src/types/dashboard.ts` |
| Dashboard PRD | ✅ Spec ready | `specs/tiger-claw/DASHBOARD-PRD.md` |
| Skills system | ✅ Built | `skills/tiger-capabilities/` |
| GCP Terraform | ✅ Written | `ops/gcp-terraform/` |
| Cloud Run scripts | ✅ Written | `ops/deploy-cloudrun.sh`, `ops/setup-secrets.sh` |
| Bot pool pipeline | ✅ Planned | `ops/botpool/Smsman_number_buyer.py`, `ops/botpool/create_bots.ts` |

---

## ACTIVE WORK — GAPS TO CLOSE (IN ORDER)

Work through these one at a time. Do not skip. Do not reorder.

### ✅ GAP 8 — Database Migrations — COMPLETE
**What:** Replace `CREATE TABLE IF NOT EXISTS` in `db.ts` with a proper versioned
migration system. Every schema change needs a numbered SQL file.

**Files to create:**
- `api/migrations/001_initial.sql` — current schema extracted from `db.ts`
- `api/migrations/002_add_line_credentials.sql` — `line_channel_secret`, `line_channel_access_token`
- `api/src/services/migrate.ts` — migration runner, checks applied migrations, runs new ones at startup

**Rules:**
- Migration runner runs at API startup before any routes are available
- Never modify a migration file that has already been applied
- New schema change = new migration file, always
- The `migrations` table tracks which files have been applied

**Done when:** API starts up, runs pending migrations automatically, logs which were applied.

---

### ✅ GAP 1 — Config-Driven Flavor System — COMPLETE
**What:** 11 flavor JSON files in `api/src/config/flavors/`. Adding a new flavor
requires dropping a JSON file — zero code changes.

**Files to create:**
- `api/src/config/flavors/network-marketer.json`
- `api/src/config/flavors/real-estate.json`
- `api/src/config/flavors/health-wellness.json`
- `api/src/config/flavors/airbnb-host.json`
- `api/src/config/flavors/baker.json`
- `api/src/config/flavors/candle-maker.json`
- `api/src/config/flavors/doctor.json`
- `api/src/config/flavors/gig-economy.json`
- `api/src/config/flavors/lawyer.json`
- `api/src/config/flavors/plumber.json`
- `api/src/config/flavors/sales-tiger.json`

**Each JSON file contains:**
```json
{
  "id": "network-marketer",
  "label": "Network Marketer",
  "persona": "...",
  "openingMessage": "...",
  "scoreKeywords": ["..."],
  "objectionScripts": { "time": "...", "money": "...", "trust": "..." },
  "nurtureSequence": ["day1", "day3", "day7"],
  "complianceRules": ["no income claims", "include opt-out"],
  "channels": ["telegram", "line"],
  "language": "en"
}
```

**Update `flavorConfig.ts`** to read from these files dynamically at startup.
Validate at boot that all flavors have a config file — fail loud if missing.

**Done when:** `flavorConfig.ts` reads JSON files, all 11 flavors load, adding a 12th
requires only a new JSON file.

---

### ✅ GAP 7 — Server-Side BYOK Key Validation — COMPLETE
**What:** Before storing a customer's API key, validate it actually works.

**Endpoint to add:** `POST /wizard/validate-key`
- Accepts: `{ provider: "google", key: "AIza..." }`
- Makes a minimal test call to Gemini API
- Returns: `{ valid: true }` or `{ valid: false, error: "Key rejected by Google — check you copied it correctly" }`
- On success: encrypts key with `encryptToken()`, stores in DB, never logs the raw key
- Never logs the raw key at any point

**Rules:**
- Raw key never appears in logs
- Raw key never stored in plaintext
- Response never echoes the key back
- Specific error messages — not generic "invalid key"

**Done when:** Wizard step 3 calls this endpoint, bad key is caught before it reaches the bot.

---

### ✅ GAP 4 — Wire Stripe Into Web Wizard — COMPLETE
**What:** The 5-step wizard currently has a 2-second setTimeout simulating payment.
Real Stripe Checkout must be wired in.

**Changes required:**

Step 3 (StepAIConnection):
- Customer enters their Google API key
- On "Next": call `POST /wizard/validate-key` (GAP 7)
- If valid: key is stored server-side, wizard proceeds
- If invalid: show specific error, customer cannot proceed

Step 4 (StepReviewPayment):
- Remove the setTimeout mock
- Call `POST /checkout` on the API with plan details
- Redirect to Stripe Checkout URL returned
- Stripe processes payment

Step 5 (PostPaymentSuccess):
- Stripe redirects back with `?session_id=`
- Display bot username and Telegram deep link
- Customer is live

**Rules:**
- Raw API key is NEVER sent through Stripe metadata
- Key is stored server-side in Step 3 before checkout begins
- Pass only a bot DB ID in Stripe metadata to link the key after payment

**Done when:** Full flow — enter key → validate → Stripe payment → bot provisioned → customer
gets their Telegram deep link.

---

### ✅ GAP 2 — Demo Trial Endpoint — COMPLETE
**What:** `POST /admin/demo` — spins up a 72-hour trial tenant for demos. No payment.

**Request body:**
```json
{
  "name": "Prospect Name",
  "email": "prospect@email.com",
  "flavor": "network-marketer",
  "language": "en"
}
```

**Behavior:**
- Requires `Authorization: Bearer $ADMIN_TOKEN` header
- Creates user + bot + ai_config in DB
- Assigns bot token from pool
- Activates Layer 1 key (Platform Onboarding — 72h/50 messages)
- Enqueues provisioning job
- Returns: `{ botUsername: "@Tiger_Demo_bot", telegramLink: "https://t.me/Tiger_Demo_bot" }`
- Bot auto-suspends when Layer 1 key expires

**Done when:** Operator can spin up a live demo bot with one API call.

---

### ✅ GAP 5 — GCP Infrastructure Deploy — COMPLETE
**What:** Terraform applied, secrets loaded into GCP Secret Manager, API deployed to Cloud Run.

---

### ✅ GAP 6 — Bot Token Pipeline — COMPLETE
**What:** SMS-MAN → Telegram accounts → BotFather → pool import pipeline complete. Target: 1,000 tokens in `bot_pool`.

---

### GAP 9 — Customer Dashboard ← START HERE
**What:** The customer web dashboard at `app.tigerclaw.io`. Post-login. Shows the
customer their bot status, channel cards, LINE wizard, and pipeline.

**Use the existing assets:**
- Components: `web-onboarding/src/components/ui/` (52 shadcn/ui components, ready)
- Types: `web-onboarding/src/types/dashboard.ts`
- PRD: `specs/tiger-claw/DASHBOARD-PRD.md`
- Visual reference: `specs/tiger-claw/dashboard-reference.html`

**Minimum viable screens:**
1. **Bot Status** — Telegram bot username, deep link, last message timestamp, status indicator
2. **Channel Cards** — Telegram (active), LINE (connect wizard), WhatsApp (coming soon)
3. **LINE Wizard** — 5-step guided setup with screenshots, 1-click copy, "Ask my agent" button
4. **API Key Status** — which layer is active, how many messages remaining, add/update key

**Auth:** JWT issued at login, stored in httpOnly cookie. Verify on every API call.

**Done when:** Customer can log in, see their bot, and connect LINE.

---

### GAP 3 — Admin Dashboard Wired to Live Data
**What:** `botcraftwrks.ai/dashboard.html` is a working prototype with mocked data.
Wire every section to the Tiger Claw API.

**The design is done. Wire it up, do not redesign it.**

**API endpoints needed:**
- `GET /admin/fleet` — all tenants with health indicators
- `GET /admin/costs` — API cost per tenant (from key abuse tracking)
- `GET /hive/patterns` — hive leaderboard and trending scripts
- `GET /admin/pool/status` — bot pool count, health
- `POST /admin/demo` — (GAP 2) provision trial tenant from dashboard

**Done when:** Every number in the admin dashboard reflects real data from the API.

---

## LOCKED DECISIONS — NEVER OVERRIDE

| # | Decision |
|---|----------|
| 1 | Lead scoring threshold: **80**. Not 70. Not configurable. |
| 2 | 4-layer key system. Layer order: Platform Onboarding → Tenant Primary → Fallback → Emergency. |
| 3 | Layer 1: 50 messages, 72h expiry. |
| 4 | Layer 3: 20 messages/day. |
| 5 | Layer 4: 5 messages total, 24h then auto-pause. |
| 6 | Key abuse: warn at 1st incident, stronger warning at 2nd, auto-pause at 3rd. |
| 7 | All 19 tools registered in `ai.ts` toolsMap. Missing tools = infinite loop. |
| 8 | Chat history in Redis only. Never PostgreSQL. |
| 9 | BYOK key encrypted via `encryptToken()`. Never plaintext. |
| 10 | No silent failures. All errors loud. |
| 11 | AI engine: Google Gemini only. No Anthropic, no OpenAI. |
| 12 | Tiger Credits: HALLUCINATION. Deleted. Never add it back. |
| 13 | Connection types: `byok` or `managed` only. |
| 14 | Telegram = DEFAULT channel. Auto-provisioned. Zero steps for customer. |
| 15 | LINE wizard = HIGH PRIORITY for Thailand market. |
| 16 | Everything auto-provisions. No manual provisioning except `POST /admin/demo`. |
| 17 | Bot pool target: 1,000+ tokens minimum before launch. |
| 18 | All development in Anti-Gravity (Project IDX). No Desktop path. |

---

## WHEN IN DOUBT

Stop. Do not guess. Do not proceed.

Flag with: `DECISION REQUIRED: [description]`

Wait for operator instruction.

The operator has lost $5,000+ to AI agents that went off-rails.
Do not be the next one.
