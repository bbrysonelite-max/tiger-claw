# ADR-0008: Use `/readyz` for Container Provisioning Readiness

**Status:** Accepted
**Date:** 2026-03-03
**Deciders:** Brent Bryson

## Context

During tenant provisioning, `provisioner.ts` waits for the container to become healthy before marking it as "onboarding." Currently it polls `/health`.

OpenClaw v2026.3.1 added four native health endpoints:
- `/health` / `/healthz` — liveness: returns 200 when the process is alive
- `/ready` / `/readyz` — readiness: returns 200 when the gateway is fully initialized and ready to accept messages

The difference matters for provisioning: `/health` returns 200 as soon as the Node process starts, which is seconds before the OpenClaw gateway has loaded all channel configs, skill manifests, and cron jobs. Marking the tenant as "onboarding" too early means the onboarding message may be sent before the Telegram channel is ready to receive replies.

## Decision

`provisioner.ts` polls `/readyz` (not `/health`) for container startup confirmation. The container is only marked as "onboarding" after `/readyz` returns 200.

Polling parameters (unchanged):
- Interval: 2 seconds
- Max wait: 60 seconds
- On timeout: provisioning fails, admin alerted

Tiger Claw API fleet health monitor (port 4000) continues to use `/healthz` for liveness checks. These serve different purposes and should not be conflated.

| Endpoint | Used by | Purpose |
|----------|---------|---------|
| `/healthz` | Tiger Claw API fleet monitor (every 30s) | Is the container process alive? |
| `/readyz` | `provisioner.ts` (at startup only) | Is the gateway fully ready to accept messages? |

## Consequences

**Positive:**
- Provisioning completes only when the container is truly ready.
- Eliminates race conditions where the onboarding message is sent before Telegram is connected.
- Aligns with Kubernetes best practices (readiness vs liveness probe distinction).

**Negative:**
- Slightly longer provisioning time (readiness takes longer than liveness).
- If `/readyz` is slow to return (cold start + heavy skill loading), provisioning may timeout. Monitor and adjust max wait if needed.

## Status of Implementation

Pending. Phase 0 Task P0-4 in `tasks/PHASE-0.md`.
