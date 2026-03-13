# Tiger Claw — Cursor Agent Rules

## STOP. READ THIS FIRST. NO EXCEPTIONS.

**Before writing a single line of code, read:**

1. `CLAUDE.md` — master briefing, GCP project, current phase, all locked decisions
2. `specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md` — 127 locked architectural decisions

**Any architectural change not explicitly approved in those documents requires HUMAN APPROVAL.**
**Do not refactor. Do not pivot. Do not "improve" the architecture. Flag it and wait.**

---

## Current Architecture (v4 — NON-NEGOTIABLE)

This is the canonical architecture. It has been approved and locked. Do not change it.

| Component | Decision | LOCKED |
|-----------|----------|--------|
| AI Provider | **Google Gemini (`gemini-2.5-flash`)** via `@google/generative-ai` | ✅ |
| Multi-tenancy | **Stateless** — one API process, all tenants, context resolved per-request | ✅ |
| Infrastructure | **Cloud Run** (not GKE, not Docker Compose, not Kubernetes) | ✅ |
| Tenant data | **Per-tenant `workdir`** (SQLite or files) — NOT shared PostgreSQL | ✅ |
| Platform data | **Shared PostgreSQL** (Cloud SQL) — tenants, bots, subscriptions, pool | ✅ |
| Job queuing | **BullMQ + Redis** (Memorystore) | ✅ |
| Tools | **19 Gemini function-calling tools** in `api/src/tools/` | ✅ |
| Scoring threshold | **80** — not 70, not configurable | ✅ |
| OpenClaw | **Removed** — do not reference, do not restore | ✅ |

---

## What OpenClaw Was (History Only)

OpenClaw was the previous per-tenant Docker container architecture. It has been replaced entirely
by the v4 stateless Gemini architecture. References to it exist only in:
- `specs/openclaw/` — historical docs, do not use as guidance
- `tasks/PHASE-0.md` through `tasks/PHASE-4.md` — superseded task lists, ignore them
- Old commit messages — history only

**Do not restore OpenClaw. Do not install `@anthropic-ai/sdk`. Do not add per-tenant containers.**

---

## Architecture Rules

- One Express API process (port 4000) handles all tenants
- AI engine: `@google/generative-ai` (Gemini). Never `@anthropic-ai/sdk`
- All 19 tools in `api/src/tools/` must be registered in `ai.ts` `toolsMap` — missing tools cause infinite loops
- Four-layer API key system (tiger_keys.ts) — Layer order: Platform Onboarding → Tenant Primary → Tenant Fallback → Platform Emergency
- Chat history in Redis (`chat_history:{tenantId}:{chatId}`, 7-day TTL) — never PostgreSQL
- Bot tokens encrypted at rest using `services/pool.ts` `encryptToken()`/`decryptToken()`
- Scoring threshold is **80** — not 70, not configurable, not discussable
- BYOK keys validated server-side before storage — never store plaintext keys

---

## Code Quality Rules

- TypeScript strict mode
- No hardcoded secrets — all from environment variables (fail loudly if not set)
- No silent failures — every error must be logged, alerted via admin bot, and surfaced
- No `console.log` in production logic — use `console.error` or structured logging

---

## What NOT To Do

- Do NOT install `@anthropic-ai/sdk` — the AI engine is Google Gemini
- Do NOT create per-tenant Docker containers or Kubernetes deployments
- Do NOT put tenant prospect/lead data in PostgreSQL — use per-tenant `workdir`
- Do NOT use a single shared API key — 4-layer key system always
- Do NOT restore OpenClaw or reference `specs/openclaw/` as active guidance
- Do NOT use BullMQ alternatives — BullMQ + Redis is the locked queue system
- Do NOT change the scoring threshold from 80
- Do NOT make architectural changes without human approval — flag with `DECISION REQUIRED:`
- Do NOT use "tiger_credits" anywhere — deleted, it's a hallucination
- Do NOT set `NODE_ENV` fallbacks or localhost URL fallbacks — fail loudly if env vars are missing

---

## When In Doubt

STOP. Write: `DECISION REQUIRED: [description]` and wait for instruction.
Do not pick the reasonable option. Do not guess. Do not refactor "while you're in there."
