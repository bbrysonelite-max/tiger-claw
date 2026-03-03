# ADR-0006: OpenClaw Update Pipeline — Rebuild and Rolling Replace

**Status:** Accepted
**Date:** 2026-03-03
**Deciders:** Brent Bryson

## Context

OpenClaw ships multiple updates per week. Tiger Claw containers pin an OpenClaw version at build time. Without an update pipeline, the platform falls behind on security patches and new features, and eventually breaks when the pinned version becomes incompatible.

Two update approaches were considered:
1. **In-container update:** Each running container runs `npm update openclaw` on a schedule
2. **Rebuild and rolling replace:** Build a new Docker image with the new version, replace containers

## Decision

**Rebuild and rolling replace.** When OpenClaw releases a new version:
1. Build a new Docker image with the new version baked in
2. Test it against the canary group (5 tenants, 24h)
3. Roll out via stages: 10% → 25% → 50% → 100%
4. Auto-rollback on 3 consecutive failures at any stage

Docker image tag format: `tiger-claw:{TC_VERSION}-oc{OC_VERSION}`
Example: `tiger-claw:v2026.03.03.1-oc2026.3.2`

Admin-triggered via Telegram admin bot commands:
- `/update build oc{version}` — builds new image
- `/update canary start` — deploys to canary group
- `/update canary advance` — advances rollout stage
- `/update rollback` — rolls back to previous image

## Why Not In-Container Update

- Not testable before deployment — a bad update hits all containers simultaneously
- `npm update` in a running container modifies files in-place, which is fragile
- No rollback path — you can't undo an in-container update at scale
- Breaks the immutable container model

## Data Preservation During Update

All tenant data lives in Docker volumes mounted separately from the container image. The container image is stateless. Volume contents survive container replacement:
- `openclaw.json` (config)
- `.secrets/` (SecretRef key store)
- `data/` (SQLite, leads.json, nurture state, all tool state files)
- `logs/`

No tenant data is lost during updates.

## Consequences

**Positive:**
- Immutable, testable images. Rollback is always available.
- Canary pipeline catches breaking changes before fleet exposure.
- Clear audit trail — image tag tells you exactly what version every container is running.

**Negative:**
- ~30-90 seconds of downtime per tenant container during update (flywheel paused).
- Requires image registry infrastructure.
- Requires `ops/build.sh` and `ops/update.sh` to be built (Phase 2 work).

## Status of Implementation

Not yet implemented. Phase 2 in `TIGERCLAW-BLUEPRINT-v3.md`. `deployment_state.json` structure is defined in the blueprint.
