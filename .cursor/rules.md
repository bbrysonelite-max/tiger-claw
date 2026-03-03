# Tiger Claw — Cursor Agent Rules

## MANDATORY: Read Before Any Code

**Start here:** Read `CLAUDE.md` at the repository root. It is the master briefing.

Then read in order:
1. `specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md` — 127 locked architectural decisions
2. `specs/tiger-claw/TIGERCLAW-BLUEPRINT-v3.md` — v3 changes (UPDATE PIPELINE, CHANNEL WIZARD, OPENCLAW HARDENING)
3. `specs/tiger-claw/TIGERCLAW-PRD-v3.md` — v3 requirements and acceptance criteria
4. The relevant OpenClaw doc in `specs/openclaw/` for the component you're building
5. `tasks/PHASE-0.md` — current active task list

**Blueprint v3 overrides Master Spec v2 where they conflict.**

## Current Phase: PHASE 0

See `tasks/PHASE-0.md` for the exact task list. Do not start Phase 1 until Phase 0 is verified complete (working Docker container confirmed).

## Architecture Rules

- Tiger Claw wraps UNMODIFIED OpenClaw. Never fork or modify OpenClaw source.
- All flywheel logic lives as OpenClaw skills in `skill/tools/`. No sidecar processes.
- One process per container. Background scheduling uses OpenClaw's native cron.
- Per-tenant SQLite for tenant data. Shared PostgreSQL ONLY for platform ops.
- Four-layer API key management. NEVER use a single shared key.
- Scoring threshold is 80. Not 70. Not configurable.
- `channels.telegram.streaming` MUST be explicitly set to `"off"`. Never rely on default.
- `agents.defaults.think` MUST be explicitly set to `"low"`. Never rely on default.
- Layer 2/3/4 API keys use SecretRef. NEVER hot-write `openclaw.json` for key rotation.
- Container readiness: poll `/readyz`. Container liveness: poll `/healthz`.

## Code Quality Rules

- TypeScript strict mode. No `any` types.
- Error handling for EVERY external call, state transition, and user interaction.
- Tests for every public interface, state transition, and error path.
- No `console.log` in production code. Use structured logging.
- No hardcoded secrets. Everything from environment variables.

## What NOT To Do

- Do NOT simplify or skip requirements marked LOCKED in any spec.
- Do NOT make architectural decisions not covered by the spec. Flag them instead.
- Do NOT use BullMQ or any external job queue. OpenClaw cron handles scheduling.
- Do NOT put tenant data in the shared PostgreSQL.
- Do NOT use a single shared API key for all tenants.
- Do NOT set scoring threshold to anything other than 80.
- Do NOT rely on OpenClaw default values for streaming or thinking level. Always set explicitly.
- Do NOT modify `openclaw.json` at runtime for key rotation. Use `openclaw secrets reload`.

## When In Doubt

If you encounter a decision point not covered by the spec, STOP and flag it:
"DECISION REQUIRED: [description]"
Do not guess. Do not pick the reasonable option. Wait for instruction.
