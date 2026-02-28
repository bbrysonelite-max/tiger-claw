# TIGER CLAW — MASTER SPECIFICATION v1.0

**Date:** February 26, 2026  
**Architect:** Brent "Pebo" Bryson  
**Co-Architect:** Claude (Anthropic)  
**Status:** CANONICAL SOURCE OF TRUTH  
**Classification:** CONFIDENTIAL  

---

## MANDATORY REVIEW PROTOCOL

> **WARNING: READ THIS BEFORE ANY CODING SESSION**
>
> This document represents decisions made by the product architect through extensive interview sessions. Every architectural choice, interface contract, error handling path, and behavioral requirement in this document is INTENTIONAL and FINAL.
>
> **For any AI coding agent, human developer, or automated tool consuming this specification:**
>
> 1. Do NOT simplify, skip, or defer any requirement marked as LOCKED. Every LOCKED requirement ships in the first implementation. There is no "we'll add that later."
> 2. Do NOT make architectural decisions not covered by this spec. If you encounter a decision point not addressed here, STOP and flag it. Do not improvise. Do not choose the "simpler" option. Do not optimize for speed of implementation.
> 3. Implement error handling for every external call, every state transition, and every user-facing interaction. "Happy path only" is NOT acceptable.
> 4. Write tests for every public interface, every state transition, and every error path. Test coverage is not optional.
> 5. Use as many compute cycles, tokens, and iterations as necessary to produce production-quality code. Speed of implementation is NOT a success metric. Correctness, robustness, and adherence to this specification are the ONLY success metrics.
> 6. This codebase will serve 1,000+ tenants whose businesses depend on it. Code accordingly. Every shortcut is a future outage. Every skipped error handler is a future support ticket. Every unwritten test is a future regression.
>
> **Review Schedule:**
> - START of every coding session: Read this document in full.
> - MIDPOINT of any session exceeding 30 minutes: Re-read the relevant Block.
> - END of every session: Validate all work against this document before committing code.
> - If any implementation deviates from this spec, STOP and flag it. Do not commit deviating code.

---

# BLOCK 1: TENANT & IDENTITY MODEL

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

- Each tenant gets their own **SQLite database** (complete data isolation).
- One shared **platform database (PostgreSQL)** for: billing, tenant registry, flavor catalog, skills catalog, API key metadata, provisioning state, admin operations.
- **Hard isolation:** tenants NEVER see each other's data under any circumstances.
- Shared content (best practices, workflow templates) lives in a separate global catalog, opt-in only.

## 1.5 Scaling Architecture

- **Launch infrastructure:** Docker Compose on cloud VPS.
- Each tenant = one Docker container running TenantRuntime.
- TenantOrchestrator manages container lifecycle via Docker API.
- **At 500 tenants:** Migrate orchestrator to Kubernetes. Same container images. Same TenantRuntime code. Only the orchestrator changes.
- **Scale targets:** Launch = 100 tenants. Year 1 = 1,000. Aspirational = 10,000.
- **No alternatives to this infrastructure path. This is FINAL.**

### TenantRuntime / TenantOrchestrator Boundary

**TenantRuntime** is a self-contained TypeScript class with a clean interface: config in, start/stop/health methods out. Knows NOTHING about how it is hosted. Never references Docker, Kubernetes, or any hosting layer.

**TenantOrchestrator** manages lifecycle: spin up, health check, shutdown, restart. At launch, the orchestrator spawns processes/containers. At scale, it talks to Kubernetes. The orchestrator changes as infrastructure scales. The runtime NEVER changes for hosting reasons.

> **WARNING:** This boundary MUST have its own architecture document with a TypeScript interface contract. This is the decision that has killed this project before. The interface contract is non-negotiable.

## 1.6 Update Safety — The Ironclad Pipeline

### Five Safeguards

1. **Immutable container images:** Every TenantRuntime version = a frozen Docker image tagged with a version number. Old tenants run old images until explicitly updated. An OpenClaw upstream update creates a NEW image. It NEVER modifies an old one.

2. **Dependency vendoring:** ALL dependencies (OpenClaw, Pi SDK, channel libraries) are copied into the project at build time. No npm installs at runtime. No "latest" references. Exact bytes baked into each image.

3. **Version pinning:** Tiger Claw pins to a specific, tested OpenClaw version. Not "latest." Not "compatible range." A specific commit hash.

4. **Blue-green deployment:** New containers spin up alongside old ones. Traffic shifts to new. If healthy for 60 minutes, kill old. If unhealthy, automatic rollback. Zero downtime.

5. **Automated health checks with circuit breaker:** Every container reports health every 30 seconds. 3 consecutive failures after an update = automatic rollback to previous image + admin alert to Telegram. No human intervention required for rollback.

### Update Rollout Pipeline

1. **Staging environment** with synthetic tenants. Automated test suite runs.
2. If staging passes → **Canary group** (5 designated tenants) for 24 hours.
3. If canary healthy → Rolling deployment: **10% → 25% → 50% → 100%** with 6-hour soak between each stage.
4. Health check failure at ANY stage = automatic rollback for affected containers.
5. Old images retained 30 days for emergency rollback.

> **WARNING:** An update to OpenClaw MUST NEVER touch a running tenant without explicit admin approval. This pipeline gets its own specification document.

## 1.7 Four-Layer Key Management

### Layer 1 — Platform Onboarding Key (yours, disposable)
- Auto-provisioned at signup.
- Cheapest model available (Haiku, GPT-4o-mini).
- Rate-limited: **50 messages total.**
- Expires after **72 hours** OR when tenant installs their primary key, whichever comes first.
- Purpose: zero-friction first experience. They see the product work before spending a dime on API costs.

### Layer 2 — Tenant Primary Key (theirs, smart brain)
- Tenant provides during or immediately after onboarding.
- Their chosen provider and model (Claude, GPT-4o, etc.).
- No rate limit from Tiger Claw (provider's own limits apply).
- Powers the daily flywheel.

### Layer 3 — Tenant Fallback Key (theirs, cheap brain)
- **REQUIRED to complete onboarding. CANNOT be skipped.**
- Onboarding flow provides direct links to cheapest providers and step-by-step walkthrough.
- If Layer 2 dies → automatic rotation to Layer 3.
- Agent tells tenant: "Your primary key is out of gas. Here's what happened. Here's how to fix it. I'm running on your backup key and I'm limited."
- Rate limit: **20 messages per day.**

### Layer 4 — Platform Emergency Keep-Alive (yours, last resort)
- Activates ONLY when both Layer 2 and Layer 3 are dead.
- Ultra-restricted: **5 messages maximum.**
- Enough to say: "Both your keys are dead. Fix this or your bot goes to Paused in 24 hours."
- After 24 hours with no key restoration → auto-transition to Paused state.
- Protects platform from cost exposure.

### Onboarding Key Sequence

1. Interview 1: Who are you? → Complete
2. Interview 2: Who's your ICP? → Complete
3. Key setup step 1: Enter primary API key → Complete
4. Key setup step 2: Enter fallback API key → **CANNOT PROCEED WITHOUT THIS**
5. Name your bot → Complete
6. Onboarding finished, flywheel starts

Platform Onboarding Key (Layer 1) is active during the entire onboarding process.

## 1.8 Skills System

**Skills are NOT Flavors. This distinction is critical and must never be conflated.**

- **Skills** = tools/capabilities. They come from OpenClaw's skill system or Claude skills. They DO things: fetch weather, search LinkedIn, send a message, run code.
- **Flavors** = vertical business configurations. They define onboarding questions, discovery sources, nurture sequences, persuasion triggers, and aftercare tiers. A flavor is a STRATEGY, not a capability.
- A tenant's agent uses many skills. A tenant's agent runs ONE flavor.

### Skill Safety Classification (enforced at runtime, cannot be bypassed)

- **Safe:** No side effects, no external calls, no data access beyond conversation.
- **Elevated:** External API calls, data access, actions affecting tenant state. Requires flavor-level approval.
- **Restricted:** System-level access, code execution, file system, browser automation. Requires explicit admin unlock per tenant.

Every skill MUST have a safety classification in its manifest. A skill without classification CANNOT load. Every flavor defines a skill allowlist. Only allowlisted skills load. There is no "load all skills" option.

### Skill Admission Pipeline — 6 Stages

**Candidate → Reviewed → Tested → Mapped → Live → Quarantined**

1. **Discovery:** New skill identified (manual, admin gap detection, or agent monitoring). Status: Candidate.
2. **Safety Review:** Analyzed against checklist. Safety classification assigned. Status: Reviewed.
3. **Sandbox Testing:** Loaded in staging tenant. Automated tests: loads without errors, handles bad inputs, respects rate limits, stays within declared classification. Status: Tested.
4. **Flavor Mapping:** Assigned to one or more flavor allowlists. Unmapped skills sit in catalog but cannot be loaded by any tenant. Status: Mapped.
5. **Production Release:** Added to live catalog with documentation. Status: Live.
6. **Ongoing Monitoring:** Error rate >5% = automatic disable across all tenants + admin Telegram alert. Status: Quarantined.

No stage can be skipped. Each transition is logged. Evolution: Phase 1 = manual review. Phase 2 (50+ tenants) = admin agent automates Stages 1-3. Phase 3 (500+ tenants) = admin agent handles 1-5 for safe-classified skills; human reviews elevated/restricted only.

## 1.9 Three-Layer Memory Architecture

Prevents context pollution. The bot does NOT get gradually stupider over time.

### Layer 1: Working Memory (the desk)
Current conversation context only. Contains: system prompt, flavor config, tenant identity, current prospect's lead profile, last few exchanges. **Nothing else.**

**Hard rule:** Working memory is cleaned after every conversation ends. The desk starts clean for the next interaction.

### Layer 2: Structured Memory (the filing cabinet)
Important facts stored permanently as structured data — NOT conversation transcripts.

Per tenant: Identity, ICP, active leads with scores, nurture positions, conversion outcomes, preferences, customizations.

Per lead: Profile data, score history, interaction summaries (not transcripts), current flywheel stage, objections raised, content responded to.

Stored in the tenant's SQLite database. NOT in the context window. Agent queries it on demand.

### Layer 3: Long-Term Learning (the archive)
Aggregate patterns and insights, not individual conversations.

Examples: "Prospects mentioning job dissatisfaction convert at 3x rate." "Reciprocity touch on day 3 gets highest reply rate for this flavor." "LinkedIn leads score 20% higher than Facebook for this tenant."

Feeds scoring model optimization and flavor improvement.

### Context Window Management — Hard Rules

- **Fixed token budget per interaction.** System prompt, flavor config, relevant lead data get FIRST priority. Conversation gets the remainder.
- **Mandatory compaction at 80%:** When context hits 80% of budget, automatic compaction fires. Bot summarizes oldest portion, extracts facts to structured memory, frees space. Invisible to user.
- **Session isolation:** Conversation with Prospect A NEVER bleeds into conversation with Prospect B.
- **Monthly structured memory cleanup:** Stale data reviewed. Leads purged after 90 days no activity.

## 1.10 Admin & Operations

- Super-tenant with full visibility across all tenants.
- Admin alerts to dedicated Telegram channel.
- Automated daily backups of all tenant databases + platform database, stored offsite (S3 or Backblaze).
- Tested restore procedure documented in operational runbook.
- Platform-level rate limiting per tenant to prevent one bad tenant degrading the system.
- Bot naming during onboarding interview — tenant names their bot.
- Bot identity is "TigerClaw-powered" but carries tenant's chosen name in all interactions.

## 1.11 Development Environment

- Dev environment = Docker container **identical** to production container.
- All dependencies vendored. No runtime installs.
- If it runs in dev, it runs in prod. Period.
- The container IS the environment. The host system does not matter.

## 1.12 Backup & Disaster Recovery

- Automated daily backups of ALL tenant databases + platform database.
- Stored offsite.
- Tested restore procedure — not "figure it out later."
- In the spec as a launch requirement, not a post-launch item.

---

## Block 1 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | One tenant, one agent, one primary flavor | LOCKED |
| 2 | Sub-agent limit 6-7 per OpenClaw default | LOCKED |
| 3 | Tenant data ownership (interviews, keys, leads, sequences, transcripts, contacts) | LOCKED |
| 4 | Lifecycle: Pending → Onboarding → Active → Paused → Suspended → Terminated | LOCKED |
| 5 | Paused = freeze in place, export available before Termination | LOCKED |
| 6 | Per-tenant SQLite + shared platform PostgreSQL | LOCKED |
| 7 | Hard tenant isolation, no cross-tenant data visibility | LOCKED |
| 8 | Docker Compose at launch, Kubernetes at 500 tenants | LOCKED |
| 9 | TenantRuntime / TenantOrchestrator as separate modules with TypeScript interface contract | LOCKED |
| 10 | Immutable container images, dependency vendoring, version pinning | LOCKED |
| 11 | Blue-green deployment with automatic rollback and circuit breaker | LOCKED |
| 12 | 5-stage canary rollout pipeline (staging → canary → 10% → 25% → 50% → 100%) | LOCKED |
| 13 | Health monitoring every 30 seconds, 3 failures = auto-rollback | LOCKED |
| 14 | Four-layer key management (Onboarding → Primary → Fallback → Emergency) | LOCKED |
| 15 | Fallback key REQUIRED to complete onboarding — no skip | LOCKED |
| 16 | Skill safety classification (safe/elevated/restricted) enforced at runtime | LOCKED |
| 17 | Flavor defines skill allowlist; restricted needs admin unlock per tenant | LOCKED |
| 18 | 6-stage Skill Admission Pipeline | LOCKED |
| 19 | Three-layer memory architecture (Working / Structured / Long-Term) | LOCKED |
| 20 | Working memory cleaned after every conversation | LOCKED |
| 21 | Session isolation — no cross-prospect context bleeding | LOCKED |
| 22 | Fixed context budget with priority allocation and auto-compaction at 80% | LOCKED |
| 23 | Monthly structured memory cleanup, 90-day stale data purge | LOCKED |
| 24 | Admin super-tenant with full visibility and Telegram alerts | LOCKED |
| 25 | Automated daily backups, offsite storage, tested restore | LOCKED |
| 26 | 30-day data retention post-termination then full purge | LOCKED |
| 27 | Platform-level rate limiting per tenant | LOCKED |
| 28 | Bot naming during onboarding | LOCKED |
| 29 | Dev environment = Docker container identical to production | LOCKED |
| 30 | Build Quality Mandate embedded in all spec documents | LOCKED |
| 31 | Mandatory Review Protocol in every spec file | LOCKED |

---

# BLOCK 2: FLAVORS

## 2.1 Product Model

**One product: Tiger Claw.** Tiger Claw is the base agent (all OpenClaw core capabilities) PLUS the hunting flywheel. Every tenant gets both. The base capabilities make it a powerful daily assistant. The flywheel makes it a lead generation engine. Both are always on. There is no "Alien Claw" as a separate product.

## 2.2 What a Flavor IS

A Flavor is exactly three things:

1. **System prompt fine-tuning:** Industry context, tone, goals, what success looks like for this profession.
2. **A curated set of default skills:** Pre-loaded, invisible to the tenant. 2-3 skills maximum. The tenant never thinks about "skills." They just work.
3. **Tailored onboarding questions:** ICP interview and identity interview customized for this profession.

**A Flavor is NOT:** A separate product. A feature gate. A complex architecture. A large skill bundle. It is fine-tuning — like giving a frontier model a really good system prompt and the right tools.

## 2.3 Flywheel Intensity Control

Flavors control flywheel **intensity and style**, not whether the flywheel exists. Network Marketer = intensity 10 (aggressive daily prospecting). Lawyer = intensity 3 (quiet, professional, compliance-heavy). Airbnb host = intensity 5 (seasonal). Same engine, different tuning.

## 2.4 Base Flavor Inheritance

Every flavor inherits from a base configuration: aftercare tier structure, persuasion principles, key rotation behavior, error handling, core flywheel mechanics. A new flavor only defines what is DIFFERENT from the base. Keeps flavors small, consistent, maintainable.

## 2.5 Tenant Customization

**Guided customization.** Tenants can adjust tone, keywords, message templates, timing within their flavor. They CANNOT remove core behaviors (error handling, key rotation, safety classifications). Edits saved as tenant-level overrides on top of flavor defaults. Overrides persist through flavor updates.

## 2.6 Flavor Versioning

New tenants get latest flavor version. Existing tenants keep theirs unless they opt in to update. Tenant customizations are NEVER overwritten by a flavor update. If base flavor improves, tenant notified: "Your flavor has an update. Here's what changed. Apply or keep current setup." Their choice.

## 2.7 Launch Flavors

1. **Network Marketer** — flagship. Built from 35 years of sales DNA. Two-oar model (recruiting + customer).
2. **Real Estate Agent** — massive segment, straightforward discovery, clear conversion action. Single-oar.
3. **Health & Wellness / Personal Services** — hairdressers, trainers, massage therapists, aestheticians. Single-oar.

**Airbnb is 4th flavor** — built as soon as launch flavors are stable.

Flavor roadmap: Research task to identify top 50 gig economy professions ranked by market size, willingness to pay, and fit with automated prospecting. Not a launch requirement.

## 2.8 Flavor Quick-Build Kit

For rapid new flavor creation when opportunity strikes. **2-hour target.**

- **Base Flavor Prompt Template:** Fill-in-the-blanks system prompt structure.
- **Discovery Source Checklist:** Pre-mapped sources by profession category.
- **Default Skill Mapping Guide:** Pre-decided skills per category.
- **Flavor Smoke Test:** 5-minute verification script. Run before any demo. Every time. Non-negotiable.

## 2.9 Network Marketer Flavor — System Prompt Layers

### Layer 1: Macro Narrative (primary frame)

AI is displacing the middle management layer of corporate America. Millions of skilled people will find themselves without a chair when the music stops. Network marketing is the ready-made answer: no loans, no leases, no employees, infrastructure already built. AI makes it scalable for the first time. You're not competing with AI — you're leveraging it.

**This is not a job.** Nobody works for the tenant. They work for themselves. Independent contractors. Their goals are their goals. If goals align, run together. If not, find someone whose goals match. No guilt. No obligation. Strategic alignment between independent people.

### Layer 2: Product Tip-of-Sword (secondary, swappable)

Whatever the current hot product or breakthrough is. Tenant updates this in their config and the agent references it. Always secondary to the opportunity narrative. There will always be a new tip-of-sword every quarter. What doesn't change is the model.

**Agent leads with opportunity, not product, in business builder conversations.**

## 2.10 Flavors as Competitive Moat

As admin analytics accumulate data from tenants across verticals, flavors improve. Better discovery keywords, better nurture templates, better conversion triggers — all informed by real performance data. A competitor can copy code. They cannot copy 6 months of flavor optimization across 20 professions.

---

## Block 2 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | One product: Tiger Claw (no Alien Claw split) | LOCKED |
| 2 | Tiger Claw = full OpenClaw capabilities + hunting flywheel, always | LOCKED |
| 3 | Flavor = system prompt + curated default skills + tailored onboarding | LOCKED |
| 4 | Flavor controls flywheel intensity/style, not existence | LOCKED |
| 5 | Base Flavor inheritance — new flavors only define differences | LOCKED |
| 6 | Guided tenant customization (surface personalization, not core behaviors) | LOCKED |
| 7 | Flavor versioning: new tenants get latest, existing tenants opt in | LOCKED |
| 8 | Tenant customizations persist through flavor updates | LOCKED |
| 9 | 3 launch flavors: Network Marketer, Real Estate, Health & Wellness | LOCKED |
| 10 | Flavor Quick-Build Kit for rapid creation (2-hour target) | LOCKED |
| 11 | Flavors as competitive moat improved by admin analytics | LOCKED |
| 12 | Macro narrative + tip-of-sword layered system prompt | LOCKED |
| 13 | Agent leads with opportunity, not product | LOCKED |
| 14 | "Their business, not mine" independence framing | LOCKED |

---

# BLOCK 3: THE FLYWHEEL

Five stages: **Discovery → First Contact → Nurture → Conversion → Retention.** Built on a two-oar model for network marketing flavors, single-oar for others.

## 3.1 Two-Oar Model

### Oar 1: Business Builder (Recruiting)
People who might join the tenant's organization as distributors/partners. Signals: entrepreneurial indicators, side hustle mentions, job frustration, influence/audience, coachability, life transitions (layoff, career change, retirement boredom), MLM history.

### Oar 2: Customer (Product Sales)
End users who will buy the product/service. Signals: active need, budget signals, right geography, reachable on agent's platforms.

**Network marketing flavors run both oars simultaneously.** Non-MLM flavors run single oar (customer only). The flavor declares how many oars it has. The architecture supports both.

**Per flavor with two oars:** Two ICP definitions, two scoring models, two discovery configurations, two nurture sequences, two conversion definitions, two aftercare tracks.

The tenant experiences one bot working both oars. The complexity is invisible.

## 3.2 Lead Scoring Model — Three Dimensions

### Dimension 1: Profile Fit (0-100)
Static — who they are. Scored at discovery. Demographics match, platform presence, keyword signals in profile/bio/content, negative signals (competitor, wrong geography, bot account).

### Dimension 2: Intent Signals (0-100)
Behavioral — what they're doing NOW. Forum questions, pain point posts, competitor engagement, life event signals, search behavior. **Recency-weighted:** signal from today > signal from 30 days ago. Intent decays.

### Dimension 3: Engagement (0-100)
Zero at discovery. Builds over time. Opened message (small+), replied (strong+), asked question (very strong+), clicked link (+), requested info (near-conversion), ignored multiple touches (negative, decays), blocked/opted out (hard disqualify, score → 0, permanent exit).

### Scoring Weights

**Business Builder:** Profile Fit 30% / Intent 45% / Engagement 25%

**Customer:** Profile Fit 25% / Intent 50% / Engagement 25%

Intent-heavy for both. Before first contact, no engagement data so Intent dominates. After first contact, Engagement takes over. Score recalculates dynamically with every new signal.

### Threshold

**80. Fixed. Not configurable per tenant.** No lead reaches tenant's attention until composite score hits 80. Below 80, lead stays in discovery pool accumulating signals.

### Dual-Oar Unicorn Bonus

Lead triggering signals in BOTH oars = automatic **+15 point bonus** on higher of two scores. Prioritized above all single-oar leads. Distinct visual indicator (gold tag, "Dual Opportunity" label). If both hit threshold, prioritize business builder oar (new distributor worth more long-term).

### Below-Threshold Leads

**Visible but gated, 90-day purge.** Tenant sees "warming" list: "You have 43 prospects building toward qualification." Cannot contact them. Builds confidence bot is working. Leads that haven't hit 80 in 90 days are automatically purged.

### Score Display

**Numeric by default.** Shows actual number (Score: 83). Simplified label view available as option: Hot (80+) / Warm (60-79) / Cold (below 60).

## 3.3 The Involvement Spectrum

**No hard line between customer and business builder.** It is a gradient.

| Level | Description | Bot Behavior |
|-------|-------------|--------------|
| 0 | Prospect — not yet contacted | Discovery / First Contact |
| 1 | Engaged — responded, in nurture | Nurture sequence |
| 2 | Customer — bought product | Customer aftercare, referral requests |
| 3 | Repeat customer — multiple purchases | Deeper aftercare, wholesale suggestion |
| 4 | Referral source — giving names | Recognition, subtle opportunity messaging |
| 5 | Wholesale buyer — buying at distributor price | Side hustle content, "have you thought about..." |
| 6 | Side hustle builder — actively recruiting part-time | Training support, goal setting |
| 7 | Full-time builder — committed, building organization | Leadership development, advanced strategies |

**Transitions triggered by behavior, not manual assignment.** Bot watches for signals: second order (2→3), first referral (3→4), wholesale inquiry (4→5), distributor signup (5→6), first recruit (6→7).

**Tenant sees progression in daily briefing.** "[Name] just gave their third referral. They're showing builder signals. Want me to start the opportunity conversation?"

### Core Behavioral Principle

**Always ask for the next small action. Never ask for the big commitment until they've already taken ten small steps toward it.** This applies across ALL flavors, not just Network Marketer.

- Not involved → "Who do you know?" (one small action)
- Gave a referral → "Have you tried the product?" (next small action)
- Tried product → "Want to reorder?" (next small action)
- Reordered → "Anyone else who might love this?" (next small action)
- Gave more referrals → "Ever thought about doing this more seriously?" (next small action)

**Any involvement > no involvement.** The first thread is what matters. Once involved, the bot nurtures the thread into a rope.

## 3.4 Stage 1: Discovery

### Scan Modes
- **Scheduled baseline:** Scans run on schedule (few hours daily, flavor-configured). Keeps pipeline flowing.
- **On-demand burst:** Tenant triggers intensive scan. Rate limits prevent API abuse and platform bans.

### Source Management
- Flavor defines default sources.
- Tenant can add specific groups, communities, hashtags, forums.
- Tenant CANNOT add new platform integrations (admin/skill level change).

### Compliance Tiers
- **Tier 1 — Official APIs (safest):** Reddit API, X API, Telegram bot API. Proper auth and rate limits.
- **Tier 2 — Public Passive Monitoring (low risk, LAUNCH TIER):** Reading publicly visible posts/profiles without authentication. No scraping behind auth walls.
- **Tier 3 — Authenticated Interaction (Phase 2, high risk):** Logging into platforms, virtual personas. NOT AT LAUNCH.

### Duplicate Detection
**One lead profile per person, dual-oar tagging.** Same person showing signals in both oars = one profile with two scores. No duplicate entries.

## 3.5 Stage 2: First Contact

### Core Rules

**Agent sends first contact AUTONOMOUSLY. No human in the loop.** No approval queue. Default is full auto. Manual approval available as opt-in setting, but default is bot handles it. Friction kills flywheels.

**Agent does NOT pretend to be human.** Identifies itself as AI assistant working on behalf of tenant. Legally safer, builds trust faster.

### Agent Edification Protocol (Named Feature)

Bot transfers authority to tenant using tenant's real credentials from onboarding data. Not generic flattery — real, specific authority transfer.

Example: "I work with [tenant name], and honestly they're one of the best in this space — they asked me to connect with you personally because they thought you'd be a great fit."

Bot does what best upline partner does on a three-way call. Consistently, every time, at scale. Never forgets to edify. Never undersells tenant.

### Three First Contact Strategies

**1. Direct:** "I noticed you posted about [signal]. I work with [tenant name]..." — For high-intent, high-fit leads.

**2. Indirect ("Who Do You Know?"):** "Hey, [tenant name] asked me to reach out — they're expanding and looking for people who [description]. Would you happen to know anyone?" — For moderate-intent, high-fit leads. Built-in takeaway: "I hadn't really thought of you, I'm not sure you're the kind of person I'd want to work with, but maybe..."

**3. Referral:** "Your friend [name] thought you'd be a great fit for something we're working on with [tenant name]." — For leads entering via referral from "who do you know" conversations.

Agent selects strategy based on lead score composition. Referral-generated leads tracked with source attribution.

### Scarcity / Takeaway Energy

**Embedded in ALL outreach from first touch.** Agent's voice carries frame of abundance and selectivity. Bot qualifies prospects, does not sell to them. Prospect should feel evaluated, not pitched.

### Timing

Intelligent delay, not immediate. Randomized 1-4 hour delay within reasonable hours for prospect's timezone. Prevents looking automated.

### Response Handling — Never Chase

**Core product principle: Never chase. Maximum one follow-up.**

- **Positive response:** → Move to Nurture, engagement score starts climbing.
- **Neutral response:** → One follow-up within 48 hours. If still neutral, scheduled re-attempt in 2 weeks.
- **Negative response:** → Lead marked as opted out. **PERMANENTLY.** No re-contact ever.
- **No response:** → One follow-up in 72 hours. If still no response, score penalty, back to pool. Can re-enter if new signals appear later.

## 3.6 Stage 3: Nurture

### Definition

Timed sequence of touches designed to build trust, establish authority, move prospect from "interested" to "ready." Each touch uses one of the persuasion principles.

### Sequence Structure

**30-day nurture sequence. 7-8 touches. 3-5 day default cadence.** Flavor defines exact spacing and content.

**Adaptive acceleration:** Positive response → next touch within hours. Hot engagement = immediate response. Cool engagement = standard schedule. No response to 2 consecutive touches → exit logic triggers.

### Touch Types (varied, not repetitive)

- **Value drop:** Something useful with no ask (Reciprocity)
- **Testimonial:** Someone like them who succeeded (Social Proof)
- **Authority transfer:** Tenant's credibility and results (Authority)
- **Personal check-in:** "How's your week going?" (Liking)
- **The 1-10 question:** Qualification pivot, around Touch 5-6
- **Scarcity/takeaway:** Built into tone throughout, escalates later

### The 1-10 Framework (Two-Part Question Sequence)

**Part 1:** "On a scale of 1-10, where are you?" — Sorts instantly. A number.

**Part 2:** "What would you need to know to be a 10?" — Only fires for 6-7 responses. Prospect self-diagnoses their objection.

### Objection Category Map (per flavor)

Network Marketer flavor buckets:

| Objection | Content Response |
|-----------|-----------------|
| Compensation | Comp plan breakdown, income testimonials, realistic earnings |
| Product | Product testimonials, before/after, clinical data |
| Time | Part-time success stories, time commitment breakdown |
| Reputation | Company credibility, third-party recognition, pyramid comparison |
| Trust | Edification of tenant: "You'd be working directly with [tenant] who has [credentials]" |
| Spouse/Family | Family-friendly overview, offer conversation spouse can join |
| Cost | Startup cost breakdown, ROI framing, comparison to other business startups |

Each flavor defines own buckets with pre-built content. Agent matches Part 2 answer → bucket → delivers response → re-asks Part 1.

**Maximum 2 rounds of gap-closing.** If still 6-7 after two rounds → takeaway energy. Score moves DOWN → immediate takeaway, no further pursuit.

### Pattern Interrupt Stories (Named Feature)

Short, memorable stories breaking prospect out of autopilot thinking. Deployed strategically at stall points.

**Flagship — The Airplane Question (Network Marketer flavor):** "Would you jump out of an airplane without a parachute for a million dollars?" Everyone says no. Reveal: airplane is on the ground. Lesson: Don't say no before you have all the information.

Used in: nurture stall points and pre-takeaway as final move before letting go.

Each flavor has its own library. Deployed at specific moments when engagement is stalling and a reset is needed — not randomly.

### Nurture Exit Conditions

- **8-10 on scale:** → Success, move to Conversion
- **6-7 after 2 rounds gap-closing:** → Takeaway, move to slow drip
- **5 or below:** → Immediate takeaway
- **No response to 2 consecutive touches:** → Exit nurture, score penalty, back to pool
- **Explicit opt-out:** → Permanent exit, no re-contact ever
- **30-day sequence completes without conversion:** → One final takeaway touch, move to slow drip

**Slow drip:** 1 touch per month, value-only, no ask. Re-engagement → re-enter nurture. No response for 3 months → archived.

### Manual Lead Import (Warm Contacts)

Tenant tells bot about existing contacts: "Add John Smith, 555-1234, met him at Phoenix networking event, real estate investor, seemed interested."

Bot creates lead profile with modified scoring: Profile Fit from description, Intent from tenant's assessment ("seemed interested" = 60, "wants to get started" = 90), Engagement = 0 until contact.

**Tenant sets entry point:** Discovery pool (watch, don't contact), First Contact (reach out), Nurture (already talked, pick up sequence), or Just Track (reminder system, tenant handles personally).

### Daily Briefing (The Digital Recipe Card File)

Every morning, bot sends summary in tenant's preferred channel:

"Good morning [tenant name]. Here's your day: 3 hot leads ready for follow-up. 1 prospect asked a question last night. 2 new leads crossed threshold overnight. [Name] is at day 15, engagement strong, recommend 1-10 question today."

Not a dashboard to log into. A message in the channel they live in.

## 3.7 Stage 4: Conversion

### What Conversion Means (flavor-defined)

- **Network Marketer — Business builder oar:** They sign up as a distributor.
- **Network Marketer — Customer oar:** They place their first order.
- **Real Estate:** They book a showing or sign a listing agreement.
- **Health & Wellness:** They book an appointment or purchase a service.

### Business Builder Conversion: The Three-Way Handoff

**Mirrors the three-way call framework.** Bot has been building rapport. Now it connects the tenant.

1. Bot determines prospect is at 8+ on the scale.
2. **Bot messages tenant:** "[Prospect name] is ready. Score: 87. They're excited about [specific thing]. Their concern was [gap from Part 2] and I addressed it with [what was sent]. They're expecting to hear from you."
3. **Bot messages prospect (edification):** "I've really enjoyed our conversation. I'd like to introduce you to [tenant name]. [Edification — credentials, story, why they're special]. They've agreed to personally spend some time with you because honestly, I think you're exactly the kind of person they want to work with."
4. **Bot connects them:** Introduces in channel, provides tenant's contact info, or schedules the call per tenant preference.
5. **Bot steps back.** Tenant owns the relationship from here.

The bot just did what the best upline partner does — warmed the prospect, qualified them, addressed objections, built to readiness, and handed to the closer with full edification and a complete briefing. Most prepared three-way call in history.

### Customer Conversion: Bot Closes Autonomously

Product sale doesn't require personal touch. Bot walks customer through order, answers last questions, gets the sale done. Tenant notified after the fact. Moves to Aftercare.

### Growth Model Note (Roadmap, Not Launch)

Every business builder who converts is a potential Tiger Claw customer. Tenant's organization grows AND Tiger Claw's tenant count grows simultaneously. Flagged as the single most powerful growth lever. Not a launch feature — noted in roadmap.

## 3.8 Stage 5: Retention & Aftercare

### Track A: Business Builder Aftercare

New recruit joined the team. Bot becomes their support system:

- **Day 1-7:** Welcome sequence. First steps. Product basics.
- **Day 8-30:** Skill building. First conversations. "Who do you know." 3-per-day rule.
- **Day 31-90:** Momentum. Activity tracking. Win celebrations. Struggle addressing.
- **Ongoing:** 30/60/90 day check-ins. Flag inactive recruits. Recognize high performers.

Bot handles the 80% of support that doesn't need tenant's personal time. Flags the 20% that does.

### Track B: Customer Aftercare

**Auto-assigned tiers based on customer behavior.** Tenant can override.

- **Bronze:** Welcome sequence, 7-day check-in, monthly satisfaction survey, basic referral link.
- **Silver:** Everything in Bronze + full referral campaign (7 touches), referral leaderboard, upsell sequence, usage reports.
- **Gold:** Everything in Silver + full upsell sequence, annual plan offers, quarterly review calls, double referral bonuses, VIP early access.

Tier transitions triggered by purchase frequency, referrals, and engagement.

### Referral Generation from Customers

"Who do you know" touch built into aftercare sequences. Names go back into Discovery pool as warm referral leads with referring customer credited.

### Customer-to-Builder Upgrade Detection

Bot watches for customers showing business builder signals: enthusiasm, multiple referrals, questions about the business side. Flags potential upgrades to tenant.

"[Customer name] just gave their third referral this month. They're showing builder signals. Want me to start the opportunity conversation?"

Tenant controls: yes, no, or "I'll handle this one personally."

### Organization Nurture (Internal Team Communication)

- **CSV import** for existing organization contacts (e.g., Nu Skin monthly printout).
- Each person gets a contact record with involvement level tracking.
- Bot sends **individual** nurture messages — NOT bulk email.
- Channels: Telegram, WhatsApp, SMS — whatever Tiger Claw already controls.
- Training Bot and Communications Agent functionality built into Tiger Claw base.

---

## Block 3 Decision Checksum

| # | Decision | Status |
|---|----------|--------|
| 1 | Two oars for NM flavors (recruiting + customer), one oar for others | LOCKED |
| 2 | Three scoring dimensions: Profile Fit, Intent, Engagement | LOCKED |
| 3 | Business Builder weights: 30/45/25. Customer weights: 25/50/25 | LOCKED |
| 4 | Hard threshold: 80, platform-fixed | LOCKED |
| 5 | Dual-oar unicorn +15 bonus, prioritized above single-oar | LOCKED |
| 6 | Below-threshold: visible but gated, 90-day purge | LOCKED |
| 7 | Score display: numeric default, label view optional | LOCKED |
| 8 | Involvement spectrum: 8 levels (0-7), behavior-triggered transitions | LOCKED |
| 9 | "Next small action" principle across all flavors | LOCKED |
| 10 | Any involvement > no involvement | LOCKED |
| 11 | Scheduled baseline scans + on-demand burst with rate limits | LOCKED |
| 12 | Passive discovery only at launch (Tier 1 + Tier 2) | LOCKED |
| 13 | One lead profile per person, dual-oar tagging | LOCKED |
| 14 | Full auto first contact (no approval queue by default) | LOCKED |
| 15 | Agent identifies as AI, does not pretend to be human | LOCKED |
| 16 | Agent Edification Protocol — named feature | LOCKED |
| 17 | Three first contact strategies: Direct, Indirect, Referral | LOCKED |
| 18 | Scarcity/takeaway energy from first touch | LOCKED |
| 19 | Intelligent timing delay (1-4 hours, timezone-aware) | LOCKED |
| 20 | Never chase — max one follow-up | LOCKED |
| 21 | Negative response = permanent opt-out | LOCKED |
| 22 | 30-day nurture, 7-8 touches, 3-5 day cadence | LOCKED |
| 23 | Adaptive acceleration on positive engagement | LOCKED |
| 24 | Varied touch types (value, testimonial, authority, check-in, 1-10) | LOCKED |
| 25 | 1-10 framework as two-part question at Touch 5-6 | LOCKED |
| 26 | Objection category map per flavor with pre-built content | LOCKED |
| 27 | Max 2 rounds gap-closing then takeaway | LOCKED |
| 28 | Pattern Interrupt Stories — named feature | LOCKED |
| 29 | Airplane question flagship for NM flavor | LOCKED |
| 30 | Slow drip: 1/month, 3 months max, then archive | LOCKED |
| 31 | Manual lead import with warm contact scoring | LOCKED |
| 32 | "Just track" option for personal contacts | LOCKED |
| 33 | Daily briefing in preferred channel, not dashboard | LOCKED |
| 34 | Business builder conversion = three-way handoff with edification | LOCKED |
| 35 | Full prospect briefing to tenant (score, journey, objections) | LOCKED |
| 36 | Bot steps back after introduction — tenant owns relationship | LOCKED |
| 37 | Customer conversion = bot closes autonomously | LOCKED |
| 38 | New recruit → Tiger Claw customer pipeline in roadmap | LOCKED |
| 39 | Aftercare tiers auto-assigned by behavior, tenant can override | LOCKED |
| 40 | "Who do you know" built into aftercare, referrals feed discovery | LOCKED |
| 41 | Customer-to-builder upgrade detection | LOCKED |
| 42 | CSV import for existing organization contacts | LOCKED |
| 43 | Org contacts get involvement level tracking | LOCKED |
| 44 | Bot sends individual nurture, NOT bulk email | LOCKED |
| 45 | Training Bot + Communications Agent built into base | LOCKED |
| 46 | Macro narrative (AI displacement + opportunity timing) as primary frame | LOCKED |
| 47 | Product tip-of-sword is secondary and tenant-swappable | LOCKED |
| 48 | "Their business, not mine" independence framing | LOCKED |

---

# SALES DNA CATALOG

Extracted from three books: "5 Agents," "AI Prospecting Playbook," and "Endless Referrals." This catalog is encoded into the Network Marketer flavor as structured data and serves as the template for building future flavor-specific sales DNA.

## Frameworks (Core Conversation Logic)

| # | Framework | Source | Flywheel Stage |
|---|-----------|--------|----------------|
| 1 | The 1-10 Scale (two-part: score + gap question) | Interview + Endless Referrals | Nurture → Conversion |
| 2 | "Who Do You Know?" (indirect prospecting) | Endless Referrals | First Contact |
| 3 | The Takeaway Close | Endless Referrals | First Contact, Nurture, Conversion |
| 4 | The Airplane Question (pattern interrupt) | Interview | Nurture stall, pre-takeaway |
| 5 | The Roommate Principle ("never about the girl") | Endless Referrals | First Contact — sell THROUGH people |
| 6 | The 3-Step System (get name, call immediately) | Endless Referrals | Referral chain — contact within hours |
| 7 | Stack 10s with 10s (10x10=100, 10x1=10) | 5 Agents | Lead scoring / qualification |
| 8 | 5-Factor Qualification (Action, Financial, Time, Coachability, Network) | 5 Agents | Business builder scoring |
| 9 | BANT 2.0 (AI-enhanced) | AI Prospecting Playbook | Profile Fit + Intent scoring |
| 10 | The Funeral Test (500 would come) | AI Prospecting Playbook | Warm contact import tiers |
| 11 | 3-Per-Day Rule | AI Prospecting Playbook | Daily briefing minimum |
| 12 | Compression Principle | AI Prospecting Playbook | System prompt coaching language |
| 13 | Build Depth Not Width | AI Prospecting Playbook | Prioritize action-takers over talkers |

## Persuasion Principles (Mapped to Nurture Touches)

| # | Principle | Application |
|---|-----------|-------------|
| 1 | Reciprocity | Touch 1 — value drop, give with no ask |
| 2 | Commitment & Consistency | Touch 2 — get a small yes |
| 3 | Social Proof | Touch 3 — testimonial from someone like them |
| 4 | Authority | Touch 4 — edification, credentials |
| 5 | Liking | Touch 5 — personal check-in |
| 6 | Scarcity | Embedded in tone throughout |
| 7 | Loss Aversion | "Moving with or without you" energy |
| 8 | Anchoring | First impression sets high-value frame |
| 9 | Decoy Effect | Comparison making primary option obvious |
| 10 | Baader-Meinhof | Multi-channel presence |

## Pattern Interrupt Stories

| # | Story | Deployment |
|---|-------|------------|
| 1 | The Airplane Question | Nurture stall, pre-takeaway |
| 2 | The Japan Expansion (500 distributors, no Japanese) | Authority building |
| 3 | Rick and the Takeaway (1998) | Teaching the takeaway |
| 4 | First Month Magic (18 sponsors in 30 days) | New distributor motivation |
| 5 | The $30K Table | Why automation matters |
| 6 | Blind Men and the Elephant | Get full picture before deciding |
| 7 | 9 Subways in 18 Months | Credibility, speed of execution |

## Objection Buckets (Network Marketer Flavor)

| Objection | Counter-Content |
|-----------|----------------|
| "Is this a pyramid?" | Snowflake vs pyramid, corporate comparison, ethical structure |
| "I don't have time" | Part-time stories, 15-min daily, AI handles grunt work |
| "I can't sell" | Not selling — recruiting. Courtship not closing |
| "My warm market is burned" | Endless referrals — "Who do you know?" creates infinite pipeline |
| "I tried MLM and failed" | 1-in-18 first month story, consistency over intensity, AI changes the game |
| "How much can I make?" | Realistic 90-day projections, not hype |
| "I need to talk to spouse" | Family overview, invite spouse to conversation |

---

# BLOCKS PENDING (To Be Completed in Next Session)

## Block 4: Key Rotation & Error Handling
- Exact error states and classification (401, 402, 403, 429, timeout, degraded)
- Fallback triggers and recovery procedures
- Notification channels for key failures
- Rate limit handling with exponential backoff

## Block 5: Provisioning & Onboarding
- 60-second pipeline from payment to live bot
- Webhook integration (Stripe / Stan Store)
- Two interview flows (identity + ICP)
- Bot naming ceremony
- Key setup sequence

## Block 6: Admin & Operations
- Super tenant dashboard specification
- Health monitoring and alerting
- Update pipeline detail
- Backup/restore procedures
- Canary deployment operational procedures

---

# DOCUMENT METADATA

**Total locked decisions:** 93 (Block 1: 31, Block 2: 14, Block 3: 48)

**Source materials:**
- 18 OpenClaw documentation files (~450KB)
- TigerClaw Interactive Product Guide (Manus deployment)
- "5 Agents" (AI Prospecting Playbook for Network Marketers)
- "AI Prospecting Playbook" (comprehensive system)
- "Endless Referrals" (Who Do You Know system)
- Multi-hour architect interview session

**Next session requirements:**
- Complete Blocks 4, 5, 6
- Generate sub-specification documents (TenantRuntime interface, Update Pipeline, Memory Architecture, Flavor Template Format)
- Review and cross-reference all decisions for consistency

---

*This document is the canonical source of truth for Tiger Claw development. Every architectural decision was made through deliberate interview with the product architect. No AI coding agent, human developer, or automated tool may override, simplify, or defer any LOCKED decision without explicit written approval from the architect.*
