# Tiger Claw Scout — Technical Blueprint v4.0

**Status:** DRAFT — For Owner Review
**Date:** 2026-02-19
**Depends on:** PRD_v4.md (must be approved first)
**Author:** Claude Code (for Brent Bryson review and approval)

---

## OWNER REVIEW INSTRUCTIONS

This document defines every technical decision before code is written.
If something is wrong here, it will be wrong in the code.
Read every section. Challenge every decision. Approve before build begins.

---

## 1. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BRENT'S SERVER (208.113.131.83)                 │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  SHARED INFRASTRUCTURE                      │   │
│  │                                                             │   │
│  │  PostgreSQL 14          Redis           Nginx               │   │
│  │  (all tenant data)   (BullMQ queues)  (reverse proxy)      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ CUSTOMER: Nancy  │  │ CUSTOMER: Chana  │  │ CUSTOMER: ...  │   │
│  │                  │  │                  │  │                │   │
│  │ OpenClaw Gateway │  │ OpenClaw Gateway │  │ OpenClaw       │   │
│  │ port: 18801      │  │ port: 18802      │  │ port: 18803+   │   │
│  │                  │  │                  │  │                │   │
│  │ Tiger Claw Skill │  │ Tiger Claw Skill │  │ Tiger Claw     │   │
│  │ (pre-installed)  │  │ (pre-installed)  │  │ Skill          │   │
│  │                  │  │                  │  │                │   │
│  │ Channel: LINE    │  │ Channel: Telegram│  │ ...            │   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  TIGER CLAW API (port 4000)                 │   │
│  │  - Stripe webhooks → provision new customer                 │   │
│  │  - Admin endpoints → fleet management                       │   │
│  │  - Hive API → cross-tenant pattern sharing                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  SCOUT WORKER (BullMQ)                      │   │
│  │  - Daily prospect hunting (5 AM cron)                       │   │
│  │  - Daily report delivery (7 AM cron)                        │   │
│  │  - Script generation jobs                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

CUSTOMER INTERACTION:
  Customer (LINE/WhatsApp/Telegram)
    → OpenClaw Gateway (their container)
    → Tiger Claw Scout Skill
    → Scout / Scripter / Coach / Hive tools
    → Response back through same channel
```

---

## 2. TECHNOLOGY STACK

### 2.1 Core

| Component | Technology | Version | Why |
|---|---|---|---|
| AI Agent Platform | OpenClaw | stable (v2026.x) | Multi-channel, memory, skills, cron |
| Language | TypeScript | 5.x | Type safety, existing codebase |
| Runtime | Node.js | 22.x LTS | OpenClaw requirement |
| Package Manager | npm | 10.x | |
| Container Runtime | Docker | 26.x | Per-customer isolation |
| Container Orchestration | Docker Compose | 2.x | Fleet management |

### 2.2 Backend Services

| Component | Technology | Version | Why |
|---|---|---|---|
| Database | PostgreSQL | 14.x | Existing, working |
| ORM | Prisma | 6.x | Existing, working |
| Job Queue | BullMQ | 5.x | Existing, working |
| Queue Backend | Redis | 7.x | Existing, working |
| Reverse Proxy | Nginx | 1.24 | Existing, working |
| Process Manager | PM2 | 5.x | For non-Docker services |

### 2.3 AI & APIs

| Component | Technology | Notes |
|---|---|---|
| Primary AI Model | Claude claude-opus-4-5-20251101 | Script gen, coaching, ICP extraction |
| Fallback AI Model | Claude claude-sonnet-4-6 | Cost savings for simple tasks |
| Search | Serper.dev | 3-key rotation, existing |
| Reddit | Reddit public JSON API | No auth required |
| LinkedIn | Google site: search via Serper | |
| Email | Brevo (Sendinblue) | Existing |
| Payments | Stripe | Existing |

### 2.4 Channels (via OpenClaw)

| Channel | OpenClaw Plugin | Market |
|---|---|---|
| Telegram | Built-in (grammY) | All markets |
| LINE | `openclaw-channel-line` | Thailand, Vietnam |
| WhatsApp | Built-in (Baileys) | Vietnam, Indonesia, Malaysia, LATAM |
| Signal | Built-in | International |

---

## 3. REPOSITORY STRUCTURE

```
tiger-bot-scout/
│
├── specs/v4/                         ← You are here
│   ├── PRD_v4.md
│   ├── BLUEPRINT_v4.md               ← This file
│   ├── TYPES_v4.md                   ← Type definitions (next doc)
│   └── TESTS_v4.md                   ← Test plan (next doc)
│
├── skill/                            ← Tiger Claw Scout OpenClaw Skill
│   ├── SKILL.md                      ← Skill definition (OpenClaw reads this)
│   ├── tools/
│   │   ├── scout.ts                  ← Prospect hunting tool
│   │   ├── scripter.ts               ← Script generation tool
│   │   ├── coach.ts                  ← Objection handling tool
│   │   ├── hive.ts                   ← Pattern extraction + query tool
│   │   ├── pipeline.ts               ← Pipeline status tool
│   │   └── report.ts                 ← Daily report generation tool
│   ├── lib/
│   │   ├── search/
│   │   │   ├── serper.ts             ← Google/LinkedIn search
│   │   │   ├── reddit.ts             ← Reddit API search
│   │   │   ├── line-openchat.ts      ← LINE OpenChat public scraping
│   │   │   └── facebook-public.ts    ← Facebook public group scraping
│   │   ├── scoring/
│   │   │   ├── scorer.ts             ← ICP match scoring (0-100)
│   │   │   └── language-detect.ts    ← Detect prospect language
│   │   ├── scripts/
│   │   │   ├── generator.ts          ← Claude script generation
│   │   │   ├── formatter.ts          ← Format script for display
│   │   │   └── hive-query.ts         ← Query Hive for seed patterns
│   │   ├── reports/
│   │   │   ├── builder.ts            ← Build daily report content
│   │   │   └── i18n/
│   │   │       ├── th.ts             ← Thai report templates
│   │   │       ├── vi.ts             ← Vietnamese report templates
│   │   │       ├── id.ts             ← Bahasa Indonesia templates
│   │   │       ├── ms.ts             ← Bahasa Melayu templates
│   │   │       ├── es.ts             ← Spanish templates
│   │   │       └── en.ts             ← English templates (fallback)
│   │   └── db/
│   │       ├── prospect.ts           ← Prospect DB operations
│   │       ├── script.ts             ← Script DB operations
│   │       ├── tenant.ts             ← Tenant DB operations
│   │       └── hive.ts               ← Hive pattern DB operations
│   └── cron/
│       ├── daily-scout.ts            ← 5 AM: hunt prospects
│       └── daily-report.ts           ← 7 AM: send daily report
│
├── api/                              ← Tiger Claw API (Express)
│   ├── server.ts                     ← Express app entry point
│   ├── routes/
│   │   ├── stripe-webhook.ts         ← Payment → provision customer
│   │   ├── admin.ts                  ← Fleet management endpoints
│   │   └── hive.ts                   ← Hive pattern API (cross-tenant)
│   └── services/
│       ├── provisioner.ts            ← Spin up OpenClaw container
│       ├── hive-aggregator.ts        ← Aggregate patterns across tenants
│       └── fleet-monitor.ts          ← Monitor all containers
│
├── prisma/
│   └── schema.prisma                 ← v4.0 schema (being finalized)
│
├── docker/
│   ├── customer/
│   │   ├── Dockerfile                ← OpenClaw + Tiger Claw Skill image
│   │   ├── docker-compose.yml        ← Per-customer compose template
│   │   └── openclaw.json.template    ← OpenClaw config template
│   └── infrastructure/
│       ├── docker-compose.infra.yml  ← Postgres + Redis + Nginx
│       └── nginx.conf                ← Reverse proxy config
│
├── ops/
│   ├── provision-customer.sh         ← CLI: provision new customer
│   ├── fleet-status.sh               ← CLI: show all customer status
│   ├── backup-db.sh                  ← Nightly backup (existing)
│   └── post-bulletin.sh              ← Ops center bulletin (existing)
│
├── src/                              ← Existing backend (being refactored)
│   └── fleet/
│       ├── web-search.ts             ← Serper.dev (existing — move to skill/lib)
│       └── prospect-scheduler.ts     ← Existing cron (replace with skill/cron)
│
└── tests/
    ├── skill/
    │   ├── scout.test.ts
    │   ├── scripter.test.ts
    │   ├── coach.test.ts
    │   └── hive.test.ts
    ├── api/
    │   ├── stripe-webhook.test.ts
    │   └── admin.test.ts
    └── fixtures/
        ├── tenants.ts
        ├── prospects.ts
        └── scripts.ts
```

---

## 4. OPENCCLAW SKILL DEFINITION

### 4.1 SKILL.md

```markdown
---
name: tiger-claw-scout
description: AI-powered prospect scout and sales coach for network marketing professionals. Finds prospects, writes personalized scripts in Thai/Vietnamese/Bahasa/Spanish/English, and learns from every win.
homepage: https://tigerclaw.io
metadata: {"openclaw": {"always": false, "emoji": "🐯", "requires": {"env": ["TIGER_CLAW_API_URL", "TIGER_CLAW_TENANT_ID", "ANTHROPIC_API_KEY", "SERPER_KEY_1"]}, "primaryEnv": "TIGER_CLAW_TENANT_ID"}}
---

# Tiger Claw Scout

You are the Tiger Claw Scout agent for a network marketing professional.

## Your Roles

**Scout** — Find prospects on Reddit, LinkedIn, LINE OpenChat, Facebook Groups, Google.
**Scripter** — Write personalized approach scripts in the prospect's language.
**Coach** — Handle objections. Give 3 response options, ranked by Hive success data.
**Hive** — When a script converts, extract the winning pattern for the shared Hive.

## Customer Commands

- `/report` or `/today` — deliver today's top 5 prospects
- `/script [name]` — generate approach script for named prospect
- `/objection [text]` — get 3 responses to a prospect objection
- `/pipeline` — show prospect pipeline by status
- `/pipeline [status]` — filter: new, scripted, replied, converted
- `/settings` — update preferences (language, report time, ICP)
- `/help` — show all commands

## Language Rules

CRITICAL: Always respond in the customer's preferredLanguage.
Generate scripts in the PROSPECT's detected language (not the customer's language).
A Thai customer getting a Vietnamese prospect: bot response in Thai, script in Vietnamese.

## Tone

Direct. Warm. No fluff. You are their competitive edge, not their cheerleader.
Be the scout who finds real opportunities and the coach who knows what works.
```

### 4.2 Tool Registration

Each tool in `skill/tools/` is registered with OpenClaw as a callable tool. Tools are invoked by the agent (Claude) when it decides the customer's request requires them.

| Tool | Invoked When | Returns |
|---|---|---|
| `scout_now` | Customer asks to find prospects on-demand | List of new prospects found |
| `get_script` | `/script [name]` command | Formatted script with feedback buttons |
| `handle_objection` | `/objection [text]` command | 3 ranked response options |
| `get_pipeline` | `/pipeline` command | Pipeline counts and prospect list |
| `get_report` | `/report` or `/today` command | Today's top 5 formatted report |
| `submit_feedback` | Customer taps 👎/👍/🎯 | Acknowledgement + Hive update if converted |
| `update_settings` | `/settings` command | Confirmation of updated preferences |

---

## 5. DATABASE SCHEMA (v4.0)

Full Prisma schema is in `prisma/schema.prisma`. Summary of models:

### 5.1 Models

| Model | Purpose | Key Fields |
|---|---|---|
| `Tenant` | One per customer | email, botToken, preferredLanguage, state, chat_id, interview_data |
| `Prospect` | One per found prospect | tenantId, name, source, language, score, status, signals[], deliveredAt, contactedAt, repliedAt, convertedAt |
| `Script` | One per generated script | tenantId, prospectId, language, opening, valueProp, cta, objections, fullScript, outcome, hivePatternId |
| `HivePattern` | Shared cross-tenant patterns | content, category, language, tags[], embedding, uses, successCount, successRate |
| `DailyReport` | Log of daily reports sent | tenantId, date, prospectIds[], status, sentAt |
| `CredentialVault` | Encrypted social credentials | tenantId, credentialType, encryptedValue, iv |
| `InviteToken` | Gifted/comped access | token, claimedBy, trialDays, expiresAt |

### 5.2 Key Indexes

```sql
-- Prospect hunting: find new unsent prospects by score
CREATE INDEX idx_prospect_delivery ON "Prospect"(tenantId, status, score DESC);

-- Hive queries: find patterns by language and category
CREATE INDEX idx_hive_lookup ON "HivePattern"(language, category, successRate DESC);

-- Daily report deduplication
CREATE UNIQUE INDEX idx_report_date ON "DailyReport"(tenantId, date::date);
```

---

## 6. API CONTRACTS

### 6.1 Tiger Claw API (port 4000)

#### POST /webhooks/stripe
Stripe calls this when a customer pays.

```typescript
// Request (from Stripe)
{
  type: "customer.subscription.created",
  data: {
    object: {
      customer: "cus_xyz",
      id: "sub_xyz",
      metadata: {
        email: "customer@email.com",
        name: "Customer Name",
        preferredLanguage: "th"
      }
    }
  }
}

// Response
{ success: true, tenantId: "uuid", containerPort: 18801 }

// Side effects:
// 1. Create Tenant record in DB
// 2. Run provision-customer.sh to spin up OpenClaw container
// 3. Send welcome email via Brevo
```

#### POST /admin/provision
Manually provision a customer (comped/gifted).

```typescript
// Request
{
  email: string,
  name: string,
  preferredLanguage: "th" | "vi" | "id" | "ms" | "es" | "en",
  comped: boolean,
  trialDays?: number   // 0 = permanent
}

// Response
{
  tenantId: string,
  containerPort: number,
  openclawGatewayUrl: string,
  welcomeEmailSent: boolean
}
```

#### GET /admin/fleet
Returns status of all customer containers.

```typescript
// Response
{
  customers: [{
    tenantId: string,
    name: string,
    email: string,
    containerPort: number,
    containerStatus: "running" | "stopped" | "error",
    lastReportSent: string | null,   // ISO timestamp
    prospectsFoundToday: number,
    scriptsGeneratedThisWeek: number,
    conversionsThisMonth: number,
    uptime: string,
    preferredLanguage: string
  }]
}
```

#### POST /admin/fleet/:tenantId/report
Manually trigger daily report for a customer.

```typescript
// Response
{ success: true, messageId: string }
```

#### DELETE /admin/fleet/:tenantId
Suspend a customer (payment failure, churn).

```typescript
// Side effects:
// 1. Stop Docker container
// 2. Update Tenant.status = 'suspended'
// 3. Keep data for 30 days before purge
```

#### GET /hive/patterns
Internal API used by Scripter tool to query Hive patterns.

```typescript
// Query params
language: string,
category: string,
tags: string[],
limit: number  // default 5

// Response
{
  patterns: [{
    id: string,
    content: string,
    language: string,
    tags: string[],
    successRate: number,
    uses: number
  }]
}
```

#### POST /hive/patterns
Internal API used by Hive tool to submit a new winning pattern.

```typescript
// Request
{
  tenantId: string,    // source tenant (used internally only, not exposed)
  scriptId: string,
  language: string,
  category: string,
  tags: string[],
  content: string
}
```

---

## 7. TOOL IMPLEMENTATIONS

### 7.1 scout.ts

**Purpose:** Hunt prospects across all configured sources.

```typescript
interface ScoutInput {
  tenantId: string;
  icpData: ICPData;          // from Tenant.interview_data
  sources?: SourceType[];    // default: all enabled sources
  limit?: number;            // max prospects to return, default 20
}

interface ScoutOutput {
  found: number;
  saved: number;             // passed score threshold (70+)
  prospects: ProspectSummary[];
}

// Execution flow:
// 1. Load ICP from DB
// 2. Build search queries from ICP keywords
// 3. Run searches in parallel: Reddit + Serper(LinkedIn) + Serper(Google) + LINE
// 4. Deduplicate against last 30 days
// 5. Score each result (0-100) using Claude
// 6. Detect language of each prospect
// 7. Save 70+ to DB with status='new'
// 8. Return summary
```

**Search query construction (example for Thai ICP):**

```typescript
// ICP: looking for "people who want extra income, in Thailand"
const queries = {
  reddit: [
    "site:reddit.com รายได้เสริม",
    "r/Thailand side income",
    "site:reddit.com \"network marketing\" Thailand"
  ],
  google: [
    "site:linkedin.com/in รายได้เสริม Thailand",
    "\"want to earn extra\" Thailand LINE"
  ],
  serper: buildICPQuery(icpData)  // dynamic query from keywords
}
```

### 7.2 scripter.ts

**Purpose:** Generate personalized approach script using Claude.

```typescript
interface ScripterInput {
  tenantId: string;
  prospectId: string;
}

interface ScripterOutput {
  scriptId: string;
  language: string;
  opening: string;
  valueProp: string;
  cta: string;
  objections: { objection: string; response: string; }[];
  fullScript: string;
  formattedForTelegram: string;   // with markdown + feedback buttons
}

// Execution flow:
// 1. Load prospect from DB (signals, source, language, score)
// 2. Load tenant ICP from DB (product, style, income goal)
// 3. Query Hive for top 3 patterns matching prospect.language + relevant tags
// 4. Build Claude prompt with: prospect data + ICP + Hive patterns
// 5. Call Claude claude-opus-4-5 with structured output
// 6. Save Script record to DB
// 7. Update Prospect.status = 'scripted', Prospect.scriptedAt = now()
// 8. Format for Telegram with inline keyboard (👎/👍/🎯)
// 9. Return formatted output
```

**Claude prompt structure:**

```
System: You are a network marketing sales coach generating personalized outreach scripts.
        Always write the script in {prospect.language}.
        The script must reference the specific signal from the prospect's post.

Context:
  PROSPECT:
    Name: {prospect.name}
    Source: {prospect.source} — {prospect.sourceUrl}
    Signal: {prospect.signals.join(', ')}
    Language: {prospect.language}
    Score: {prospect.score}/100

  CUSTOMER (the person sending the script):
    Product: {icp.product}
    Approach style: {icp.style}
    Income claim: {icp.incomeExample}

  WINNING PATTERNS FROM HIVE (use these as inspiration, not verbatim):
    {hivePatterns.map(p => p.content).join('\n---\n')}

Generate:
  1. opening (1-2 sentences, references their specific signal)
  2. valueProp (2-3 sentences, what's in it for them)
  3. cta (1 sentence, soft ask, no pressure)
  4. objections (array of 3: {objection, response})
  5. fullScript (complete formatted message combining above)

Rules:
  - NEVER mention the company name or product name in the opening
  - Reference something specific from their post
  - Keep total message under 200 words
  - Sound like a real person, not a bot
  - Language: {prospect.language}
```

### 7.3 coach.ts

**Purpose:** Generate 3 ranked objection responses.

```typescript
interface CoachInput {
  tenantId: string;
  objectionText: string;
  prospectLanguage?: string;  // detected if not provided
}

interface CoachOutput {
  objection: string;
  language: string;
  responses: {
    rank: number;
    style: string;       // e.g. "Empathy first", "Reframe", "Soft close"
    text: string;
    hiveBacked: boolean; // true if seeded from Hive pattern
  }[];
}

// Execution flow:
// 1. Detect language of objection text
// 2. Query Hive for objection_handler patterns in that language
// 3. Build Claude prompt with objection + Hive patterns
// 4. Generate 3 response options, ranked by Hive success rate
// 5. Return formatted with language labels
```

### 7.4 hive.ts

**Purpose:** Extract winning pattern from converted script and save to Hive.

```typescript
interface HiveInput {
  scriptId: string;
  outcome: 'no_response' | 'replied' | 'converted';
}

interface HiveOutput {
  patternExtracted: boolean;
  patternId?: string;
}

// Execution flow:
// 1. Load Script + Prospect from DB
// 2. Update Script.outcome, Script.feedbackAt
// 3. If outcome === 'converted':
//    a. Update HivePattern.successCount++ for any hivePatternId on the Script
//    b. Recalculate HivePattern.successRate
//    c. Use Claude to extract the winning element from the script
//    d. Create new HivePattern with extracted content + language + tags
// 4. Update Prospect.status based on outcome
// 5. Return confirmation
```

**Pattern extraction prompt:**

```
Given this script that converted a prospect:

SCRIPT:
{script.fullScript}

PROSPECT CONTEXT:
{prospect.signals}, source: {prospect.source}, language: {prospect.language}

Extract the single most important element that made this work.
Return as a reusable template pattern (use [PLACEHOLDER] for personalized parts).
Category: approach_script | objection_handler | follow_up | cta
Tags: list 3-5 context tags (e.g. income_seeker, line_openchat, thai_market)
```

---

## 8. CRON JOBS

### 8.1 Daily Scout (5:00 AM Bangkok time = 22:00 UTC)

Configured in OpenClaw's cron system per-container:

```json
{
  "cron": {
    "daily-scout": {
      "schedule": "0 22 * * *",
      "tool": "scout_now",
      "args": { "limit": 30 }
    }
  }
}
```

Runs for every customer container. Each container has its own cron schedule (can be offset to avoid hammering APIs simultaneously).

### 8.2 Daily Report (7:00 AM customer's timezone)

The report time is stored per-tenant and translated to UTC:

```typescript
// Tenant.reportTimeUTC computed from Tenant.reportTimeLocal + Tenant.timezone
// Default: 07:00 Asia/Bangkok = 00:00 UTC

// Each container's cron schedule is set at provisioning time based on timezone
```

```json
{
  "cron": {
    "daily-report": {
      "schedule": "0 0 * * *",
      "tool": "get_report",
      "args": { "send": true }
    }
  }
}
```

---

## 9. DOCKER ARCHITECTURE

### 9.1 Per-Customer Container

Each customer gets one Docker container built from:

```dockerfile
# docker/customer/Dockerfile
FROM node:22-slim

# Install OpenClaw globally
RUN npm install -g openclaw@stable

# Install Tiger Claw Scout skill
WORKDIR /root/.openclaw/workspace/skills
COPY skill/ tiger-claw-scout/

# Runtime config is injected at container start
WORKDIR /root
COPY docker/customer/entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 18789

ENTRYPOINT ["./entrypoint.sh"]
```

```bash
# docker/customer/entrypoint.sh
#!/bin/bash
set -e

# Write openclaw.json from environment variables
cat > /root/.openclaw/openclaw.json << EOF
{
  "gateway": {
    "port": ${OPENCLAW_PORT:-18789},
    "auth": { "mode": "token", "token": "${OPENCLAW_GATEWAY_TOKEN}" }
  },
  "agent": {
    "model": "claude-opus-4-5-20251101",
    "anthropicApiKey": "${ANTHROPIC_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": ${TELEGRAM_ENABLED:-true},
      "token": "${TELEGRAM_BOT_TOKEN}"
    },
    "line": {
      "enabled": ${LINE_ENABLED:-false},
      "channelSecret": "${LINE_CHANNEL_SECRET}",
      "channelAccessToken": "${LINE_CHANNEL_ACCESS_TOKEN}"
    }
  },
  "skills": {
    "entries": {
      "tiger-claw-scout": {
        "enabled": true,
        "env": {
          "TIGER_CLAW_API_URL": "${TIGER_CLAW_API_URL}",
          "TIGER_CLAW_TENANT_ID": "${TENANT_ID}",
          "SERPER_KEY_1": "${SERPER_KEY_1}",
          "SERPER_KEY_2": "${SERPER_KEY_2}",
          "SERPER_KEY_3": "${SERPER_KEY_3}",
          "DATABASE_URL": "${DATABASE_URL}"
        }
      }
    }
  },
  "cron": {
    "daily-scout": {
      "schedule": "${SCOUT_CRON_SCHEDULE}",
      "tool": "scout_now"
    },
    "daily-report": {
      "schedule": "${REPORT_CRON_SCHEDULE}",
      "tool": "get_report",
      "args": { "send": true }
    }
  }
}
EOF

exec openclaw gateway --port ${OPENCLAW_PORT:-18789} --verbose
```

### 9.2 Docker Compose Template Per Customer

```yaml
# docker/customer/docker-compose.yml (template — filled in at provision time)
version: '3.9'
services:
  tiger-claw-${TENANT_SLUG}:
    build:
      context: ../../
      dockerfile: docker/customer/Dockerfile
    container_name: tiger-claw-${TENANT_SLUG}
    restart: unless-stopped
    ports:
      - "${CONTAINER_PORT}:18789"
    environment:
      - TENANT_ID=${TENANT_ID}
      - OPENCLAW_PORT=18789
      - OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TELEGRAM_ENABLED=${TELEGRAM_ENABLED}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - LINE_ENABLED=${LINE_ENABLED}
      - LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET}
      - LINE_CHANNEL_ACCESS_TOKEN=${LINE_CHANNEL_ACCESS_TOKEN}
      - DATABASE_URL=${DATABASE_URL}
      - TIGER_CLAW_API_URL=http://host.docker.internal:4000
      - SERPER_KEY_1=${SERPER_KEY_1}
      - SERPER_KEY_2=${SERPER_KEY_2}
      - SERPER_KEY_3=${SERPER_KEY_3}
      - SCOUT_CRON_SCHEDULE=${SCOUT_CRON_SCHEDULE}
      - REPORT_CRON_SCHEDULE=${REPORT_CRON_SCHEDULE}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks:
      - tiger-claw-network

networks:
  tiger-claw-network:
    external: true
```

### 9.3 Provisioning Script

```bash
# ops/provision-customer.sh
#!/bin/bash
# Usage: ./provision-customer.sh --email=x --name=x --lang=th --channel=telegram --token=BOT_TOKEN

# 1. Generate tenant ID and gateway token
TENANT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
GATEWAY_TOKEN=$(openssl rand -hex 32)
TENANT_SLUG=$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')

# 2. Find next available port (18801, 18802, 18803, ...)
CONTAINER_PORT=$(find_next_port 18801)

# 3. Insert Tenant record to DB
psql $DATABASE_URL << SQL
  INSERT INTO "Tenant" (id, email, name, "preferredLanguage", "botToken", "botTokenHash", "botUsername", status)
  VALUES ('$TENANT_ID', '$EMAIL', '$NAME', '$LANG',
          encrypt('$BOT_TOKEN'), sha256('$BOT_TOKEN'), '$BOT_USERNAME', 'active');
SQL

# 4. Generate docker-compose file from template
envsubst < docker/customer/docker-compose.yml > \
  /home/ubuntu/customers/${TENANT_SLUG}/docker-compose.yml

# 5. Start container
docker compose -f /home/ubuntu/customers/${TENANT_SLUG}/docker-compose.yml up -d

# 6. Send welcome email via Tiger Claw API
curl -X POST http://localhost:4000/admin/send-welcome \
  -H "Content-Type: application/json" \
  -d "{\"tenantId\": \"$TENANT_ID\", \"email\": \"$EMAIL\", \"name\": \"$NAME\", \"botUsername\": \"$BOT_USERNAME\"}"

echo "✅ Customer provisioned: $NAME ($EMAIL)"
echo "   Tenant ID: $TENANT_ID"
echo "   Container port: $CONTAINER_PORT"
echo "   Bot: @$BOT_USERNAME"
```

---

## 10. ENVIRONMENT VARIABLES

### 10.1 Server-Level (.env on host)

```env
# Database
DATABASE_URL=postgresql://postgres:REDACTED_DB_PASSWORD@127.0.0.1:5432/tiger_bot

# Redis
REDIS_URL=redis://127.0.0.1:6379

# Anthropic (shared)
ANTHROPIC_API_KEY=sk-ant-...

# Search
SERPER_KEY_1=...
SERPER_KEY_2=...
SERPER_KEY_3=...

# Email
BREVO_API_KEY=...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Admin
ADMIN_SECRET=...

# Onboarding site
ONBOARDING_SITE_URL=https://tigerclaw.io
```

### 10.2 Per-Container (generated at provision time)

```env
TENANT_ID=uuid
OPENCLAW_PORT=18801
OPENCLAW_GATEWAY_TOKEN=random-hex-32
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=7001234567:AAH...
LINE_ENABLED=false
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
SCOUT_CRON_SCHEDULE=0 22 * * *      # 5 AM Bangkok
REPORT_CRON_SCHEDULE=0 0 * * *      # 7 AM Bangkok (UTC midnight)
```

---

## 11. DATA FLOW DIAGRAMS

### 11.1 Customer Sends /script Nancy

```
Customer types "/script Nancy" in their Telegram
  ↓
Telegram → OpenClaw Gateway (their container)
  ↓
OpenClaw routes to Tiger Claw Scout skill
  ↓
Claude (in OpenClaw) decides to invoke `get_script` tool
  ↓
get_script tool:
  → Query DB: find Prospect where name ILIKE 'Nancy' AND tenantId = X
  → Query DB: load Tenant.interview_data (ICP)
  → GET /hive/patterns?language=th&category=approach_script&tags=income_seeker (3 patterns)
  → POST Anthropic API: generate script (prospect + ICP + hive patterns)
  → INSERT Script record to DB
  → UPDATE Prospect.status = 'scripted'
  ↓
Returns formatted script with inline keyboard to OpenClaw
  ↓
OpenClaw delivers via Telegram to customer
  ↓ (customer reads script, sends it to prospect, comes back)
Customer taps 🎯 Converted
  ↓
Telegram callback → OpenClaw → Tiger Claw Scout skill
  ↓
Claude invokes `submit_feedback` tool
  ↓
submit_feedback tool:
  → UPDATE Script.outcome = 'converted'
  → Claude extracts winning pattern
  → INSERT HivePattern (language=th, tags=[...], content=pattern)
  → UPDATE Prospect.status = 'converted', convertedAt = now()
  ↓
Response: "🎯 Amazing! Pattern saved to the Hive. Your win just made every Tiger Claw smarter."
```

### 11.2 Daily Scout (5 AM Cron)

```
OpenClaw cron fires: 22:00 UTC
  ↓
Invokes `scout_now` tool
  ↓
scout_now tool:
  → Load Tenant.interview_data (ICP keywords)
  → Build search queries from ICP
  → Parallel fetch:
      Reddit API: search.json?q={query}&limit=25
      Serper.dev: google search site:linkedin.com/in {query}
      Serper.dev: google search {market keywords}
  → For each result:
      Detect language (Claude or langdetect library)
      Score against ICP (Claude, 0-100)
      Check dedup: NOT IN last 30 days for this tenant
  → INSERT Prospect records (score >= 70 only)
  ↓
Logs: "Scout complete: 47 searched, 8 saved (all score >= 70)"
```

---

## 12. LANGUAGE DETECTION

### 12.1 Detection Sources (in priority order)

1. **Platform** — LINE OpenChat = almost certainly Thai or Vietnamese
2. **Post content** — run `franc` (npm language detection) on signal text
3. **Profile location** — "Bangkok" → Thai, "Ho Chi Minh" → Vietnamese
4. **Username** — Thai characters in username → Thai

### 12.2 Language Detection Library

```typescript
import { franc } from 'franc';

const SUPPORTED_LANGUAGES = ['tha', 'vie', 'ind', 'msa', 'spa', 'eng'];
const FRANC_TO_ISO: Record<string, string> = {
  'tha': 'th', 'vie': 'vi', 'ind': 'id', 'msa': 'ms', 'spa': 'es', 'eng': 'en'
};

function detectLanguage(text: string, platformHint?: string): string {
  // Platform override
  if (platformHint === 'line_openchat_thailand') return 'th';
  if (platformHint === 'line_openchat_vietnam') return 'vi';

  // Text detection
  const detected = franc(text, { only: SUPPORTED_LANGUAGES });
  return FRANC_TO_ISO[detected] ?? 'en';
}
```

---

## 13. MIGRATION FROM v3 (EXISTING SYSTEM)

The existing system (PM2-based, single Telegram worker) remains running while v4 is built. Migration plan:

### Phase 1: Build alongside (no disruption)
- Build `skill/` directory with all tools
- Build Docker container
- Test with one customer (Brent's own bot) in parallel
- Existing PM2 system keeps running

### Phase 2: Customer-by-customer migration
- For each customer: spin up their OpenClaw container
- Point their Telegram bot to the new container (webhook URL change)
- Verify they're getting reports and can use /script
- Old PM2 system as fallback (keep running 30 days)

### Phase 3: Decommission PM2 system
- Once all customers migrated and stable
- Stop: tiger-gateway, tiger-worker, prospect-scheduler
- Keep: postgres, redis, nginx, tiger-api

### Data preservation
- All Prospect records carry over (tenantId matches)
- All HivePattern records carry over
- Tenant interview_data carries over
- Script records carry over

---

## 14. BUILD ORDER (Detailed)

### Phase 1: Script Engine (Builds on existing system)
Build WITHIN the current codebase first — no OpenClaw dependency yet.

| Task | File | Depends On |
|---|---|---|
| Prisma migration: add Script model + language fields | `prisma/schema.prisma` | Nothing |
| Script generation service | `skill/lib/scripts/generator.ts` | Prisma migration |
| Hive query | `skill/lib/scripts/hive-query.ts` | Prisma migration |
| `/script` command handler | Existing `worker.ts` | Script generation |
| Feedback buttons (inline keyboard) | Existing `worker.ts` | `/script` command |
| Hive pattern extraction | `skill/lib/db/hive.ts` | Feedback |
| Language detection | `skill/lib/scoring/language-detect.ts` | Nothing |

### Phase 2: Daily Engine
| Task | File | Depends On |
|---|---|---|
| 7 AM report cron | Existing `prospect-scheduler.ts` | Phase 1 |
| Report i18n templates | `skill/lib/reports/i18n/` | Phase 1 |
| `/today` command update | Existing `worker.ts` | Report templates |
| `/objection` command | Existing `worker.ts` | Coach tool |

### Phase 3: OpenClaw Migration
| Task | File | Depends On |
|---|---|---|
| SKILL.md | `skill/SKILL.md` | Phase 2 complete |
| Docker image | `docker/customer/Dockerfile` | SKILL.md |
| Entrypoint script | `docker/customer/entrypoint.sh` | Dockerfile |
| Provision script | `ops/provision-customer.sh` | Docker image |
| Test with 1 container | — | Provision script |
| Migrate Brent's bot | — | Test passing |

### Phase 4: Full Fleet
| Task | Depends On |
|---|---|
| Admin fleet endpoints | Phase 3 |
| Migrate all customers | Admin endpoints |
| LINE channel integration | Phase 3 |
| WhatsApp channel integration | Phase 3 |
| Publish to ClawHub | Phase 4 stable |

---

## 15. OPEN DECISIONS

These must be resolved before Phase 3 begins (OpenClaw migration).
Phase 1 and 2 can begin immediately.

| Decision | Options | Recommendation |
|---|---|---|
| Hive cross-tenant sharing | All tenants share / opt-in only | All tenants share (anonymous) |
| Script auto-send | Manual copy-paste / Auto-send from customer's account | Manual for v4.0, auto in v4.1 |
| LINE integration timing | Phase 2 / Phase 3 / Phase 4 | Phase 3 |
| Container database | Shared Postgres (current) / Per-container SQLite | Shared Postgres (simpler ops) |
| Customer self-service | Brent provisions manually / Customer claims via link | Invite link (already built) |

---

*Blueprint v4.0 DRAFT — 2026-02-19*
*No code written from this document until Brent Bryson approves.*
