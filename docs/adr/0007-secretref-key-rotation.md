# ADR-0007: SecretRef for Layer 2/3 Key Rotation

**Status:** Accepted (revised)
**Date:** 2026-03-03
**Deciders:** Brent Bryson

> **Revision note:** This ADR supersedes the original ADR-0007. Corrections
> are based on P1-1 SecretRef research findings documented in `tasks/PHASE-1.md`.
> The original assumed API keys lived in a root `providers` config block and
> used a `$secret` reference syntax. Both were incorrect.

## Context

Tiger Claw uses a four-layer API key management system (ADR-0002). Keys need to be rotated at runtime when tenants provide their own keys (Layer 2) or when the platform-provided fallback key is updated (Layer 3).

The original ADR-0007 assumed key rotation required hot-writing `openclaw.json`, which creates a file-system race condition. Locked decision #13 states: "Never hot-write `openclaw.json` for key rotation. Use SecretRef."

During Phase 0 (P0-5b), we discovered:
- API keys are NOT configured in a root `providers` block — that key is rejected by the schema validator.
- Standard provider keys are resolved from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
- The correct config path for model provider keys is `models.providers.*.apiKey`.
- OpenClaw's SecretRef system supports `env`, `file`, and `exec` source types.

During P1-1, we confirmed the full SecretRef mechanism from https://docs.openclaw.ai/gateway/secrets.

## Decision

### Three-Layer Approach

| Layer | Key Type | Storage Mechanism | Rotation |
|-------|----------|-------------------|----------|
| **Layer 1** (platform onboarding) | Platform-provided Anthropic key | Env var (`ANTHROPIC_API_KEY`), set by `entrypoint.sh` | Never rotated at runtime. Changed only by redeploying the container. |
| **Layer 2** (tenant primary) | Tenant's own API key | `source: "file"` SecretRef → `~/.openclaw/secrets.json` | `tiger_keys` writes to secrets.json → triggers `secrets.reload` |
| **Layer 3** (tenant fallback) | Platform fallback key | `source: "file"` SecretRef → `~/.openclaw/secrets.json` | Same as Layer 2 |
| **Layer 4** (platform emergency) | Platform emergency key | Env var (`PLATFORM_EMERGENCY_KEY`), read by `tiger_keys` | Only activated when all other layers fail. Not a SecretRef target. |

### SecretRef Configuration

`openclaw.json` references keys via SecretRef objects on the supported credential surface `models.providers.*.apiKey`:

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
  },
  "models": {
    "providers": {
      "anthropic": {
        "apiKey": { "source": "file", "provider": "filemain", "id": "/active/apiKey" }
      }
    }
  }
}
```

The secrets file (`~/.openclaw/secrets.json`):

```json
{
  "active": {
    "apiKey": "sk-ant-..."
  }
}
```

### Rotation Flow

When `tiger_keys.ts` rotates a key (e.g., tenant provides their own key via Layer 2):

1. **Write** the new key value to `~/.openclaw/secrets.json`
2. **Trigger** `secrets.reload` via gateway RPC (or `openclaw secrets reload` CLI)
3. **Gateway** atomically swaps to the new in-memory snapshot
4. **Never** touch `openclaw.json` — locked decision #13 confirmed achievable

If the reload fails (bad key, file permission error, etc.):
- Gateway keeps the **last-known-good snapshot** (previous working key)
- Gateway enters **degraded secrets state** and emits `SECRETS_RELOADER_DEGRADED`
- On next successful reload, gateway emits `SECRETS_RELOADER_RECOVERED`
- The gateway does NOT crash on a failed rotation

### Startup Fail-Fast Requirement

SecretRefs on active surfaces must resolve at startup. If `secrets.json` is missing or contains an invalid value, the gateway refuses to start.

`entrypoint.sh` must:
1. Create `~/.openclaw/secrets.json` with the initial Layer 1 key before gateway startup
2. Ensure the file has correct ownership/permissions
3. Write the `secrets.providers` config into `openclaw.json`

### What SecretRef Does NOT Do

SecretRef is **resolution-only**. It reads secrets from sources and caches them in memory. It does not:
- Schedule key rotation (Tiger Claw cron jobs handle this)
- Generate new keys (Tiger Claw tool logic handles this)
- Validate that a key is functional (Tiger Claw must test the key before committing it)

## Consequences

**Positive:**
- Eliminates the file-write race condition on key rotation — `openclaw.json` is never modified.
- Key rotation is atomic from OpenClaw's perspective (snapshot swap).
- Failed rotations are safe — last-known-good snapshot is preserved.
- Follows OpenClaw's intended architecture for credential management.
- Confirmed compatible with locked decision #13.

**Negative:**
- Requires migration of existing tenant containers (`key_state.json` values must be seeded into `secrets.json` on first boot after upgrade).
- `tiger_keys.ts` refactor needed to write to `secrets.json` + call `secrets.reload` instead of modifying env vars.
- Must test the full rotation cascade (L1→L2→L3→L4→pause) with SecretRef reload before fleet deployment.
- Startup is blocked if `secrets.json` is missing or unreadable — `entrypoint.sh` must always seed it.

## Migration Path

On first boot after the update, `entrypoint.sh` detects if `key_state.json` exists but `secrets.json` does not. It migrates existing keys to `secrets.json` and regenerates the `models.providers` section in `openclaw.json` with SecretRef references. One-time migration per container.

## Sources

- https://docs.openclaw.ai/gateway/secrets — SecretRef contract, activation triggers, degraded state
- https://docs.openclaw.ai/reference/secretref-credential-surface — `models.providers.*.apiKey` confirmed as supported target
- https://docs.openclaw.ai/help/environment — env var precedence for standard provider keys
- `tasks/PHASE-1.md` — P1-1 Findings section

## Status of Implementation

Pre-work complete (P1-1 research, ADR rewrite). Implementation pending in P1-3/P1-4.
