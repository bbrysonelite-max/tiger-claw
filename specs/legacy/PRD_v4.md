# Tiger Claw Scout — Product Requirements Document v4.0

**Status:** DRAFT — For Owner Review
**Date:** 2026-02-19
**Author:** Claude Code (for Brent Bryson review and approval)
**Preceding version:** PRD v2.0.0 (2026-02-10)

---

## OWNER REVIEW INSTRUCTIONS

Read every section. Mark anything wrong, missing, or that doesn't match your vision.
Nothing gets built until you approve this document.
Add comments with `[BRENT: ...]` anywhere you want to push back or add something.

---

## 1. PRODUCT VISION

### 1.1 The One Sentence

> Tiger Claw Scout is a personal AI sales team for network marketing professionals — it finds your prospects, writes your scripts, coaches your objections, and gets smarter every time someone wins.

### 1.2 The Shift From v1 → v4

| v1 (What Was Built) | v4 (What We're Building) |
|---|---|
| Custom Telegram-only bot | OpenClaw skill — runs on any channel |
| Finds prospect names, sends list | Finds, scores, scripts, tracks, learns |
| English only | Thai, Vietnamese, Bahasa, Spanish, English |
| Single-threaded worker | Sub-agents: Scout + Scripter + Coach + Hive |
| No memory | Persistent memory — learns from every interaction |
| Manual admin provisioning | Docker fleet — 1 command deploys a customer |
| Custom infrastructure | OpenClaw handles all channel plumbing |

### 1.3 Foundation: OpenClaw

Tiger Claw Scout is built **on top of OpenClaw** — an open-source, MIT-licensed personal AI assistant platform with 212,000+ GitHub stars.

OpenClaw gives us for free:
- 20+ messaging channels (LINE, WhatsApp, Telegram, Signal, Discord, Slack, iMessage, and more)
- Native cron scheduling (7 AM daily reports — one line of config)
- Persistent memory across all conversations and sessions
- Browser automation for web scraping
- Sub-agent orchestration
- Model failover (Claude primary, GPT-4 backup)
- Docker deployment — one container per customer

Tiger Claw Scout is the **skill** that sits on top and adds:
- Prospect hunting across social platforms
- Multi-language script generation
- Hive Learning (cross-tenant shared intelligence)
- Pipeline tracking and analytics
- Network marketing coaching

### 1.4 What We Publish

Tiger Claw Scout will be published to **ClawHub** — the npm of AI agent skills — where 5,000+ skills are already listed. This gives the product organic distribution and discovery.

---

## 2. TARGET CUSTOMER

### 2.1 Primary Market

Network marketing distributors in Southeast Asia:
- Nu Skin distributors (Thailand, Vietnam, Indonesia, Malaysia)
- Direct sales professionals
- MLM team builders

### 2.2 Secondary Market

- Network marketing distributors in Latin America (Spanish)
- English-speaking MLM professionals globally

### 2.3 Customer Profile

- Already use Telegram, LINE, or WhatsApp daily — no new app to learn
- Spend 2-4 hours/day manually finding and messaging prospects
- Struggle with cold outreach — low response rates, don't know what to say
- Want to build a team, not just sell product
- Non-technical — must be setup-free after provisioning

---

## 3. BUSINESS MODEL

| Item | Detail |
|---|---|
| Price | $99/month per customer |
| Checkout | Stan Store → Stripe |
| Delivery | Provisioned OpenClaw instance (Docker) |
| Channels | Customer connects their own LINE/WhatsApp/Telegram |
| Scale target | 100 customers = $9,900 MRR |
| ClawHub listing | Free organic distribution |

---

## 4. ARCHITECTURE

### 4.1 High-Level

```
CUSTOMER
  └─ Their preferred channel (LINE, WhatsApp, Telegram, etc.)
       └─ OpenClaw Gateway (their dedicated Docker container)
            └─ Tiger Claw Scout skill
                 ├─ Scout Agent    — finds prospects
                 ├─ Scripter Agent — generates scripts
                 ├─ Coach Agent    — handles objections
                 └─ Hive Agent     — learns and improves

ADMIN (Brent)
  └─ Fleet dashboard
       └─ 1 command provisions a new customer container
       └─ Monitor all containers health / daily report status
```

### 4.2 Per-Customer Stack

Each customer gets one Docker container running:
- OpenClaw Gateway (their control plane)
- Tiger Claw Scout skill (pre-installed)
- Their channel credentials (LINE/WhatsApp/Telegram session)
- Their data (prospects, scripts, Hive patterns) — isolated per customer

### 4.3 Sub-Agent Architecture

Tiger Claw Scout is not one monolithic agent. It is four coordinated sub-agents:

| Agent | Role | Runs When |
|---|---|---|
| **Scout** | Finds prospects across platforms | Daily cron + on-demand |
| **Scripter** | Generates personalized scripts | Customer requests /script |
| **Coach** | Handles objections, advises strategy | Customer asks for help |
| **Hive** | Extracts winning patterns, improves future scripts | On converted feedback |

### 4.4 Channels Supported

At launch:
- **Telegram** — primary delivery channel (all markets)
- **LINE** — critical for Thai market
- **WhatsApp** — Vietnam, Indonesia, Malaysia, Latin America

Roadmap (v4.1):
- Signal, Discord, Slack

### 4.5 Languages

| Code | Language | Market |
|---|---|---|
| `th` | Thai | Thailand (primary) |
| `vi` | Vietnamese | Vietnam |
| `id` | Bahasa Indonesia | Indonesia |
| `ms` | Bahasa Melayu | Malaysia |
| `es` | Spanish | Latin America |
| `en` | English | International / fallback |

Language is detected automatically per-prospect from source platform and post content. Scripts are generated in the detected language. Bot responses to customers are in the customer's `preferredLanguage`.

---

## 5. FEATURES — FULL SPECIFICATION

### 5.1 FEATURE: Onboarding Interview

**What it does:** When a customer first connects their channel, the Scout interviews them to build their Ideal Customer Profile (ICP). All responses stored in persistent memory.

**Conversation flow (in customer's preferredLanguage):**

```
Tiger Claw: สวัสดีครับ! ผมคือ Tiger Claw Scout ผู้ช่วยด้านการหาลูกทีมของคุณ
            [Welcome message in their language]

Phase 1 — About You:
  • What's your name?
  • What product/opportunity do you represent?
  • How long have you been in network marketing?
  • What's your monthly income goal?

Phase 2 — Your Ideal Customer:
  • Describe your best customer. Who are they?
  • What problem are they trying to solve? (income, health, freedom, time)
  • What are they doing right now that isn't working?
  • Where do they spend time online? (Facebook groups, LINE OpenChat, Reddit)
  • Any types of people to avoid?

Phase 3 — Confirmation:
  • Summarize ICP back to customer
  • "Does this sound right?"
  • Adjust based on feedback
  • Begin first scout hunt immediately
```

**Acceptance criteria:**
- [ ] Entire interview in customer's preferredLanguage
- [ ] AI extracts structured ICP data from natural conversation (not rigid Q&A)
- [ ] ICP stored in OpenClaw memory — survives restarts, accessible to all sub-agents
- [ ] First hunt triggered within 60 seconds of interview completion
- [ ] Customer can update ICP anytime with `/settings`

---

### 5.2 FEATURE: Scout (Prospect Discovery)

**What it does:** Searches public platforms daily for people matching the customer's ICP. Scores each match 0-100. Only delivers 70+ scores.

**Sources:**

| Platform | Method | Markets |
|---|---|---|
| Reddit | Public API (`search.json`) | All |
| LinkedIn | Google site:linkedin.com/in search | All |
| Google | Serper.dev API (3-key rotation) | All |
| LINE OpenChat | Public group scraping | Thailand, Vietnam |
| Facebook Groups | Public group post scraping | All |
| Instagram | Public hashtag search | All |
| TikTok | Public hashtag/caption search | SEA markets |

**Scoring factors (0-100):**
- Signal strength (explicit "I want more income" = high; vague interest = low)
- ICP match (age, location, job, interests vs customer's ICP)
- Platform trust (LinkedIn profile = higher trust than anonymous post)
- Recency (post from today scores higher than post from 6 months ago)
- Engagement (liked by many = validated signal)

**Daily schedule:**
- Runs at **5:00 AM Bangkok time** (before 7 AM report delivery)
- Deduplication: prospect not re-served if delivered in last 30 days
- Language detection on each prospect before saving
- Minimum 5 prospects per customer per day target

**Acceptance criteria:**
- [ ] Cron runs daily at 5 AM Bangkok time
- [ ] Minimum 5 new prospects scored 70+ per customer per day
- [ ] Each prospect tagged with: source, sourceUrl, language, signals[], score, summary
- [ ] Deduplication window: 30 days
- [ ] Language auto-detected from post content and platform

---

### 5.3 FEATURE: Daily Report (7 AM Push)

**What it does:** Every morning at 7 AM (customer's timezone), delivers the top 5 prospects found overnight. Report written in customer's preferredLanguage.

**Report format (Thai example):**

```
🐯 Tiger Claw รายงานประจำวัน
19 กุมภาพันธ์ 2569

พบ 5 ผู้มุ่งหวังที่มีคุณสมบัติวันนี้:

━━━━━━━━━━━━━━━━━━━━━

1. สมชาย ก. (คะแนน: 87/100) 🔥
📍 LINE OpenChat: "หารายได้เสริม 2569"
💬 สัญญาณ: "อยากมีรายได้เพิ่ม ทำที่บ้านได้"
📝 /script สมชาย

━━━━━━━━━━━━━━━━━━━━━

[4 more prospects...]

📊 Pipeline: รวม 47 | ติดต่อแล้ว 12 | แปลงแล้ว 3
📈 สัปดาห์นี้: 2 คนสนใจ

💡 เคล็ดลับวันนี้: ผู้มุ่งหวังที่โพสต์เรื่องค่าใช้จ่ายมักตอบสนองได้ดีต่อ "อิสรภาพทางการเงิน"
```

**Acceptance criteria:**
- [ ] Delivered at 7:00 AM customer's local timezone (not Bangkok time)
- [ ] Written entirely in customer's preferredLanguage
- [ ] Top 5 prospects by score from last 24 hours
- [ ] Each prospect shows: name, source, signal quote, score, /script command
- [ ] Pipeline summary: total, contacted, converted
- [ ] One coaching tip (rotated, language-appropriate)
- [ ] Tapping /script [name] immediately generates script for that prospect

---

### 5.4 FEATURE: Script Generation

**What it does:** Generates a personalized approach script for a specific prospect. Written in that prospect's language. Structured as: opening → value proposition → CTA → anticipated objections.

**Trigger:** Customer types `/script [name]` or taps the script button in daily report.

**Script format:**

```
📝 Script for สมชาย ก.
Language: Thai 🇹🇭

─── OPENING ─────────────────
สวัสดีครับคุณสมชาย ผมเห็นคุณแชร์ในกลุ่ม LINE เรื่องอยากมีรายได้เพิ่ม
ตรงกับประสบการณ์ของผมพอดีเลยครับ

─── VALUE PROP ──────────────
ผมทำงานจากบ้านเพิ่มรายได้ 30,000-80,000 บาท/เดือน
โดยไม่ต้องลาออกจากงานประจำ ใช้เวลา 2-3 ชั่วโมง/วัน

─── CTA ─────────────────────
ถ้าสนใจอยากรู้ว่าทำอะไร ผมแชร์ข้อมูลเพิ่มเติมให้นะครับ
ไม่มีข้อผูกมัดใดๆ ทั้งนั้น

─── IF THEY ASK "WHAT IS IT?" ──
[Objection response...]

─── IF THEY SAY "NO TIME" ───
[Objection response...]

📋 [Copy Full Script]
👎 No Response  👍 Got Reply  🎯 Converted
```

**AI inputs for script generation:**
- Prospect: name, source, signals, language, score
- Customer ICP: product, approach style, income goal
- Hive patterns: top-performing scripts in this language for similar prospects
- Context: customer's recent wins/losses (from memory)

**Acceptance criteria:**
- [ ] Script generated in prospect's detected language
- [ ] Script is personalized — references specific signal from prospect's post
- [ ] All four components: opening, value prop, CTA, objection responses
- [ ] One-tap copy to clipboard
- [ ] Feedback buttons: 👎 / 👍 / 🎯 — captured and stored
- [ ] Generation time: under 5 seconds
- [ ] `Script` record created in database with all components

---

### 5.5 FEATURE: Feedback + Hive Learning

**What it does:** Captures script outcomes. When a script converts a prospect, extracts the winning pattern and adds it to the Hive. All future scripts for similar prospects, in that language, get seeded from the Hive.

**Feedback flow:**
1. Customer taps 👎 / 👍 / 🎯 after sending a script
2. Outcome recorded on `Script` record: `no_response`, `replied`, `converted`
3. If `converted`:
   - Hive Agent activates
   - Analyzes what made the script work (opening hook, pain point addressed, CTA phrasing)
   - Extracts reusable pattern
   - Saves to `HivePattern` with language tag
   - Updates `HivePattern.successRate` across all uses
4. All customers benefit — anonymously — from each other's wins

**Hive Pattern structure:**
```json
{
  "category": "approach_script",
  "language": "th",
  "tags": ["income_seeker", "line_openchat", "side_hustle"],
  "content": "Opening that references specific pain point from their post + soft income claim + no-pressure CTA",
  "successRate": 0.34,
  "uses": 47,
  "successCount": 16
}
```

**Acceptance criteria:**
- [ ] Feedback buttons work within 5 seconds
- [ ] `converted` feedback triggers Hive Agent
- [ ] Pattern extracted and stored with language + context tags
- [ ] Future scripts query Hive for matching patterns before generating
- [ ] `successRate` recomputed on each feedback event
- [ ] Cross-tenant: Debbie's win helps Nancy's bot (anonymous)

---

### 5.6 FEATURE: Coach (Objection Handling)

**What it does:** Customer pastes or types an objection they received. Coach responds with 3 options for how to reply — in the prospect's language.

**Trigger:** Customer types `/objection [what they said]`

**Example:**
```
Customer: /objection เขาบอกว่า "ไม่มีเวลา"

Tiger Claw Coach:
สำหรับ "ไม่มีเวลา" ลองใช้อันนี้ดู:

Option 1 (Empathy first):
"เข้าใจเลยครับ ทุกคนยุ่งหมด...
[full response]"

Option 2 (Reframe):
"นั่นแหละเหตุผลที่คุยกันครับ...
[full response]"

Option 3 (Soft close):
"โอเคครับ ขอถามนิดนึงได้ไหม...
[full response]"

ใช้ Option ไหนดี? หรือปรับเองได้เลย
```

**Acceptance criteria:**
- [ ] Works in all 6 languages
- [ ] 3 response options ranked by Hive success data
- [ ] Stores outcome if customer reports which worked
- [ ] Feeds back into Hive if successful

---

### 5.7 FEATURE: Pipeline

**What it does:** Customer can see all their prospects by status. Accessible anytime.

**Trigger:** `/pipeline` command

**Format:**
```
📊 Your Pipeline — 47 prospects

🆕 NEW (12)         — ready to script
📤 SCRIPTED (8)     — waiting for response
💬 REPLIED (5)      — follow up needed
🎯 CONVERTED (3)    — wins this month
📁 ARCHIVED (19)    — not a fit

Type /pipeline new    — see new prospects
Type /pipeline won    — see your wins
```

**Acceptance criteria:**
- [ ] Shows counts by status
- [ ] Drilldown by status with full prospect list
- [ ] In customer's preferredLanguage

---

### 5.8 FEATURE: Settings

**What it does:** Customer can update their preferences.

**Trigger:** `/settings`

**Configurable:**
- preferredLanguage
- Report time (default 7 AM, adjustable)
- ICP refresh (restart interview)
- Notification preferences

---

### 5.9 FEATURE: Admin Fleet Dashboard

**What it does:** Brent manages all customer containers from one interface.

**Admin commands:**

```
/fleet status          — all customers, last report time, health
/fleet provision       — spin up new customer container
/fleet suspend [id]    — suspend customer (payment issue)
/fleet logs [id]       — tail logs for specific customer
/fleet report [id]     — manually trigger daily report
```

**Metrics per customer:**
- Last report sent
- Prospects found today
- Scripts generated this week
- Conversions this month
- Container health (CPU, memory)

**Acceptance criteria:**
- [ ] Brent can provision a new customer with one command
- [ ] All customers visible in one view
- [ ] Can trigger manual report for any customer
- [ ] Unhealthy containers flagged with alert

---

## 6. OUT OF SCOPE (v4.0)

These will be built in v4.1 and beyond. Not in this release.

- Automated sending (bot sends scripts on customer's behalf) — legal/ToS review required first
- CRM integrations (HubSpot, Salesforce)
- Team hierarchy / downline tracking
- A/B testing framework for scripts
- Stripe auto-billing management UI
- Mobile app
- Analytics dashboard (web UI)
- Facebook / Instagram authenticated scraping (session cookies)

---

## 7. TECHNICAL REQUIREMENTS

### 7.1 Performance

| Metric | Target |
|---|---|
| Script generation | < 5 seconds |
| Bot response time | < 3 seconds |
| Daily report delivery | Within 5 minutes of scheduled time |
| Scout run completion | < 30 minutes for all customers |

### 7.2 Reliability

| Metric | Target |
|---|---|
| Uptime per customer container | 99.5% |
| Daily report delivery rate | 99% |
| Script generation success rate | 99% |

### 7.3 Security

- Bot tokens: AES-256-GCM encrypted at rest
- Per-customer Docker isolation — one customer cannot access another's data
- No customer data in logs
- Stripe webhook signature verification
- Social media credentials stored in CredentialVault (encrypted)

### 7.4 Scalability

| Scale | Architecture |
|---|---|
| 1-50 customers | Single server, Docker containers |
| 50-200 customers | Two servers, load balanced |
| 200-1000 customers | Kubernetes with container-per-customer |

---

## 8. SUCCESS METRICS

### 8.1 Business (90-day targets)

| Metric | Target |
|---|---|
| Paying customers | 100 |
| MRR | $9,900 |
| Churn rate | < 8% |
| ClawHub installs | 500 |

### 8.2 Product

| Metric | Target |
|---|---|
| Daily report open rate | > 85% |
| Scripts generated per customer/week | > 20 |
| Feedback submission rate | > 40% |
| Reported conversions per customer/month | > 3 |
| Hive patterns active | > 50 per language |

---

## 9. BUILD ORDER

This is the sequence. Each phase is reviewed and approved before the next begins.

**Phase 1 — Foundation (Schema + Script Engine)**
- Prisma schema v4 migration (Script model, language fields)
- Script generation service (Claude, all 6 languages)
- `/script` command + feedback buttons
- `HivePattern` seeding from converted feedback

**Phase 2 — Daily Engine**
- 7 AM daily report cron (customer's local timezone)
- Scout improvements (LINE OpenChat, Facebook public groups)
- Language auto-detection on prospects

**Phase 3 — Coach + Pipeline**
- `/objection` command
- `/pipeline` command with drilldown
- `/settings` command

**Phase 4 — OpenClaw Integration**
- OpenClaw Docker container per customer
- Multi-channel delivery (LINE, WhatsApp)
- Publish Tiger Claw Scout skill to ClawHub

**Phase 5 — Fleet**
- Admin fleet dashboard
- Automated provisioning (Stripe webhook → Docker container)
- Monitoring and alerting

---

## 10. OPEN QUESTIONS FOR BRENT

Mark these with your answer before we move to the Blueprint.

1. **Language priority:** Thai first, then which? Vietnamese or Spanish?

2. **LINE scraping:** Do you have a LINE account we can use for OpenChat scraping, or should we start with Reddit/LinkedIn/Google only and add LINE in Phase 2?

3. **The 100-bot customer:** What did you tell them the product does? Knowing this helps us set Phase 1 delivery expectations.

4. **Script sending:** For v4.0, is the customer manually copying and sending the script? Or do we want to try auto-send from their account in v4.0?

5. **Hive cross-tenant:** You're okay with anonymous patterns being shared across all customers? (Scripts are never shared — only extracted patterns.)

6. **Admin channel:** Where do you want fleet alerts — Telegram, email, or both?

7. **Pricing for 100-bot deal:** Same $99/month per bot, or volume discount?

---

*This document is a draft. No code will be written until Brent Bryson reviews and approves.*
*Version: PRD v4.0 DRAFT — 2026-02-19*
