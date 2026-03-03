# Phase 1 — OpenClaw Integration Hardening

**Status:** NOT STARTED
**Prerequisite:** Phase 0 complete (verified — container builds, gateway starts, `/readyz` returns 200)
**Completion signal:** All five tasks below are checked off, committed, and verified in a running container.

---

## Phase 0 Carry-Forward Notes

The following items were discovered during Phase 0 and affect Phase 1 work:

1. **ADR-0007 (SecretRef) needs revision.** API keys are set via env vars (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), not a `providers` config block. SecretRef rotation likely means rotating the env var or writing to a secrets file that maps to these env vars. Confirm the actual SecretRef mechanism before implementing P1-3/P1-4. See: https://docs.openclaw.ai/gateway/secrets
2. **Cron job schema documented.** See `specs/openclaw/OPENCLAW-CRON-SCHEMA.md` for the `jobs.json` structure. Any cron changes in Phase 1 must use this schema.
3. **Config key `thinkingDefault`.** The blueprint says `think: "low"` — the correct key is `agents.defaults.thinkingDefault: "low"`. Already fixed in `entrypoint.sh` (P0-5b) and ADR-0010.
4. **Model format.** Use fully-qualified provider/model format (e.g., `anthropic/claude-haiku-4-5-20251001`) to avoid the "Model specified without provider" warning.
5. **`gateway.mode: "local"` and `gateway.bind: "lan"`** are required for all container deployments (ADR-0011).

---

## Task List

### Task P1-1: Verify `streaming: "off"` and `thinkingDefault: "low"` are set

**Blueprint ref:** Item 4 — `entrypoint.sh` — set `streaming: "off"`, `think: "low"` explicitly

**Status:** ALREADY DONE (Phase 0)

Both settings were implemented during P0-5/P0-5b:
- `channels.telegram.streaming: "off"` (ADR-0009)
- `agents.defaults.thinkingDefault: "low"` (ADR-0010)

**Remaining work:**
- [ ] Use fully-qualified model format in `entrypoint.sh` (e.g., `anthropic/claude-haiku-4-5-20251001` instead of bare `claude-haiku-4-5-20251001`)
- [ ] Verify the model format fix doesn't break key_state.json resolution logic

---

### Task P1-2: Verify `/readyz` provisioning readiness check

**Blueprint ref:** Item 5 — `provisioner.ts` — switch from `/health` to `/readyz` for startup readiness check

**Status:** ALREADY DONE (Phase 0)

Implemented during P0-4:
- `api/src/services/docker.ts` — added `getContainerReady()` function for `/readyz`
- `api/src/services/provisioner.ts` — switched from `waitForHealth` to `waitForReady`, timeout 60s (ADR-0008)

**Remaining work:**
- [ ] Confirm `getContainerReady()` handles edge cases (container crash during startup, port not yet bound)
- [ ] Add a unit test for `waitForReady` timeout behavior

---

### Task P1-3: Migrate Layer 2/3/4 key rotation to SecretRef

**Blueprint ref:** Item 6 — `tiger_keys.ts` — migrate Layer 2/3/4 key rotation to SecretRef

**Pre-work (REQUIRED before implementation):**
- [ ] Read https://docs.openclaw.ai/gateway/secrets to understand the SecretRef mechanism
- [ ] Document findings: how does SecretRef interact with env vars? Is it a file-based secrets store, a runtime API, or something else?
- [ ] Determine if SecretRef can rotate `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` at runtime without restarting the gateway
- [ ] Update ADR-0007 with the confirmed SecretRef mechanism

**Implementation:**
- [ ] Modify `tiger_keys.ts` to use SecretRef for Layer 2/3 key storage and rotation
- [ ] Layer 4 (platform emergency) remains env-var-only — no SecretRef needed
- [ ] Ensure key rotation triggers are compatible with the cron job schema (if cron-driven)
- [ ] Test: rotate a key via `tiger_keys restore_key` and confirm the gateway picks it up without restart

---

### Task P1-4: Add SecretRef setup to entrypoint.sh

**Blueprint ref:** Item 7 — `entrypoint.sh` — add SecretRef setup for keys

**Depends on:** P1-3 (must understand SecretRef mechanism first)

- [ ] Add SecretRef initialization to `entrypoint.sh` (create secrets file/directory, set permissions)
- [ ] Ensure Layer 1 key (platform-provided) is correctly seeded into SecretRef on first boot
- [ ] Ensure `key_state.json` and SecretRef are in sync after container restart
- [ ] Document the SecretRef file layout in a comment block in `entrypoint.sh`

---

### Task P1-5: Assess ACP dispatch impact on Tiger Claw tools

**Blueprint ref:** Item 8 — Assess ACP dispatch impact on Tiger Claw tools (test suite)

**Context:** OpenClaw v2026.3.2 may have changed how tool calls are dispatched (ACP = Agent Communication Protocol). Need to confirm all Tiger Claw tools still work correctly.

- [ ] Read OpenClaw v2026.3.2 release notes for ACP/dispatch changes
- [ ] List all Tiger Claw tools and their parameter schemas
- [ ] Run each tool in a test container with a real API key (or mock) and confirm:
  - Tool is registered correctly (`[skills] Sanitized skill command name "tiger-claw" to "/tiger_claw"` already confirmed in P0-3)
  - Tool parameters are parsed correctly by the dispatcher
  - Tool output is returned to the agent correctly
- [ ] Document any breaking changes or required tool schema adjustments
- [ ] If ACP dispatch has changed, update affected tools

---

## Definition of Phase 1 Complete

Phase 1 is complete when ALL of the following are true:

- [ ] `streaming: "off"` and `thinkingDefault: "low"` confirmed in generated config (P1-1)
- [ ] Model uses fully-qualified `provider/model` format (P1-1)
- [ ] `/readyz` provisioning check has edge-case coverage (P1-2)
- [ ] SecretRef mechanism documented and ADR-0007 updated (P1-3)
- [ ] Key rotation works via SecretRef without gateway restart (P1-3)
- [ ] `entrypoint.sh` initializes SecretRef on boot (P1-4)
- [ ] All Tiger Claw tools confirmed working with v2026.3.2 dispatch (P1-5)
- [ ] All changes committed to GitHub
