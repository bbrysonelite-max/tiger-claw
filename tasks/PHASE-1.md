# Phase 1 — OpenClaw Integration Hardening

**Status:** ACTIVE
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
- [x] Use fully-qualified model format in `entrypoint.sh` (e.g., `anthropic/claude-haiku-4-5-20251001` instead of bare `claude-haiku-4-5-20251001`)
- [x] Verify the model format fix doesn't break key_state.json resolution logic — confirmed: key_state.json stores keys/provider, not model names; model is derived at runtime

---

### Task P1-2: Verify `/readyz` provisioning readiness check

**Blueprint ref:** Item 5 — `provisioner.ts` — switch from `/health` to `/readyz` for startup readiness check

**Status:** ALREADY DONE (Phase 0)

Implemented during P0-4:
- `api/src/services/docker.ts` — added `getContainerReady()` function for `/readyz`
- `api/src/services/provisioner.ts` — switched from `waitForHealth` to `waitForReady`, timeout 60s (ADR-0008)

**Remaining work:**
- [x] Confirm `getContainerReady()` handles edge cases — ECONNREFUSED (crash/port not bound) already handled by `.on("error")` → resolves false
- [x] Add a unit test for `waitForReady` timeout behavior — 4 tests in `api/src/services/__tests__/provisioner.test.ts`

---

### Task P1-3: Migrate Layer 2/3/4 key rotation to SecretRef

**Blueprint ref:** Item 6 — `tiger_keys.ts` — migrate Layer 2/3/4 key rotation to SecretRef

**Pre-work (REQUIRED before implementation):**
- [x] Read https://docs.openclaw.ai/gateway/secrets to understand the SecretRef mechanism
- [x] Document findings: how does SecretRef interact with env vars? Is it a file-based secrets store, a runtime API, or something else?
- [x] Determine if SecretRef can rotate `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` at runtime without restarting the gateway
- [x] Update ADR-0007 with the confirmed SecretRef mechanism

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

---

## P1-1 Findings — SecretRef Mechanism

**Date:** 2026-02-27
**Trigger:** P1-3 pre-work — understand SecretRef before implementing key rotation.

### Q1: Does SecretRef operate on env vars, a file-based secrets store, or something else?

SecretRef supports **three source types**, all opt-in per credential:

| Source | How it works |
|--------|-------------|
| `env` | Reads from a process environment variable. `id` is the env var name (e.g., `ANTHROPIC_API_KEY`). |
| `file` | Reads from a local JSON file. `id` is a JSON pointer into the file (e.g., `/providers/anthropic/apiKey`). Provider config specifies `path` and `mode` (`json` or `singleValue`). |
| `exec` | Runs an external binary (Vault, 1Password, sops, custom script). Sends a JSON request on stdin, reads resolved values from stdout. |

All three resolve into an **in-memory runtime snapshot**. Resolution is eager (at activation time), not lazy. Runtime requests read from the snapshot only — secret-provider outages stay off hot request paths.

The SecretRef object shape is consistent everywhere:
```json
{ "source": "env", "provider": "default", "id": "ANTHROPIC_API_KEY" }
```

Providers are configured under `secrets.providers` in `openclaw.json`.

**Source:** https://docs.openclaw.ai/gateway/secrets — "SecretRef contract" section

### Q2: Can SecretRef rotate an API key without restarting the gateway?

**Yes.** Activation triggers include:

1. Gateway startup (preflight + final activation)
2. Config reload hot-apply path
3. Config reload restart-check path
4. **Manual reload via `secrets.reload`** (gateway RPC method)

Reload uses **atomic swap**: full success → new snapshot; failure → keep last-known-good snapshot. This means:

- Write the new key to the secrets file (or update the env var / vault entry)
- Trigger `openclaw secrets reload` (CLI) or `secrets.reload` (gateway RPC)
- Gateway picks up the new key without restart

**Important caveat:** SecretRef is **resolution-only**. It does NOT rotate keys itself. The docs explicitly state: "Runtime-minted or rotating credentials and OAuth refresh material are intentionally excluded from read-only SecretRef resolution." Tiger Claw must handle the actual rotation logic (writing the new key), then trigger SecretRef reload to pick it up.

**Source:** https://docs.openclaw.ai/gateway/secrets — "Activation triggers" section

### Q3: What is the SecretRef file layout — path, format, and schema?

For `source: "file"`:

- **Path:** Configured per provider in `secrets.providers.<name>.path` (e.g., `~/.openclaw/secrets.json`)
- **Format:** JSON (`mode: "json"`) or single value (`mode: "singleValue"`)
- **Schema (JSON mode):** Plain JSON object. The `id` field in the SecretRef is a JSON pointer (RFC 6901) into this object.

Example provider config:
```json
{
  "secrets": {
    "providers": {
      "filemain": {
        "source": "file",
        "path": "~/.openclaw/secrets.json",
        "mode": "json"
      }
    }
  }
}
```

Example secrets file (`~/.openclaw/secrets.json`):
```json
{
  "providers": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." }
  }
}
```

Example SecretRef on a credential field:
```json
{
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": { "source": "file", "provider": "filemain", "id": "/providers/anthropic/apiKey" }
      }
    }
  }
}
```

Path must pass ownership/permission checks. `allowInsecurePath: true` bypasses this for trusted paths (not recommended in production).

**Source:** https://docs.openclaw.ai/gateway/secrets — "File provider" section

### Q4: Does SecretRef integrate with OpenClaw cron for scheduled rotation?

**No.** SecretRef is a pure resolution mechanism — it reads secrets, it does not schedule or perform rotation. There is no built-in cron-to-SecretRef integration.

For Tiger Claw, the rotation flow would be:
1. A cron job (e.g., `tiger_keys` tool call) decides a key needs rotation
2. The tool writes the new key to `~/.openclaw/secrets.json`
3. The tool triggers `secrets.reload` via gateway RPC to activate the new snapshot

This is fully compatible with our existing cron job infrastructure documented in `specs/openclaw/OPENCLAW-CRON-SCHEMA.md`.

**Source:** https://docs.openclaw.ai/gateway/secrets — "Activation triggers" section (no cron trigger listed)

### Q5: Other SecretRef behaviors relevant to Tiger Claw key rotation?

1. **Supported credential surface confirmed.** `models.providers.*.apiKey` is a supported SecretRef target. Both `channels.telegram.botToken` and provider API keys can use SecretRef. Full list at https://docs.openclaw.ai/reference/secretref-credential-surface

2. **P0-5b root `"providers"` error explained.** During P0-5b, we removed the root-level `"providers"` key. The correct path for model provider config is `models.providers`, not `providers`. SecretRef targets this as `models.providers.*.apiKey`.

3. **Env vars still work alongside SecretRef.** If both plaintext (or env var) and a SecretRef are present, the ref takes precedence. This means we can use env vars as the default path and optionally layer SecretRef on top for tenants with their own keys.

4. **Degraded state handling.** If a `secrets.reload` fails after a healthy state, OpenClaw enters "degraded secrets state" — keeps last-known-good snapshot and emits `SECRETS_RELOADER_DEGRADED`. Recovers on next successful activation with `SECRETS_RELOADER_RECOVERED`. This means a bad key write won't crash the gateway.

5. **Startup fail-fast.** If a SecretRef on an active surface can't resolve at startup, the gateway refuses to start. This means `entrypoint.sh` must seed valid initial values in the secrets file before gateway startup.

6. **Active-surface filtering.** SecretRefs on disabled/inactive surfaces (e.g., a disabled channel) are ignored during resolution. Only effectively active surfaces block startup/reload. This is useful — if Telegram is the only enabled channel, a missing WhatsApp credential ref won't block startup.

**Sources:**
- https://docs.openclaw.ai/gateway/secrets — "Degraded and recovered signals", "Active-surface filtering"
- https://docs.openclaw.ai/reference/secretref-credential-surface

### ADR-0007 Required Changes

ADR-0007 ("SecretRef for Layer 2/3/4 Key Rotation") needs the following corrections based on these findings:

1. **Remove the `providers` config block assumption.** ADR-0007 was written assuming API keys live in a root `providers` config block. The correct path is `models.providers.*.apiKey`. However, for Tiger Claw the recommended approach is to use `source: "file"` SecretRef pointing to `~/.openclaw/secrets.json`, not inline plaintext in `models.providers`.

2. **Add the rotation flow.** SecretRef is resolution-only — it does not rotate keys. The ADR must document the full rotation flow:
   - `tiger_keys` writes the new key to `~/.openclaw/secrets.json`
   - `tiger_keys` triggers `secrets.reload` via gateway RPC
   - Gateway atomically swaps to new snapshot (or keeps last-known-good on failure)

3. **Document the three-layer approach:**
   - **Layer 1 (platform-provided):** Stays as env var (`ANTHROPIC_API_KEY`). Seeded by `entrypoint.sh`. No SecretRef needed — platform controls the container env.
   - **Layer 2/3 (tenant-provided / fallback):** Use `source: "file"` SecretRef. `tiger_keys` writes to `~/.openclaw/secrets.json` and triggers reload.
   - **Layer 4 (platform emergency):** Stays as env var (`PLATFORM_EMERGENCY_KEY`). Only used when all other layers fail. No SecretRef needed.

4. **Add startup requirement.** `entrypoint.sh` must seed `~/.openclaw/secrets.json` with valid initial values before gateway startup. Unresolvable SecretRefs on active surfaces cause startup failure (fail-fast).

5. **Add degraded-state behavior.** Document that a failed key rotation keeps the previous working key (last-known-good snapshot), and the gateway emits `SECRETS_RELOADER_DEGRADED`. This is a safety net, not a normal operating state.

6. **Note: `openclaw.json` is NOT hot-written.** This confirms locked decision #13 is achievable. SecretRef lets us rotate keys by writing to a separate `secrets.json` file and triggering reload — `openclaw.json` is never modified for key rotation.
