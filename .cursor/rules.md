# Tiger Claw — Cursor Agent Rules

## MANDATORY: Read Before Any Code

Before writing ANY code in this repository, you MUST read:

1. `specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md` — the canonical specification (127 locked decisions)
2. The relevant OpenClaw doc in `specs/openclaw/` for whatever component you're building

## Architecture Rules

- Tiger Claw wraps UNMODIFIED OpenClaw. Never fork or modify OpenClaw source.
- All flywheel logic lives as OpenClaw skills in `skill/tools/`. No sidecar processes.
- One process per container. Background scheduling uses OpenClaw's native cron.
- Per-tenant SQLite for tenant data. Shared PostgreSQL ONLY for platform ops.
- Four-layer API key management. NEVER use a single shared key.
- Scoring threshold is 80. Not 70. Not configurable.

## Code Quality Rules

- TypeScript strict mode. No `any` types.
- Error handling for EVERY external call, state transition, and user interaction.
- Tests for every public interface, state transition, and error path.
- No `console.log` in production code. Use structured logging.
- No hardcoded secrets. Everything from environment variables.

## What NOT To Do

- Do NOT simplify or skip requirements marked LOCKED in the spec.
- Do NOT make architectural decisions not covered by the spec. Flag them instead.
- Do NOT use BullMQ or any external job queue. OpenClaw cron handles scheduling.
- Do NOT put tenant data in the shared PostgreSQL.
- Do NOT use a single shared API key for all tenants.
- Do NOT set scoring threshold to anything other than 80.

## When In Doubt

If you encounter a decision point not covered by the spec, STOP and ask. Do not guess.
