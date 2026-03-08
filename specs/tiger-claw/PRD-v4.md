# Tiger Claw — Product Requirements Document v4
# Date: 2026-03-07
# Status: APPROVED — CURRENT PRODUCT DEFINITION

---

## Problem Statement

Sales and recruiting professionals spend the majority of their working hours
finding people to talk to, not talking to them. Manual prospect research is
slow, inconsistent, and requires technical skills most people don't have.

When they do find prospects, they don't know what to say, they forget to follow
up, and they lose deals to silence.

Tiger Claw eliminates all of that. The agent finds the people, scores them,
writes the messages, sends them, handles objections, nurtures the relationship,
and follows up after every sale — automatically, while the customer sleeps.

---

## Target Markets

| Market | Priority | Notes |
|--------|----------|-------|
| Network marketers (Thailand) | 1 | LINE-first, Thai language, PDPA compliance |
| Network marketers (global) | 2 | Telegram, 130 languages |
| Real estate agents | 3 | MLS-aware, Fair Housing compliance |
| Health & wellness | 4 | Supplement/coaching focus |
| Sales professionals | 5 | General B2B/B2C |
| + 6 other flavors | Future | Airbnb, baker, candle maker, doctor, lawyer, plumber |

---

## Core User Journey

### Day 0 — Signup

1. Customer lands on `thegoods.ai`
2. Clicks "Get Started" → 5-step wizard
3. **Step 1:** Picks their industry flavor (11 options)
4. **Step 2:** Name, email, language, timezone
5. **Step 3:** Enters their Google API key — validated server-side before proceeding
6. **Step 4:** Pays via Stripe ($99/mo Scout plan)
7. **Step 5:** Receives their Telegram bot username + deep link

Provisioning email arrives with activation link. Customer clicks it. Bot activates.

**From signup to live agent: under 5 minutes.**

### Day 1 — First Interaction

Customer messages their Telegram bot.

Tiger Claw runs the 5-phase `tiger_onboard` interview:
1. Who are you looking for?
2. What result do you want for them?
3. What's your main channel?
4. What objections do you usually face?
5. What does your best prospect look like?

After the interview, the agent is fully calibrated. It starts working.

### Every Day — Autonomous Operation

```
7:00 AM — Daily Briefing
  5 prospects discovered overnight
  Each with score, source, opening message, objection scripts

Ongoing — Agent works 24/7
  Scouts for buying signals
  Scores every prospect
  Sends outreach (80+ score only)
  Manages replies and objections
  Moves leads through the pipeline
  Nurtures prospects who aren't ready yet
  Follows up after every sale
```

Customer checks the dashboard to see the pipeline. That's it.

---

## Product Requirements

### Must Have (Launch Blockers)

**R1 — Autonomous Prospect Discovery**
- Agent scans configured sources 24/7 for buying signals
- Sources: LINE OpenChat (Thailand), Facebook Groups, manual import
- No human intervention required to find prospects

**R2 — Lead Scoring (threshold: 80, LOCKED)**
- Every prospect scored 0-100
- Agent only initiates outreach on 80+ scores
- Score factors: keyword matches, engagement signals, profile completeness
- Threshold is NOT configurable — 80 is hardcoded

**R3 — Personalized Outreach**
- AI generates opening message per prospect
- Non-salesy, natural language, matches platform tone
- Adapts to industry flavor and customer's stated approach

**R4 — Objection Handling**
- Pre-written responses for: time, money, trust, skepticism
- Agent selects appropriate response based on reply content
- Customer never needs to write a response from scratch

**R5 — Pipeline Management**
- Stages: New → Contacted → Qualified → Negotiating → Converted → Lost
- Agent moves prospects through stages automatically
- Customer can view and manually adjust via dashboard

**R6 — Daily Briefing via Telegram**
- Delivered at 7 AM customer's local timezone
- Contents: today's prospects with scores, scripts, objection handlers
- Customer can also query agent on demand

**R7 — Nurture Sequences**
- Prospects not yet ready get scheduled follow-up
- Cadence: day 1, day 3, day 7, day 14, day 30
- Agent handles timing automatically

**R8 — Post-Sale Aftercare**
- Follow-up sequence triggers on conversion
- Purpose: retention, referral, upsell
- Automated, no customer intervention needed

**R9 — 4-Layer Key System**
- Layer 1: Platform key, onboarding only, 72h/50 messages
- Layer 2: Customer's own Google API key (BYOK)
- Layer 3: Customer fallback key, 20 messages/day
- Layer 4: Platform emergency, 5 messages, agent never brain dead
- Key abuse: warn × 2, then auto-pause on 3rd Layer 4 event

**R10 — Telegram Channel (Default)**
- Bot auto-provisioned at signup from `bot_pool`
- Zero steps for customer
- Webhook registered automatically

**R11 — LINE Channel (Thailand Priority)**
- Guided 5-step wizard in customer dashboard
- Screenshots, 1-click copy buttons, "Ask my agent" at every step
- Credentials stored AES-256-GCM encrypted

**R12 — 130 Language Support**
- Google Gemini handles all 130 languages natively
- Language set at signup, respected throughout

**R13 — Tiger Hive**
- Every agent shares what works anonymously
- Fleet-wide pattern learning per flavor
- Continuous improvement, no retraining required
- Customer's agent gets smarter from day 1

**R14 — 11 Industry Flavors**
- Config-driven: new flavor = new JSON file, zero code changes
- Each flavor: persona, keywords, objection scripts, compliance rules, channels

**R15 — No Silent Failures**
- All errors logged, surfaced to operator dashboard
- Customer notified with clear recovery instructions
- Operator alerted on every failure event

---

### Must Have (Customer Experience)

**R16 — Web Wizard (5 steps, Stripe integrated)**
- Step 3 validates API key server-side before accepting it
- Raw key never transmitted through Stripe
- Stripe Checkout for payment (not a mock)
- Post-payment: bot username + deep link delivered immediately

**R17 — Customer Dashboard (`app.tigerclaw.io`)**
- Bot status (active/inactive, last message, health)
- Channel cards: Telegram (active), LINE (connect), WhatsApp (coming soon)
- API key status (which layer active, messages remaining)
- Pipeline view (prospects by stage)

**R18 — Provisioning Email**
- Sent on payment confirmation
- Contains: bot username, Telegram deep link, activation instructions
- Activation link: customer clicks to bring bot online

**R19 — Customer Care Email Sequence**
- Triggered on every signup
- Onboarding: Day 0, Day 1, Day 3, Day 7
- Purpose: ensure customer gets value fast, reduce churn

**R20 — Demo Trial (`POST /admin/demo`)**
- 72-hour trial bot for operator demos
- No payment required
- Layer 1 key active, auto-suspends on expiry
- Operator creates via single API call

---

### Must Have (Operations)

**R21 — Bot Pool: 1,000+ Tokens**
- Minimum 50 unassigned before deployment
- Target 1,000+ for launch
- Pipeline: SMS-MAN phone numbers → Telegram accounts → BotFather → pool
- Health check alerts when pool drops below 50

**R22 — Database Migrations**
- Versioned SQL files in `api/migrations/`
- Auto-applied at API startup
- Never modify applied migrations

**R23 — GCP Infrastructure**
- GKE: 2-10 API replicas, HPA
- Cloud SQL: PostgreSQL 15, HA, PITR
- Memorystore: Redis HA
- All secrets in GCP Secret Manager

**R24 — Admin Dashboard (`botcraftwrks.ai`)**
- Fleet overview: all tenants, health, last active
- API cost tracking per tenant
- Hive management: review, approve, feature scripts
- Agent manager: create, start, stop, view logs
- Bot pool status and health
- Demo/invite provisioning

---

### Nice to Have (Post-Launch)

- WhatsApp via Baileys
- Coach tier ($149/mo) — real-time AI coaching during conversations
- Closer tier ($199/mo) — fully autonomous close
- Skill marketplace browsing in customer dashboard
- Flavor builder UI (currently JSON files only)
- Multi-agent coordination (Agent Bulletin Board)

---

## Pricing

| Tier | Price | Includes |
|------|-------|---------|
| Scout | $99/mo | 3-5 prospects/day, scoring, scripts, objection handling, Telegram briefing, dashboard |
| Coach | Coming soon | + Real-time AI coaching during live conversations |
| Closer | Coming soon | + Fully autonomous close |

7-day free trial, no credit card required.
Cancel anytime.

---

## What Tiger Claw Is Not

- Not a user-driven tool — the agent acts, the customer watches
- Not a CRM the customer fills in manually
- Not a Chrome extension or desktop app
- Not limited to one language
- Not limited to one channel
- Not generic — every flavor is tuned for its industry

---

## Compliance Requirements

| Market | Requirement |
|--------|-------------|
| Global | No spam, include opt-out in all outreach |
| Thailand | Thai PDPA, Thai Computer Crime Act, Thai Direct Sales Act |
| USA | CAN-SPAM, no income claim language in MLM flavor |
| Real Estate | Fair Housing Act, no discriminatory targeting |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from signup to live bot | < 5 minutes |
| Prospect delivery (Scout plan) | 3-5 per day |
| Lead score accuracy | 80+ threshold converts at 3x rate vs below |
| API uptime | 99.9%+ |
| Bot pool availability | Always 50+ unassigned tokens |
| Layer 4 key events | < 5% of tenants per month |
| Customer churn (month 1) | < 15% |
