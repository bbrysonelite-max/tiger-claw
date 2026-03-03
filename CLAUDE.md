# Tiger Claw — Agent Briefing

**Read this file first. Every time. No exceptions.**

This is the master briefing for any AI agent (Claude Code, Cursor, or any other) working on Tiger Claw. It tells you what this project is, where everything lives, what phase we are in, and what the rules are.

---

## What Tiger Claw Is

Tiger Claw is a **multi-tenant AI sales and recruiting engine** built on top of [OpenClaw](https://github.com/openclaw/openclaw), an open-source personal AI assistant platform.

Each paying tenant gets a dedicated Docker container running an unmodified OpenClaw instance. Tiger Claw's business logic lives entirely as OpenClaw Skills (tools). One tenant = one container = one agent.

**Target market:** Network marketers, real estate agents, health & wellness professionals who want an AI agent to handle prospect discovery, outreach, nurture sequences, and follow-up — automatically.

**Scale target:** 1,000+ tenants at launch maturity.

**Current OpenClaw version:** `2026.3.2`
**Current Tiger Claw version:** See `deployment_state.json`

---

## Repository Structure

```
tiger-claw/
├── CLAUDE.md                    ← YOU ARE HERE
├── skill/                       ← Tiger Claw OpenClaw Skills (13 tools)
│   ├── SKILL.md                 ← Skill manifest
│   ├── tools/                   ← Individual tool implementations
│   └── config/                  ← Four-layer flavor/regional config system
├── api/                         ← Tiger Claw API (TenantOrchestrator, port 4000)
│   └── src/
│       ├── index.ts             ← Express server + fleet health monitor
│       ├── routes/              ← webhooks, admin, tenants, hive, health, wizard
│       └── services/            ← docker, db, pool, provisioner
├── docker/                      ← Container definitions
│   ├── customer/                ← Per-tenant production container
│   └── dev/                     ← Dev environment
├── ops/                         ← Deployment and operations scripts
│   ├── provision-customer.sh    ← Tenant provisioning (working)
│   ├── build.sh                 ← Docker image builder (Phase 2)
│   └── update.sh                ← Rolling container update (Phase 2)
├── specs/
│   ├── tiger-claw/              ← Tiger Claw spec documents
│   └── openclaw/                ← OpenClaw platform spec documents
├── docs/
│   └── adr/                     ← Architectural Decision Records
└── tasks/                       ← Phase work orders
```

---

## Canonical Spec Documents

Read these in order for the component you are building:

| Document | Purpose | When to Read |
|----------|---------|--------------|
| `specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md` | 127 locked architectural decisions | Always — before any code |
| `specs/tiger-claw/TIGERCLAW-BLUEPRINT-v3.md` | v3 changes: update pipeline, channel wizard, OpenClaw integration hardening | Before any v3 work |
| `specs/tiger-claw/TIGERCLAW-PRD-v3.md` | v3 product requirements, user stories, acceptance criteria | For feature implementation |
| `docs/adr/` | Individual architectural decision records | When you encounter a decision point |
| `specs/openclaw/` | OpenClaw platform documentation (18 files) | When building anything that touches OpenClaw APIs |

**Precedence:** TIGERCLAW-BLUEPRINT-v3.md overrides TIGERCLAW-MASTER-SPEC-v2.md where they conflict.

---

## Current Phase: PHASE 0 (Build Unblocked)

**See `tasks/PHASE-0.md` for the exact task list.**

Phase 0 must be completed before any other work. The Docker container cannot be built until the OpenClaw install command is verified and corrected. Every other task depends on a working container.

**Phase 0 tasks (summary):**
1. Verify the correct `npm install` command for OpenClaw from the [OpenClaw GitHub](https://github.com/openclaw/openclaw)
2. Update `docker/customer/Dockerfile` with the correct install
3. Build a test container and confirm OpenClaw gateway starts
4. Confirm `/readyz` returns 200

**Do not start Phase 1 (OpenClaw hardening) until Phase 0 is complete and a working container is confirmed.**

---

## Locked Decisions (Non-Negotiable)

These cannot be changed. Do not propose changes. Do not work around them. If you think one is wrong, STOP and report it.

| # | Decision |
|---|----------|
| 1 | Per-tenant SQLite for all prospect/lead data. Shared PostgreSQL for platform ops only. |
| 2 | Four-layer API key management. Never a single shared key. |
| 3 | Lead scoring threshold is **80**. Not 70. Not configurable. |
| 4 | Fallback key (Layer 3) is required to complete onboarding. Cannot be skipped. |
| 5 | All flywheel logic lives as OpenClaw Skills. Never modify OpenClaw core. |
| 6 | One Docker process per tenant. No sidecars. |
| 7 | OpenClaw cron for scheduling. No BullMQ or external job queues. |
| 8 | Blue-green deployment with auto-rollback on 3 consecutive failures. |
| 9 | Canary group: 5 tenants, 24h soak minimum before fleet rollout. |
| 10 | Health check every 30 seconds per container. |
| 11 | `channels.telegram.streaming` is explicitly `"off"` in all generated configs. |
| 12 | `agents.defaults.think` is explicitly `"low"` in all generated configs. |
| 13 | Layers 2/3/4 API keys use OpenClaw SecretRef storage. Never hot-write `openclaw.json` for key rotation. |
| 14 | Container readiness uses `/readyz` endpoint. Container liveness uses `/healthz`. |

---

## Architecture Rules

**OpenClaw:**
- Tiger Claw wraps unmodified OpenClaw. Never fork it. Never modify its source.
- OpenClaw is installed as a package inside the customer Docker container.
- Tiger Claw skills live in `skill/tools/`. They are loaded by OpenClaw's skill system.
- OpenClaw handles: messaging channels, LLM calls, cron scheduling, memory, tool execution.
- Tiger Claw provides: the business logic, the flywheel tools, the config system, the platform API.

**Channels:**
- Telegram = primary channel for ALL tenants. Onboarding, briefings, Q&A, admin interface.
- WhatsApp (Baileys) = optional outreach channel. Tenant brings their own number. Disabled by default.
- LINE = optional outreach channel. Tenant provides their own LINE channel token. Disabled by default.
- Prospect outreach channels depend on the market: Reddit + Facebook Groups + Telegram (US), Facebook Groups + LINE + Telegram (Thailand).

**Platform infrastructure:**
- Server: DigitalOcean (209.97.168.251)
- Platform domain: `thegoods.ai` (marketing), `app.thegoods.ai` (Channel Wizard + portal), `api.thegoods.ai` (Tiger Claw API proxy)
- Tiger Claw API port: 4000
- Container port: 18789 (OpenClaw gateway)
- Database: PostgreSQL (platform ops) + SQLite (per-tenant data)
- Cache: Redis

---

## Code Quality Rules

- TypeScript strict mode. No `any` types.
- Error handling for every external call, state transition, and user interaction.
- Tests for every public interface, state transition, and error path.
- No `console.log` in production code. Use structured logging.
- No hardcoded secrets. Everything from environment variables.
- All OpenClaw config values (streaming, thinking level) must be explicitly set. Never rely on defaults.

---

## What NOT To Do

- Do NOT simplify or skip requirements marked LOCKED in any spec.
- Do NOT make architectural decisions not covered by the spec. Flag them.
- Do NOT use BullMQ or any external job queue. OpenClaw cron only.
- Do NOT put tenant data in shared PostgreSQL.
- Do NOT use a single shared API key.
- Do NOT set scoring threshold to anything other than 80.
- Do NOT rely on OpenClaw default values for streaming or thinking. Always set explicitly.
- Do NOT hot-write `openclaw.json` for key rotation. Use SecretRef.

---

## When In Doubt

If you encounter a decision point not covered by the spec, **STOP and ask**. Do not guess. Do not pick the "reasonable" option. Flag it with: "DECISION REQUIRED: [description of the choice]" and wait for instruction.

---

## GitHub Repository

`https://github.com/bbrysonelite-max/tiger-claw`

All spec documents, ADRs, and task files must be committed before starting implementation work. The GitHub history is the source of truth for architectural decisions.
