# TIGER CLAW — MASTER SPECIFICATION v2.0

**Date:** February 27, 2026  
**Architect:** Brent "Pebo" Bryson  
**Co-Architect:** Claude Opus 4.6 (Anthropic)  
**Status:** CANONICAL SOURCE OF TRUTH  
**Classification:** CONFIDENTIAL  
**Supersedes:** TIGERCLAW-MASTER-SPEC-v1.md, PRD_v4.md, BLUEPRINT_v4.md

---

## MANDATORY REVIEW PROTOCOL

> **WARNING: READ THIS BEFORE ANY CODING SESSION**
>
> This document represents decisions made by the product architect through extensive interview sessions across multiple weeks. Every architectural choice, interface contract, error handling path, and behavioral requirement in this document is INTENTIONAL and FINAL.
>
> **For any AI coding agent, human developer, or automated tool consuming this specification:**
>
> 1. Do NOT simplify, skip, or defer any requirement marked as LOCKED.
> 2. Do NOT make architectural decisions not covered by this spec. If you encounter a decision point not addressed here, STOP and flag it.
> 3. Implement error handling for every external call, every state transition, and every user-facing interaction.
> 4. Write tests for every public interface, every state transition, and every error path.
> 5. Use as many compute cycles, tokens, and iterations as necessary to produce production-quality code.
> 6. This codebase will serve 1,000+ tenants whose businesses depend on it.
>
> **Review Schedule:**
> - START of every coding session: Read this document in full.
> - MIDPOINT of any session exceeding 30 minutes: Re-read the relevant Block.
> - END of every session: Validate all work against this document before committing code.
> - If any implementation deviates from this spec, STOP and flag it.

---

## DOCUMENT MAP

| Block | Content | Status |
|-------|---------|--------|
| Block 1 | Tenant & Identity Model | LOCKED (31 decisions) |
| Block 2 | Flavors | LOCKED (14 decisions) |
| Block 3 | The Flywheel | LOCKED (48 decisions) |
| Block 4 | Key Rotation & Error Handling | LOCKED (new in v2) |
| Block 5 | Provisioning & Onboarding | LOCKED (new in v2) |
| Block 6 | Admin & Operations | LOCKED (new in v2) |
| Block 7 | Architecture Reconciliation | LOCKED (new in v2) |
| Appendix A | Sales DNA Catalog | Reference |
| Appendix B | Working Infrastructure from v4 | Reference |
| Appendix C | OpenClaw Integration Map | Reference |

---

# BLOCK 1: TENANT & IDENTITY MODEL

*Carried forward from v1 — all 31 decisions remain LOCKED.*

## 1.1 Tenant Definition

One tenant = one person = one primary agent = one primary flavor at a time. The agent can spin up sub-agents within its own tenant boundary (max 6-7, matching OpenClaw defaults). Secondary flavors require a second subscription/instance. Sub-agents inherit the tenant's permissions, API keys, and data isolation. They do not cross tenant walls.

## 1.2 Tenant Ownership

A tenant owns:

- Onboarding interview answers (identity + ICP for both oars)
- API keys (primary + fallback) and provider choice
- Flavor configuration and tenant-level customizations
- Lead database (all discovered, contacted, and converted leads)
- Nurture sequences (active and completed)
- Session history and transcripts
- Aftercare tier assignments
- Imported warm contacts and organization data
- Bot name and edification data (credentials, story, wins)

## 1.3 Tenant Lifecycle States

**Pending → Onboarding → Active → Paused → Suspended → Terminated**

- **Pending:** Payment received, provisioning in progress.
- **Onboarding:** Bot is live on platform onboarding key, interviews not complete.
- **Active:** Fully configured, both keys installed, flywheel running.
- **Paused:** Subscription lapsed, keys dead for 24+ hours, or manually paused. Everything freezes in place. Active nurture sequences stop. Leads preserved. Export available.
- **Suspended:** Admin action (abuse, nonpayment beyond grace period).
- **Terminated:** Export available for 30 days. After 30 days, full data purge. GDPR-compliant purge on request at any time.

## 1.4 Tenant Data Isolation

- Each tenant gets their own **SQLite database** inside their Docker container (complete data isolation).
- One shared **platform database (PostgreSQL)** for: billing, tenant registry, flavor catalog, skills catalog, API key metadata, provisioning state, admin operations, Hive patterns (cross-tenant anonymous learning).
- **Hard isolation:** tenants NEVER see each other's data under any circumstances.
- Shared content (Hive patterns, workflow templates) lives in the platform PostgreSQL, is anonymous, and is opt-in only.

> **CORRECTION FROM v4:** The v4 Blueprint used shared PostgreSQL for ALL tenant data (prospects, scripts, interview data). This is WRONG. Per-tenant SQLite is the locked decision. The shared PostgreSQL holds only platform-level data and the Hive.

## 1.5 Scaling Architecture

- **Launch infrastructure:** Docker Compose on cloud VPS.
- Each tenant = one Docker container running an unmodified OpenClaw instance with Tiger Claw skills pre-installed.
- TenantOrchestrator (Tiger Claw API, port 4000) manages container lifecycle via Docker API.
- **At 500 tenants:** Migrate orchestrator to Kubernetes. Same container images. Same runtime code. Only the orchestrator changes.
- **Scale targets:** Launch = 100 tenants. Year 1 = 1,000. Aspirational = 10,000.
- **No alternatives to this infrastructure path. This is FINAL.**

### Resource Estimates

| Scale | RAM Needed | Infrastructure |
|-------|-----------|----------------|
| 100 tenants | ~8 GB | Single VPS ($50-80/month) |
| 500 tenants | ~40 GB | 2-3 VPS nodes ($200-300/month) |
| 1,000 tenants | ~80 GB | Kubernetes cluster |

### TenantRuntime / TenantOrchestrator Boundary

**TenantRuntime** = an unmodified OpenClaw instance + Tiger Claw custom skills + tenant-specific config. It is a self-contained Docker container. Knows NOTHING about how it is hosted. Never references Docker, Kubernetes, or any hosting layer.

**TenantOrchestrator** = the Tiger Claw API (port 4000). Manages lifecycle: spin up, health check, shutdown, restart, provisioning, fleet monitoring. At launch, it spawns Docker containers via Docker Compose. At scale, it talks to Kubernetes.

> **LOCKED DECISION (v2):** Tiger Claw wraps unmodified OpenClaw (Path A). Each container runs a stock OpenClaw install. OpenClaw is never forked or modified. Tiger Claw's flywheel logic lives entirely as custom OpenClaw skills + cron jobs. One process per container. No sidecar.

## 1.6 Update Safety — The Ironclad Pipeline

### Five Safeguards

1. **Immutable container images:** Every version = a frozen Docker image tagged with a version number. Old tenants run old images until explicitly updated.
2. **Dependency vendoring:** ALL dependencies (OpenClaw, Pi SDK, channel libraries) are copied into the project at build time. No npm installs at runtime.
3. **Version pinning:** Tiger Claw pins to a specific, tested OpenClaw commit hash.
4. **Blue-green deployment:** New containers spin up alongside old ones. Traffic shifts to new. If healthy for 60 minutes, kill old. If unhealthy, automatic rollback.
5. **Automated health checks with circuit breaker:** Every container reports health every 30 seconds. 3 consecutive failures after an update = automatic rollback + admin Telegram alert.

### Update Rollout Pipeline

1. **Staging environment** with synthetic tenants. Automated test suite runs.
2. If staging passes → **Canary group** (5 designated tenants) for 24 hours.
3. If canary healthy → Rolling deployment: **10% → 25% → 50% → 100%** with 6-hour soak between each stage.
4. Health check failure at ANY stage = automatic rollback for affected containers.
5. Old images retained 30 days for emergency rollback.

## 1.7 Four-Layer Key Management

> **CORRECTION FROM v4:** The v4 implementation used a single shared ANTHROPIC_API_KEY for all tenants. This is WRONG and is exactly the failure mode that burned $2,000 in API credits. The four-layer system below is the locked decision.

### Layer 1 — Platform Onboarding Key (Tiger Claw's, disposable)
- Auto-provisioned at signup.
- Cheapest model available (Haiku, GPT-4o-mini).
- Rate-limited: **50 messages total.**
- Expires after **72 hours** OR when tenant installs their primary key, whichever comes first.
- Purpose: zero-friction first experience.

### Layer 2 — Tenant Primary Key (theirs, smart brain)
- Tenant provides during onboarding.
- Their chosen provider and model.
- No rate limit from Tiger Claw (provider's own limits apply).
- Powers the daily flywheel.

### Layer 3 — Tenant Fallback Key (theirs, cheap brain)
- **REQUIRED to complete onboarding. CANNOT be skipped.**
- If Layer 2 dies → automatic rotation to Layer 3.
- Agent tells tenant what happened and how to fix it.
- Rate limit: **20 messages per day.**

### Layer 4 — Platform Emergency Keep-Alive (Tiger Claw's, last resort)
- Activates ONLY when both Layer 2 and Layer 3 are dead.
- Ultra-restricted: **5 messages maximum.**
- After 24 hours with no key restoration → auto-transition to Paused state.

### Onboarding Key Sequence

1. Interview 1: Who are you? → Complete
2. Interview 2: Who's your ICP? → Complete
3. Key setup step 1: Enter primary API key → Complete
4. Key setup step 2: Enter fallback API key → **CANNOT PROCEED WITHOUT THIS**
5. Name your bot → Complete
6. SOUL.md regenerated with full tenant data
7. Onboarding finished, flywheel starts

## 1.8 Skills System

**Skills are NOT Flavors. This distinction is critical.**

- **Skills** = tools/capabilities. They DO things.
- **Flavors** = vertical business configurations. They define strategy.
- A tenant's agent uses many skills. A tenant's agent runs ONE flavor.

### Skill Safety Classification

- **Safe:** No side effects, no external calls.
- **Elevated:** External API calls, data access. Requires flavor-level approval.
- **Restricted:** System-level access, code execution. Requires admin unlock per tenant.

Every skill MUST have a safety classification. A skill without classification CANNOT load. Every flavor defines a skill allowlist.

### Skill Admission Pipeline — 6 Stages

**Candidate → Reviewed → Tested → Mapped → Live → Quarantined**

Error rate >5% = automatic disable across all tenants + admin Telegram alert.

## 1.9 Three-Layer Memory Architecture

### Layer 1: Working Memory (the desk)
Current conversation context only. Cleaned after every conversation ends.

### Layer 2: Structured Memory (the filing cabinet)
Important facts stored permanently as structured data in the tenant's SQLite database. NOT in the context window. Agent queries on demand.

### Layer 3: Long-Term Learning (the archive)
Aggregate patterns and insights. Feeds scoring model optimization and flavor improvement.

### Context Window Management — Hard Rules

- **Fixed token budget per interaction.** System prompt, flavor config, relevant lead data get FIRST priority.
- **Mandatory compaction at 80%.**
- **Session isolation:** Conversation with Prospect A NEVER bleeds into Prospect B.
- **Monthly structured memory cleanup:** 90 days no activity = purge.

## 1.10 Admin & Operations

- Super-tenant with full visibility.
- Admin alerts to dedicated Telegram channel.
- Automated daily backups, offsite storage (S3 or Backblaze).
- Platform-level rate limiting per tenant.
- Bot naming during onboarding — tenant names their bot.
- Bot identity is "Tiger Claw-powered" but carries tenant's chosen name.

## 1.11 Development Environment

- Dev environment = Docker container **identical** to production.
- All dependencies vendored. No runtime installs.
- If it runs in dev, it runs in prod. Period.

## Block 1 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | One tenant, one agent, one primary flavor | LOCKED |
| 2 | Sub-agent limit 6-7 per OpenClaw default | LOCKED |
| 3 | Tenant data ownership | LOCKED |
| 4 | Lifecycle: Pending → Onboarding → Active → Paused → Suspended → Terminated | LOCKED |
| 5 | Paused = freeze in place, export available | LOCKED |
| 6 | Per-tenant SQLite + shared platform PostgreSQL | LOCKED |
| 7 | Hard tenant isolation | LOCKED |
| 8 | Docker Compose at launch, Kubernetes at 500 | LOCKED |
| 9 | TenantRuntime / TenantOrchestrator boundary | LOCKED |
| 10 | Wrap unmodified OpenClaw (Path A) | LOCKED |
| 11 | Flywheel as OpenClaw skills + cron (no sidecar) | LOCKED |
| 12 | Immutable container images, vendoring, version pinning | LOCKED |
| 13 | Blue-green deployment with auto-rollback | LOCKED |
| 14 | 5-stage canary rollout pipeline | LOCKED |
| 15 | Health monitoring every 30s, 3 failures = rollback | LOCKED |
| 16 | Four-layer key management | LOCKED |
| 17 | Fallback key REQUIRED to complete onboarding | LOCKED |
| 18 | Skill safety classification enforced at runtime | LOCKED |
| 19 | Flavor defines skill allowlist | LOCKED |
| 20 | 6-stage Skill Admission Pipeline | LOCKED |
| 21 | Three-layer memory architecture | LOCKED |
| 22 | Working memory cleaned after every conversation | LOCKED |
| 23 | Session isolation | LOCKED |
| 24 | Fixed context budget with auto-compaction at 80% | LOCKED |
| 25 | Monthly structured memory cleanup, 90-day purge | LOCKED |
| 26 | Admin super-tenant with Telegram alerts | LOCKED |
| 27 | Automated daily backups, offsite, tested restore | LOCKED |
| 28 | 30-day data retention post-termination | LOCKED |
| 29 | Platform-level rate limiting per tenant | LOCKED |
| 30 | Dev environment = production container | LOCKED |
| 31 | Build Quality Mandate and Review Protocol | LOCKED |

---

# BLOCK 2: FLAVORS

*Carried forward from v1 — all 14 decisions remain LOCKED, plus new regional architecture.*

## 2.1 Product Model

**One product: Tiger Claw.** Tiger Claw is the base agent (all OpenClaw core capabilities) PLUS the hunting flywheel. Every tenant gets both. There is no "Alien Claw" as a separate product.

All 52 bundled OpenClaw skills are available to all tenants, subject to the skill safety classification system. Tiger Claw's custom flywheel skills layer on top. Tenants get a full personal AI assistant PLUS the hunting engine.

## 2.2 What a Flavor IS

A Flavor is exactly three things:

1. **System prompt fine-tuning:** Industry context, tone, goals.
2. **A curated set of default skills:** 2-3 skills maximum. Invisible to tenant.
3. **Tailored onboarding questions:** ICP and identity interviews customized per profession.

**A Flavor is NOT:** A separate product. A feature gate. A large skill bundle.

## 2.3 Four-Layer Flavor Architecture

> **NEW IN v2:** Regional config layer added between Base and Flavor.

```
Base Config (universal flywheel mechanics — scoring, nurture cadence, conversion rules)
  └── Regional Config (language, platforms, discovery sources, cultural content)
       └── Flavor (NM, Real Estate, Health & Wellness — profession-specific logic)
            └── Tenant Customization (bot name, personal tone, credentials, timing)
```

### Base Config (universal)
- Scoring engine (three dimensions, weights, threshold)
- Nurture cadence mechanics (30-day sequence, 7-8 touches, 3-5 day default)
- Conversion rules
- Aftercare tier structure
- Key rotation behavior
- Error handling
- Core flywheel stage definitions

### Regional Config (per-market)
Each region defines:
- **Language** for SOUL.md and all agent communications
- **Discovery source selection** (which platforms are active)
- **Pattern Interrupt Story library** (culturally appropriate)
- **Objection bucket content** (culturally relevant responses)
- **Persuasion principle adaptations**
- **Timing norms** (business hours, communication cadence)
- **Compliance requirements** (data privacy laws, messaging regulations)

### Flavor (per-profession)
Controls flywheel intensity and style. Defines what's different from base. Inherits everything else.

### Tenant Customization (per-person)
Guided customization. Can adjust tone, keywords, templates, timing. CANNOT remove core behaviors.

## 2.4 Launch Configuration

### Launch Markets

| Market | Region Code | Primary Channel | Discovery Sources |
|--------|------------|-----------------|-------------------|
| United States | `us-en` | Telegram, WhatsApp | Reddit, Facebook Groups, Telegram |
| Thailand | `th-th` | LINE, Telegram | Facebook Groups, LINE OpenChat, Telegram |

### Launch Flavors

1. **Network Marketer** — flagship. Two-oar model. Built from 35 years of sales DNA.
2. **Real Estate Agent** — single-oar. Clear conversion action.
3. **Health & Wellness / Personal Services** — single-oar.

**Airbnb is 4th flavor** — built as soon as launch flavors are stable.

### Language Handling

- OpenClaw's built-in i18n system handles all system-level strings (errors, notifications, UI). Thai is already a P1 target language in OpenClaw's i18n spec.
- The LLM handles conversational language natively — agent speaks whatever language the SOUL.md and regional config specify.
- LINE channel detection defaults to Thai automatically (built into OpenClaw).
- Regional config sets the language, cultural framing, and communication norms.

### Launch Languages

| Code | Language | Market | Detection |
|------|----------|--------|-----------|
| `en` | English | US (default, fallback) | Default |
| `th` | Thai | Thailand | LINE channel auto-detect |

### Bot Identity — SOUL.md

Generated per tenant during provisioning. Contains:
- Tenant's chosen bot name (from naming ceremony)
- Tiger Claw brand edification: "I'm [BotName], built on Tiger Claw technology, powered by OpenClaw."
- Tenant edification: credentials, story, wins (from onboarding interview)
- Flavor-specific personality tuning
- Regional cultural framing
- Language directive

## 2.5 Network Marketer Flavor — System Prompt Layers

### Layer 1: Macro Narrative (primary frame)
AI is displacing the middle management layer. Network marketing is the ready-made answer. "Their business, not mine" independence framing.

### Layer 2: Product Tip-of-Sword (secondary, swappable)
Tenant updates this in their config. Always secondary to the opportunity narrative.

## Block 2 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | One product: Tiger Claw (no Alien Claw split) | LOCKED |
| 2 | All 52 OpenClaw bundled skills available to tenants | LOCKED |
| 3 | Flavor = system prompt + curated skills + tailored onboarding | LOCKED |
| 4 | Four-layer flavor architecture (base → regional → flavor → tenant) | LOCKED |
| 5 | Regional config owns cultural content, language, discovery sources | LOCKED |
| 6 | Dual-market launch: US + Thailand | LOCKED |
| 7 | LINE required at launch for Thailand market | LOCKED |
| 8 | Language handled by i18n (system) + LLM (conversations) | LOCKED |
| 9 | Four launch discovery sources: Reddit (US), Facebook Groups (both), LINE OpenChat (Thailand), Telegram (both) | LOCKED |
| 10 | 3 launch flavors: Network Marketer, Real Estate, Health & Wellness | LOCKED |
| 11 | Flavor Quick-Build Kit for rapid creation (2-hour target) | LOCKED |
| 12 | Flavors as competitive moat improved by admin analytics | LOCKED |
| 13 | Macro narrative + tip-of-sword layered system prompt | LOCKED |
| 14 | "Their business, not mine" independence framing | LOCKED |
| 15 | SOUL.md carries bot name + Tiger Claw brand + tenant edification | LOCKED |
| 16 | Thai cultural content provided by Thai organization leader | LOCKED |

---

# BLOCK 3: THE FLYWHEEL

*Carried forward from v1 — all 48 decisions remain LOCKED.*

Five stages: **Discovery → First Contact → Nurture → Conversion → Retention.**

## 3.1 Two-Oar Model

### Oar 1: Business Builder (Recruiting)
### Oar 2: Customer (Product Sales)

Network marketing flavors run both oars simultaneously. Non-MLM flavors run single oar.

## 3.2 Lead Scoring Model — Three Dimensions

### Dimension 1: Profile Fit (0-100) — static
### Dimension 2: Intent Signals (0-100) — behavioral, recency-weighted
### Dimension 3: Engagement (0-100) — builds over time

### Scoring Weights

**Business Builder:** Profile Fit 30% / Intent 45% / Engagement 25%
**Customer:** Profile Fit 25% / Intent 50% / Engagement 25%

### Threshold

**80. Fixed. Not configurable per tenant.**

> **CORRECTION FROM v4:** The v4 implementation used a threshold of 70. This is WRONG. The locked threshold is 80.

### Dual-Oar Unicorn Bonus
Lead triggering signals in BOTH oars = automatic **+15 point bonus** on higher score. Prioritized above single-oar leads.

### Below-Threshold Leads
Visible but gated, 90-day purge. Tenant sees "warming" list but cannot contact them.

## 3.3 The Involvement Spectrum

Eight levels (0-7), behavior-triggered transitions. "Always ask for the next small action."

| Level | Description | Bot Behavior |
|-------|-------------|--------------|
| 0 | Prospect | Discovery / First Contact |
| 1 | Engaged | Nurture sequence |
| 2 | Customer | Customer aftercare, referral requests |
| 3 | Repeat customer | Deeper aftercare, wholesale suggestion |
| 4 | Referral source | Recognition, subtle opportunity messaging |
| 5 | Wholesale buyer | Side hustle content |
| 6 | Side hustle builder | Training support, goal setting |
| 7 | Full-time builder | Leadership development |

## 3.4 Stage 1: Discovery

### Sources by Market

| Source | US | Thailand | Compliance Tier | Implementation |
|--------|-----|----------|----------------|----------------|
| Reddit | YES | NO | Tier 1 (Official API) | Reddit public JSON API |
| Facebook Groups | YES | YES | Tier 2 (Public Passive) | Public group reading |
| LINE OpenChat | NO | YES | Tier 2 (Public Passive) | LINE API |
| Telegram | YES | YES | Tier 1 (Official API) | Telegram bot API |

Flavor config declares which sources are active for that tenant's region.

### Scan Modes
- **Scheduled baseline:** 5:00 AM tenant's timezone. Keeps pipeline flowing.
- **On-demand burst:** Tenant triggers intensive scan. Rate limits prevent abuse.

### Daily Target
Minimum 5 prospects per tenant per day scoring above threshold.

### Duplicate Detection
One lead profile per person, dual-oar tagging.

## 3.5 Stage 2: First Contact

**Agent sends first contact AUTONOMOUSLY. No human in the loop by default.** Manual approval available as opt-in.

**Agent does NOT pretend to be human.**

### Agent Edification Protocol (Named Feature)
Bot transfers authority to tenant using real credentials from onboarding data.

### Three Strategies
1. **Direct:** High-intent, high-fit leads.
2. **Indirect ("Who Do You Know?"):** Moderate-intent, high-fit leads.
3. **Referral:** Leads entering via referral.

### Timing
Randomized 1-4 hour delay within reasonable hours for prospect's timezone.

### Response Handling — Never Chase
- **Positive:** → Move to Nurture
- **Neutral:** → One follow-up within 48 hours
- **Negative:** → PERMANENTLY opted out
- **No response:** → One follow-up in 72 hours, then back to pool

## 3.6 Stage 3: Nurture

**30-day sequence. 7-8 touches. 3-5 day default cadence.**

### Touch Types
Value drop, Testimonial, Authority transfer, Personal check-in, The 1-10 question, Scarcity/takeaway.

### The 1-10 Framework (Two-Part)
**Part 1:** "On a scale of 1-10, where are you?"
**Part 2:** "What would you need to know to be a 10?" (fires for 6-7 only)

Maximum 2 rounds of gap-closing. Still 6-7 after two rounds → takeaway.

### Pattern Interrupt Stories (Named Feature)
Culturally appropriate per regional config. US: Airplane Question, Japan Expansion, Rick and the Takeaway, etc. Thailand: provided by Thai organization leader.

### Nurture Exit Conditions
- 8-10 → Conversion
- 6-7 after 2 rounds → Takeaway, slow drip
- 5 or below → Immediate takeaway
- No response to 2 consecutive → Exit, score penalty
- Explicit opt-out → Permanent exit
- 30-day complete without conversion → Final takeaway, slow drip

### Daily Briefing
Every morning in tenant's preferred channel. Not a dashboard.

## 3.7 Stage 4: Conversion

### Business Builder: Three-Way Handoff
Bot briefs tenant → edifies tenant to prospect → connects them → steps back.

### Customer: Bot Closes Autonomously

## 3.8 Stage 5: Retention & Aftercare

### Track A: Business Builder Aftercare
Day 1-7 welcome → Day 8-30 skill building → Day 31-90 momentum → Ongoing check-ins.

### Track B: Customer Aftercare
**Bronze → Silver → Gold** auto-assigned by behavior. Referral generation built into all tiers.

### Customer-to-Builder Upgrade Detection
Bot watches for builder signals, flags to tenant.

### Organization Nurture
CSV import for existing contacts. Individual messages, NOT bulk email.

## Block 3 Decision Checksum

*All 48 decisions from v1 remain LOCKED. Key corrections noted:*

| # | Decision | Status |
|---|----------|--------|
| 1-48 | All v1 Block 3 decisions | LOCKED |
| CORRECTION | Scoring threshold is 80, not 70 | LOCKED |
| CORRECTION | Per-tenant SQLite for lead data, not shared PostgreSQL | LOCKED |

---

# BLOCK 4: KEY ROTATION & ERROR HANDLING

*NEW in v2.*

## 4.1 Error Classification

Tiger Claw inherits OpenClaw's error taxonomy (5 categories, codes 1xxx-5xxx) and adds Tiger Claw-specific error handling for the four-layer key system.

### API Key Error States

| HTTP Status | Meaning | Layer Action |
|-------------|---------|--------------|
| 401 | Invalid/revoked key | Rotate to next layer immediately |
| 402 | Payment required (billing) | Rotate to next layer + notify tenant |
| 403 | Forbidden (permissions) | Rotate to next layer + notify tenant |
| 429 | Rate limited | Wait for Retry-After header, do NOT rotate |
| 5xx | Provider down | Retry 3x with exponential backoff, then rotate |
| Timeout (30s) | No response | Retry 2x, then rotate |
| Degraded | Slow but working | Log warning, do NOT rotate |

### Key Rotation Cascade

```
Layer 2 (Primary) fails
  → Classify error (above)
  → If rotation trigger: switch to Layer 3 (Fallback)
  → Notify tenant: "Your primary key failed. Running on backup. Here's how to fix it."
  → Log: key_rotation event with timestamp, error code, source layer, target layer

Layer 3 (Fallback) fails
  → Switch to Layer 4 (Emergency Keep-Alive)
  → Notify tenant: "Both your keys are dead. Fix this or bot pauses in 24 hours."
  → Notify admin: Telegram alert with tenant ID

Layer 4 (Emergency) exhausted (5 messages used)
  → Transition tenant to Paused state
  → Final message to tenant: "Your bot is paused. Restore API keys to resume."
  → Notify admin
```

### Key Recovery

When tenant restores a key:
- Agent validates key with a test API call before accepting
- If valid: switch back to restored layer
- If primary restored: switch from fallback back to primary
- Log: key_recovery event

### Rate Limit Handling

- **429 responses:** Respect Retry-After header. Do NOT count as key failure.
- **Exponential backoff:** 1s → 2s → 4s → 8s → max 60s
- **Jitter:** ±10% to prevent thundering herd across tenants
- **Per-tenant rate limiting at platform level:** Prevents one tenant's heavy usage from degrading others

## 4.2 Notification Channels

| Event | Tenant Notification | Admin Notification |
|-------|--------------------|--------------------|
| Primary key failure | In-channel message | None (expected) |
| Fallback key failure | In-channel message | Telegram alert |
| Emergency key activated | In-channel message | Telegram alert |
| Tenant auto-paused | Final in-channel message | Telegram alert |
| Key restored | In-channel confirmation | None |
| Container health failure | None | Telegram alert |
| Update rollback | None | Telegram alert |
| Skill quarantined | None | Telegram alert |

## Block 4 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | 7 API error states classified with specific actions | LOCKED |
| 2 | Rotation cascade: Primary → Fallback → Emergency → Pause | LOCKED |
| 3 | 429 rate limits respected, NOT treated as key failure | LOCKED |
| 4 | Exponential backoff with jitter for retries | LOCKED |
| 5 | Key recovery validates before accepting | LOCKED |
| 6 | All rotations and recoveries logged as events | LOCKED |
| 7 | Notification matrix defined for all failure modes | LOCKED |
| 8 | Platform-level per-tenant rate limiting | LOCKED |

---

# BLOCK 5: PROVISIONING & ONBOARDING

*NEW in v2. Reconciles working v4 infrastructure with Master Spec requirements.*

## 5.1 Payment → Live Bot Pipeline

**Target: 60 seconds from payment to bot sending first message.**

### Trigger: Stripe/Stan Store Webhook

```
1. Customer pays on Stan Store → Stripe webhook fires
     │
     ▼
2. Tiger Claw API (port 4000) receives POST /webhooks/stripe
     │  - Validates Stripe signature
     │  - Extracts: email, name, preferredLanguage, selected channel
     │
     ▼
3. Platform PostgreSQL: Create Tenant record
     │  - Status: "pending"
     │  - Generate tenant UUID
     │  - Generate OpenClaw gateway token
     │  - Assign next available port (18801, 18802, ...)
     │
     ▼
4. Docker container spun up
     │  - Stock OpenClaw image + Tiger Claw skills pre-installed
     │  - openclaw.json generated from template with:
     │      - Platform onboarding key (Layer 1) as API key
     │      - Cheapest model (Haiku/GPT-4o-mini)
     │      - Channel credentials (Telegram bot token OR LINE credentials)
     │      - Tiger Claw skill config pointing to platform API
     │      - Cron jobs configured for tenant timezone
     │  - SOUL.md generated (basic pre-onboarding version)
     │  - Container starts, OpenClaw gateway boots
     │
     ▼
5. Health check: Container responds on /health within 30 seconds
     │
     ▼
6. Tenant status → "onboarding"
     │
     ▼
7. Bot sends first message to tenant in their preferred channel:
     "Hi! I'm your new Tiger Claw agent. Let's get you set up."
     │
     ▼
8. Onboarding interview begins (see 5.2)
```

### Channel Bootstrapping

The tenant's selected channel must be operational BEFORE the bot can contact them.

| Channel | Bootstrap Method | Requirement |
|---------|-----------------|-------------|
| Telegram | Pre-created bot token via @BotFather | Tenant provides token at checkout, OR Tiger Claw pre-creates bots |
| LINE | LINE Messaging API credentials | Tenant provides channel secret + access token |
| WhatsApp | Baileys QR pairing | Tenant scans QR code during onboarding |

**For launch:** Telegram is the easiest bootstrap (single bot token). LINE requires credentials from LINE Developers Console. WhatsApp requires interactive QR pairing.

**Recommendation for launch:** Telegram as default onboarding channel for all markets. LINE added as secondary channel during or after onboarding for Thai tenants.

## 5.2 Onboarding Interview Flow

Conducted by the bot in the tenant's preferredLanguage. Uses the platform onboarding key (Layer 1, 50 message limit).

### Phase 1 — Identity Interview: "Who are you?"

Questions (adapted to flavor):
- What's your name?
- What product/opportunity do you represent?
- How long have you been in [profession]?
- What's your monthly income goal?
- What's your biggest win? (for edification data)
- What makes you different from others in your field? (for edification data)

Bot extracts structured data and stores in tenant's SQLite as structured memory.

### Phase 2 — ICP Interview: "Who are you looking for?"

For two-oar flavors (Network Marketer), this runs twice — once for business builder ICP, once for customer ICP.

Questions:
- Describe your ideal [recruit/customer]. Who are they?
- What problem are they trying to solve?
- What are they doing right now that isn't working?
- Where do they spend time online?
- Any types of people to avoid?

Bot summarizes ICP back to tenant for confirmation, then adjusts.

### Phase 3 — Key Setup

1. "Now let's set up your AI brain. You'll need an API key from [provider]."
2. Bot provides direct links and step-by-step walkthrough for cheapest providers.
3. Tenant enters primary API key → bot validates with test call.
4. "Great. Now I need a backup key in case your primary runs out." → Fallback key entry → validated.
5. Platform onboarding key (Layer 1) deactivated. Tenant's keys take over.

### Phase 4 — Bot Naming Ceremony

1. "Last thing — what do you want to call me?"
2. Tenant names bot.
3. SOUL.md regenerated with full tenant data: name, edification, credentials, flavor personality, regional framing, language directive.

### Phase 5 — Flywheel Start

1. Tenant status → "active"
2. First scout hunt triggers immediately.
3. "I'm on it. Check back tomorrow morning for your first daily briefing."
4. Cron jobs activated: daily scout (5 AM tenant timezone), daily report (7 AM tenant timezone).

## 5.3 Working Infrastructure (from v4)

The following v4 infrastructure is KEPT and adapted:

### provision-customer.sh (adapted)

The existing shell script (SSH → create compose file → start container) works and is kept as the manual provisioning path. It is adapted to:
- Inject per-tenant SQLite instead of shared PostgreSQL connection
- Use the four-layer key system instead of a single shared key
- Include regional config and flavor selection
- Set timezone-aware cron schedules

### Tiger Claw API (port 4000)

The Express API from v4 is kept as the TenantOrchestrator. Endpoints:
- `POST /webhooks/stripe` — automated provisioning
- `POST /admin/provision` — manual provisioning (comped/gifted)
- `GET /admin/fleet` — all tenant status
- `POST /admin/fleet/:tenantId/report` — trigger manual report
- `DELETE /admin/fleet/:tenantId` — suspend tenant
- `GET /hive/patterns` — cross-tenant pattern queries
- `POST /hive/patterns` — submit winning patterns

### Docker Infrastructure

The v4 Docker setup (per-customer compose files, infrastructure compose for PostgreSQL + Redis + Nginx) is kept with these corrections:
- Per-tenant SQLite inside container (not shared PostgreSQL for tenant data)
- Four-layer key injection instead of single ANTHROPIC_API_KEY
- Regional config and flavor config added to container environment

## Block 5 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | 60-second payment to live bot target | LOCKED |
| 2 | Stripe/Stan Store webhook triggers provisioning | LOCKED |
| 3 | Tiger Claw API (port 4000) as TenantOrchestrator | LOCKED |
| 4 | Platform PostgreSQL for tenant registry, per-tenant SQLite in container | LOCKED |
| 5 | Platform onboarding key active during entire onboarding | LOCKED |
| 6 | Onboarding: Identity → ICP → Primary Key → Fallback Key → Name Bot → Start | LOCKED |
| 7 | Fallback key required, cannot skip | LOCKED |
| 8 | SOUL.md regenerated with full tenant data after naming | LOCKED |
| 9 | First scout hunt triggers immediately after onboarding | LOCKED |
| 10 | Cron: daily scout 5 AM, daily report 7 AM, tenant timezone | LOCKED |
| 11 | Telegram as default onboarding channel, LINE added for Thai tenants | LOCKED |
| 12 | v4 provision-customer.sh kept and adapted | LOCKED |
| 13 | v4 Tiger Claw API endpoints kept and adapted | LOCKED |
| 14 | v4 Docker infrastructure kept with corrections | LOCKED |

---

# BLOCK 6: ADMIN & OPERATIONS

*NEW in v2.*

## 6.1 Super-Tenant Dashboard

Brent operates as super-tenant via a dedicated Telegram bot (admin channel). NOT a web dashboard at launch — a message in the channel he lives in.

### Admin Commands

| Command | Action |
|---------|--------|
| `/fleet` | All tenants: name, status, last report, health |
| `/fleet [slug]` | Single tenant detail: container stats, key status, lead counts |
| `/provision --name "X" --lang th --channel telegram --token BOT_TOKEN` | Manual provision |
| `/suspend [slug]` | Suspend tenant |
| `/resume [slug]` | Resume suspended tenant |
| `/report [slug]` | Manually trigger daily report |
| `/logs [slug]` | Tail last 50 log lines |
| `/health` | System-wide: PostgreSQL, Redis, disk, memory, container count |
| `/update status` | Show current image versions, pending updates, canary status |

### Daily Admin Briefing (7:30 AM Phoenix time)

Sent automatically to admin Telegram channel:

```
🐯 Tiger Claw Fleet Report
February 27, 2026

Active tenants: 47
Onboarding: 3
Paused: 2

Last 24 hours:
  New signups: 4
  Key failures: 1 (Nancy — primary expired, running on fallback)
  Container restarts: 0
  Conversions across fleet: 12

Revenue:
  MRR: $4,653
  Churn risk: 2 tenants inactive >7 days

Action needed:
  • Nancy's primary key expired 6 hours ago — monitor
  • Container tiger-claw-somchai using 92% memory — investigate
```

## 6.2 Health Monitoring

### Per-Container Health Check

Every 30 seconds, TenantOrchestrator pings each container's OpenClaw health endpoint.

Health response includes:
- Gateway status (up/down)
- Channel connections (connected/disconnected per channel)
- Last agent activity timestamp
- Memory usage
- Key layer status (which layer is active)

### Alert Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Container memory | >80% | >95% | Restart container |
| No health response | 1 miss | 3 consecutive | Auto-restart, then alert |
| Key layer degradation | Layer 3 active | Layer 4 active | Telegram alert |
| No agent activity | >24 hours | >72 hours | Flag as potentially churned |
| Disk usage | >80% | >95% | Alert, run cleanup |

## 6.3 Backup & Restore

### Automated Backups

| Data | Frequency | Retention | Storage |
|------|-----------|-----------|---------|
| Platform PostgreSQL | Every 6 hours | 30 days | Offsite (S3/Backblaze) |
| All tenant SQLite databases | Daily | 30 days | Offsite |
| Container configs (openclaw.json per tenant) | On change | 30 versions | Offsite |
| Hive patterns | Daily | 90 days | Offsite |

### Restore Procedures

**Single tenant restore:**
1. Stop tenant container
2. Download tenant SQLite backup from offsite
3. Replace SQLite in container volume
4. Restart container
5. Verify via `/fleet [slug]`

**Full platform restore:**
1. Provision new VPS
2. Restore PostgreSQL from backup
3. Restore all container configs
4. Start infrastructure (PostgreSQL, Redis, Nginx)
5. Start Tiger Claw API
6. Start all tenant containers
7. Verify via `/health`

**Target recovery time:** 30-60 minutes for full platform restore.

## 6.4 Canary Deployment Operations

1. Build new Docker image with version tag
2. Push to container registry
3. Deploy to staging with synthetic tenants → run automated tests
4. If pass: deploy to 5 canary tenants → monitor 24 hours
5. If healthy: rolling deploy 10% → 25% → 50% → 100% with 6-hour soak
6. At any stage: 3 consecutive health failures = automatic rollback
7. Old images retained 30 days

### Admin Commands for Updates

| Command | Action |
|---------|--------|
| `/update build v2.1.0` | Build new image |
| `/update canary v2.1.0` | Deploy to canary group |
| `/update status` | Canary health, rollout progress |
| `/update rollout v2.1.0 10` | Deploy to 10% |
| `/update rollback v2.1.0` | Emergency rollback to previous |

## Block 6 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | Admin dashboard via Telegram bot, not web UI at launch | LOCKED |
| 2 | Daily admin briefing at 7:30 AM Phoenix time | LOCKED |
| 3 | Health check every 30 seconds per container | LOCKED |
| 4 | Alert thresholds defined for memory, health, keys, activity, disk | LOCKED |
| 5 | Automated backups: PostgreSQL 6-hourly, SQLite daily, configs on-change | LOCKED |
| 6 | Offsite backup storage (S3/Backblaze) | LOCKED |
| 7 | Documented restore procedures for single tenant and full platform | LOCKED |
| 8 | 30-60 minute target recovery time | LOCKED |
| 9 | Canary deployment via admin Telegram commands | LOCKED |
| 10 | Automatic rollback on 3 consecutive health failures | LOCKED |

---

# BLOCK 7: ARCHITECTURE RECONCILIATION

*NEW in v2. Resolves conflicts between Master Spec v1 and v4 implementation.*

## 7.1 What v4 Built Correctly (KEEP)

| Component | Status | Notes |
|-----------|--------|-------|
| Container-per-tenant Docker architecture | KEEP | Matches Master Spec |
| Tiger Claw API on port 4000 | KEEP | Becomes TenantOrchestrator |
| provision-customer.sh | KEEP | Adapt for four-layer keys + per-tenant SQLite |
| Stripe webhook → provisioning | KEEP | Add onboarding flow after provisioning |
| Fleet admin endpoints | KEEP | Extend with health monitoring |
| SKILL.md format for Tiger Claw skill | KEEP | Expand with full flywheel tools |
| Scout tool (prospect hunting) | KEEP | Add scoring threshold correction (80, not 70) |
| Scripter tool (script generation) | KEEP | Integrate with nurture sequences |
| Coach tool (objection handling) | KEEP | Map to per-flavor objection buckets |
| Hive patterns (cross-tenant learning) | KEEP | Move to platform PostgreSQL |
| Docker Compose templates | KEEP | Adapt environment variables |
| Serper.dev 3-key rotation | KEEP | Add per-tenant rate limiting |
| Language detection (franc library) | KEEP | Supplement with LLM native fluency |
| BullMQ job queue | EVALUATE | May not be needed if OpenClaw cron handles scheduling |

## 7.2 What v4 Got Wrong (CORRECT)

| v4 Decision | Correction | Reason |
|-------------|-----------|--------|
| Shared PostgreSQL for ALL data | Per-tenant SQLite for tenant data | Master Spec Section 1.4. Hard isolation. |
| Single shared ANTHROPIC_API_KEY | Four-layer key management per tenant | Master Spec Section 1.7. Prevents $2K burn. |
| Scoring threshold 70 | Threshold 80, fixed | Master Spec Section 3.2. LOCKED. |
| No onboarding interview in provisioning | Full interview flow after container boot | Master Spec Sections 1.7 + 5.2. |
| No nurture sequences | 30-day, 7-8 touch nurture engine | Master Spec Section 3.6. Core flywheel. |
| No first contact automation | Autonomous first contact with edification | Master Spec Section 3.5. |
| No aftercare system | Bronze/Silver/Gold tiered aftercare | Master Spec Section 3.8. |
| No flavor system | Four-layer flavor architecture | Master Spec Block 2. |
| Sub-agents (Scout/Scripter/Coach/Hive) as separate agents | All as OpenClaw skills, not sub-agents | v2 locked decision. Skills + cron. |
| BullMQ for cron scheduling | OpenClaw native cron scheduler | Simplifies to one process per container. |

## 7.3 Migration Path from v4 Codebase

If resuming development from the v4 codebase:

### Phase 1: Foundation Corrections
1. Add per-tenant SQLite support to skill tools (replace Prisma PostgreSQL queries)
2. Implement four-layer key management in container config
3. Correct scoring threshold to 80
4. Remove BullMQ dependency — use OpenClaw cron for all scheduling

### Phase 2: Missing Flywheel Components
5. Implement onboarding interview flow as skill
6. Implement nurture sequence engine as skill
7. Implement first contact automation as skill
8. Implement aftercare engine as skill
9. Implement 1-10 framework as skill
10. Implement daily briefing via OpenClaw cron

### Phase 3: Flavor & Regional Architecture
11. Implement base → regional → flavor → tenant config layering
12. Create US regional config (English, Reddit/Facebook/Telegram sources, American stories)
13. Create Thailand regional config (Thai, Facebook/LINE/Telegram sources)
14. Create Network Marketer flavor
15. Create Real Estate flavor
16. Create Health & Wellness flavor

### Phase 4: Operations
17. Implement health monitoring in Tiger Claw API
18. Implement admin Telegram bot
19. Implement automated backup system
20. Implement canary deployment pipeline

---

# APPENDIX A: SALES DNA CATALOG

*Carried forward from v1 unchanged. See v1 for full catalog including:*
- 13 Frameworks
- 10 Persuasion Principles
- 7 Pattern Interrupt Stories
- 7 Objection Buckets (Network Marketer flavor, US regional)

---

# APPENDIX B: WORKING INFRASTRUCTURE FROM v4

## B.1 Server Details

| Resource | Value |
|----------|-------|
| Server IP | 209.97.168.251 (DigitalOcean) |
| SSH Key | `/Users/brentbryson/Desktop/botcraft key pair.pem` |
| Customer containers | `/home/ubuntu/customers/{slug}/` |
| Tiger Claw API | port 4000 |
| PostgreSQL | port 5432, database `tiger_bot` |
| Redis | port 6379 |
| Container port range | 18801+ |

## B.2 Working provision-customer.sh

See uploaded `provision-customer_copy.sh` — this script is functional and tested. It:
1. Parses arguments (slug, name, token, port, lang, flavor)
2. Clears Telegram webhook
3. Generates Docker Compose file with environment variables
4. SSHs into server, creates customer directory, starts container
5. Waits 10 seconds, verifies container is running

**Adaptations needed for v2:**
- Replace single ANTHROPIC_API_KEY with four-layer key injection
- Add per-tenant SQLite volume mount
- Add regional config and flavor config to environment
- Add SOUL.md generation step
- Add health check verification
- Trigger onboarding interview after container boot

## B.3 Docker Image Structure

```dockerfile
FROM node:22-slim
RUN npm i -g openclaw@{PINNED_VERSION}
COPY skill/ /root/.openclaw/workspace/skills/tiger-claw-scout/
COPY docker/customer/entrypoint.sh /root/
EXPOSE 18789
ENTRYPOINT ["./entrypoint.sh"]
```

Entrypoint generates `openclaw.json` from environment variables, then starts OpenClaw gateway.

---

# APPENDIX C: OPENCLAW INTEGRATION MAP

## C.1 OpenClaw Features Used by Tiger Claw

| OpenClaw Feature | Tiger Claw Usage |
|-----------------|-----------------|
| Gateway (WebSocket server) | Per-tenant control plane |
| Channel plugins (Telegram, LINE, WhatsApp) | Multi-channel messaging |
| Cron scheduler | Daily scout, daily report, nurture timing |
| Skills system | All flywheel logic |
| SOUL.md | Bot personality, tenant identity, brand edification |
| Memory system | Structured memory for leads, conversations |
| Session management | Conversation isolation per prospect |
| Config hot-reload | Runtime key rotation |
| i18n | System strings in Thai, English |
| 52 bundled skills | Additional value for tenants |

## C.2 OpenClaw Features NOT Used

| Feature | Reason |
|---------|--------|
| Browser automation (Playwright) | Not needed for launch |
| Companion apps (macOS/iOS/Android) | Future roadmap |
| Voice Wake / Talk Mode | Future roadmap |
| Canvas rendering | Not applicable |
| ClawHub publishing | Post-launch distribution |

## C.3 Custom Tiger Claw Skills (to build)

| Skill | OpenClaw Type | Cron? | Description |
|-------|--------------|-------|-------------|
| `tiger-scout` | Tool | Yes (5 AM) | Prospect discovery across configured sources |
| `tiger-score` | Tool | No | Lead scoring engine (three dimensions) |
| `tiger-contact` | Tool | Yes (check hourly) | First contact automation with timing delay |
| `tiger-nurture` | Tool | Yes (check hourly) | Nurture sequence engine (touch scheduling) |
| `tiger-convert` | Tool | No | Conversion handling (three-way handoff or auto-close) |
| `tiger-aftercare` | Tool | Yes (daily) | Aftercare tier management and touches |
| `tiger-briefing` | Tool | Yes (7 AM) | Daily briefing generation and delivery |
| `tiger-score-1to10` | Tool | No | 1-10 framework two-part question handler |
| `tiger-objection` | Tool | No | Objection handling with per-flavor buckets |
| `tiger-import` | Tool | No | CSV import for warm contacts / organization |
| `tiger-hive` | Tool | No | Hive pattern query and submission |
| `tiger-onboard` | Tool | No | Onboarding interview flow |
| `tiger-keys` | Tool | No | Key management (rotation, validation, status) |
| `tiger-settings` | Tool | No | Tenant settings management |

---

# DOCUMENT METADATA

**Total locked decisions:** 127
- Block 1: 31
- Block 2: 16
- Block 3: 48 (with 2 corrections)
- Block 4: 8
- Block 5: 14
- Block 6: 10

**Source materials reconciled:**
- TIGERCLAW-MASTER-SPEC-v1.md (93 locked decisions)
- PRD_v4.md (v4 feature spec from Cursor)
- BLUEPRINT_v4.md (v4 technical blueprint from Cursor)
- provision-customer_copy.sh (working provisioning script)
- 18 OpenClaw documentation files (~450KB)
- Multi-session architect interviews (February 2026)

**v4 corrections applied:** 9 (database architecture, key management, scoring threshold, onboarding flow, nurture sequences, first contact, aftercare, flavor system, scheduling approach)

**Sub-specification documents still needed:**
1. TenantRuntime TypeScript interface contract
2. Flavor Template Format (fill-in-the-blanks for rapid flavor creation)
3. Thai Regional Config (requires input from Thai organization leader)

---

*This document is the canonical source of truth for Tiger Claw development. It supersedes all previous specifications. Every architectural decision was made through deliberate interview with the product architect. No AI coding agent, human developer, or automated tool may override, simplify, or defer any LOCKED decision without explicit written approval from the architect.*
