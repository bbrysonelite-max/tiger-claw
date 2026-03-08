# Tiger Claw — Website Update Spec v1
# For: MANIS (website copy update task)
# Status: APPROVED
# Date: 2026-03-07

---

## Site Map (Confirmed 2026-03-07)

| URL | Purpose | Audience |
|-----|---------|---------|
| `thegoods.ai` | Public marketing site — THIS IS WHAT MANIS UPDATES | Prospects / new customers |
| `botcraftwrks.ai` | Admin/operator dashboard — DO NOT TOUCH | Operator only |
| `app.tigerclaw.io` | Customer dashboard — to be built (GAP 9) | Paying customers |

**MANIS works on `thegoods.ai` only. `botcraftwrks.ai` is the admin site — leave it alone.**

---

## Context

The marketing site at `thegoods.ai` was written two weeks ago for an earlier
version of Tiger Claw. Tiger Claw has since been rebuilt as a fully autonomous
multi-tenant SaaS platform on Google Gemini. The site copy must be updated to
match the current product.

The dashboard at `botcraftwrks.ai/dashboard.html` already shows the correct
feature set and should be used as the product reference — not the old marketing copy.

---

## Critical Copy Corrections

### 1. WRONG: "Users copy scripts and send messages themselves"
### CORRECT: The agent sends outreach autonomously

Tiger Claw is a fully autonomous AI agent. It:
- Discovers prospects
- Scores them
- Writes personalized messages
- **Sends the outreach itself**
- Manages replies and objections
- Nurtures leads through the pipeline
- Follows up after every sale

The customer does not send messages. The agent does. The customer watches the
pipeline fill and receives a Telegram briefing every morning.

### 2. WRONG: "AI Recruiting Partner" (narrow framing)
### CORRECT: Tiger Claw works for 11 different business types

Not just recruiters. Tiger Claw serves:
- Network marketers
- Real estate agents
- Health & wellness professionals
- Airbnb hosts
- Bakers
- Candle makers
- Doctors
- Gig economy workers
- Lawyers
- Plumbers
- Sales professionals

Each gets a version of Tiger Claw tailored to their industry — different keywords,
different compliance rules, different channel priorities.

### 3. WRONG: Score threshold implied as 70+
### CORRECT: Score threshold is 80 (locked, non-negotiable)

The dashboard shows green badges at 70+. The actual system acts on 80+.
Update all copy and any dashboard badge thresholds to reflect 80.

### 4. WRONG: No mention of Tiger Hive
### CORRECT: Tiger Hive is a major differentiator — it must be on the homepage

Tiger Hive is the self-improving intelligence layer:
- Every agent learns from every interaction
- What works is shared anonymously across the entire fleet
- Every agent benefits from what every other agent learns
- Agents improve continuously — no retraining required
- The longer a customer uses Tiger Claw, the smarter their agent gets

This is not just a feature. This is the core competitive moat.

### 5. WRONG: No mention of language support
### CORRECT: Tiger Claw speaks 130 languages

Powered by Google Gemini. Full language support out of the box.
Language is set at signup. Critical for Thailand market (Thai, English).

### 6. WRONG: No mention of channels beyond Telegram
### CORRECT: Telegram is default; LINE is available for Thailand

- Telegram: auto-provisioned at signup, zero setup required
- LINE: guided wizard for Thailand customers (high priority)
- WhatsApp: coming soon

### 7. WRONG: OpenAI API key in settings
### CORRECT: Google API key (Gemini)

The AI engine is Google Gemini (gemini-2.5-flash). Not OpenAI.
Any reference to OpenAI, ChatGPT, or GPT must be removed.

---

## Features to Add to Homepage

These are real, built features that are not currently mentioned:

### Tiger Hive — Collective Intelligence
"Your agent learns from your wins AND from every other Tiger Claw agent on the
platform. Anonymously. Every day it gets smarter."

### 130 Languages
"Tiger Claw speaks your customer's language. All 130 of them."

### Skills System
"Tiger Claw agents discover and install new capabilities from the OpenClaw
ecosystem. Your agent evolves as new skills become available."

### Never Brain Dead — 4-Layer Key System
"Tiger Claw always has compute to speak. Even if your API key expires, the
agent guides you through reactivating — it never goes silent."

### LINE Channel (Thailand)
"In Thailand? Your customers live on LINE. Tiger Claw connects to LINE in
minutes with a guided setup wizard."

### 11 Industry Flavors
"Tiger Claw isn't generic. Select your industry at signup and your agent knows
the keywords, the compliance rules, the best channels, and the right approach
for your market."

---

## Pricing Update

Current site shows one tier: Scout $99/mo.

Correct pricing structure (update when finalized):
- **Scout** $99/mo — AI does the research, you receive the daily briefing
- **Coach** (coming soon) — AI coaches your conversations in real time
- **Closer** (coming soon) — Full autonomous close, AI handles the whole pipeline

The 7-day free trial with no credit card required is correct — keep this.

---

## What Does NOT Change

- Dark theme with tiger-orange (#f97316) accent — keep
- "Never Run Out of People to Talk To" tagline — keep
- "Stop Chasing. Start Hunting." — keep
- Telegram delivery at 7 AM daily briefing — keep
- Prospect scoring 0-100 — keep (correct threshold to 80)
- No credit card required / Cancel anytime — keep
- The dashboard design and layout — keep (it is the correct product vision)

---

## Missing Pages to Add

- `privacy.html` — linked in footer but does not exist (404)
- `terms.html` — linked in footer but does not exist (404)

Both must be created. Standard SaaS privacy policy and terms of service.
Jurisdiction: USA. Mention of data processing for Thailand customers (PDPA compliance).

---

## Domain

Site is currently at `thegoods.ai`.
Target domain: `tigerclaw.io` (operator decision pending).
Do not change the domain until the operator confirms — just update the copy.

The admin site is `botcraftwrks.ai` — separate repo, separate deployment, not touched here.

---

## Deliverable

Updated marketing site (`thegoods.ai`) with:
1. All copy corrections above applied
2. New feature sections added (Hive, Languages, Skills, LINE, Flavors)
3. Score threshold corrected to 80
4. AI engine reference updated from OpenAI to Google/Gemini
5. Product description updated to autonomous agent (not user-sends-messages)

Plus: `privacy.html` and `terms.html` created.

**Do not touch `botcraftwrks.ai` (admin site) — it is a separate system.**
