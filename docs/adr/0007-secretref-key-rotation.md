# ADR-0007: SecretRef for Layer 2/3/4 Key Rotation

**Status:** Accepted
**Date:** 2026-03-03
**Deciders:** Brent Bryson

## Context

`tiger_keys.ts` currently rotates API keys by hot-writing `openclaw.json` while the OpenClaw gateway is running. This creates a file-system race condition: if OpenClaw reads the config at the same moment the key rotation writes it, the file could be read in a partially written state, causing config corruption or gateway crash.

OpenClaw v2026.2.26 introduced a native secrets management system (SecretRef). OpenClaw v2026.3.2 expanded it to 64 credential targets including model API keys. This is the correct mechanism for runtime secret rotation.

## Decision

Layer 2 (tenant primary), Layer 3 (tenant fallback), and Layer 4 (platform emergency) API keys are stored as OpenClaw SecretRef entries in `~/.openclaw/.secrets/`.

`openclaw.json` references them as:
```json
{
  "models": {
    "default": {
      "provider": "anthropic",
      "apiKey": { "$secret": "layer2-key" }
    }
  }
}
```

When `tiger_keys.ts` rotates a key:
1. Writes new key value to the secrets store file
2. Calls `openclaw secrets reload` via the OpenClaw gateway API
3. Does NOT touch `openclaw.json`

Layer 1 (Platform Onboarding key) continues to be written directly to `openclaw.json` at container startup only. It is never rotated at runtime.

## Consequences

**Positive:**
- Eliminates the file-write race condition on key rotation.
- Key rotation is atomic from OpenClaw's perspective.
- Follows OpenClaw's intended architecture for credential management.
- Secrets files have `0600` permissions by default (owner-only, per OpenClaw v2026.3.2 LaunchAgent hardening).

**Negative:**
- Requires migration of existing tenant containers (key_state.json values must be moved to secrets store on first boot after upgrade).
- `tiger_keys.ts` refactor is non-trivial (~1,240 lines).
- Must test the full rotation cascade (L2→L3→L4→pause) before fleet deployment.

## Migration Path

On first boot after the update, `entrypoint.sh` detects if `key_state.json` exists but the SecretRef store does not. It migrates existing keys to the secrets store and regenerates `openclaw.json` with SecretRef references. One-time migration per container.

## Status of Implementation

Not yet implemented. Phase 1 in `TIGERCLAW-BLUEPRINT-v3.md`.
