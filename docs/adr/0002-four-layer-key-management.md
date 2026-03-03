# ADR-0002: Four-Layer API Key Management

**Status:** Accepted
**Date:** 2026-02-27
**Deciders:** Brent Bryson

## Context

Each Tiger Claw tenant uses an LLM provider (Anthropic, OpenAI, etc.) for their AI agent. Managing API keys is complex: tenants set up their own keys during onboarding, keys can fail (rate limits, billing issues), and the platform needs to keep tenants' agents alive even when their keys fail.

## Decision

Four distinct API key layers, each with a specific role and failure behavior:

| Layer | Owner | Role | Rate Limit | Expiry |
|-------|-------|------|------------|--------|
| 1 — Platform Onboarding | Tiger Claw | Runs 5-phase onboarding interview | 50 messages | 72h or Layer 2 installed |
| 2 — Tenant Primary | Tenant | Powers daily flywheel | None (provider limits apply) | None |
| 3 — Tenant Fallback | Tenant | Backup if Layer 2 fails | 20 messages/day | None |
| 4 — Platform Emergency | Tiger Claw | Last resort keep-alive | 5 messages total | 24h then auto-pause |

Rotation cascade: Layer 2 → Layer 3 → Layer 4 → Pause state.

Error classification (from v2 spec, Block 4):
- 401/402/403 → rotate immediately
- 429 → exponential backoff (NOT rotation)
- 5xx → retry 3x, then rotate
- Timeout → retry 2x, then rotate

## Consequences

**Positive:**
- Tenants can never run up Tiger Claw's platform credit unexpectedly.
- Platform cost is bounded even when all tenant keys fail.
- Tenants are protected from outages by the fallback cascade.
- Fallback key requirement during onboarding forces tenants to be prepared.

**Negative:**
- Onboarding UX complexity — tenants must provide two API keys.
- Key rotation logic in `tiger_keys.ts` is complex (~1,240 lines).

## Status of Implementation

Implemented in `skill/tools/tiger_keys.ts`. Migration to SecretRef storage in progress (see ADR-0007).
