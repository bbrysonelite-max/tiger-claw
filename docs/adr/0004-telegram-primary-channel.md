# ADR-0004: Telegram as Primary Channel

**Status:** Accepted
**Date:** 2026-02-27 | Updated: 2026-03-03
**Deciders:** Brent Bryson

## Context

Tiger Claw needs a reliable channel for: tenant onboarding interview (5 phases), daily briefings to the tenant, tenant Q&A with the agent, and platform admin operations.

Multiple channels were considered: Telegram, WhatsApp, SMS, email.

## Decision

Telegram is the primary channel for ALL tenant interactions:
- 5-phase onboarding interview
- Daily briefing (7 AM tenant timezone)
- Tenant Q&A and flywheel controls
- Channel Wizard link delivery

Telegram is NOT used for prospect outreach (at tenant discretion — tenants may configure it as an optional outreach channel, but it is not the default outreach mechanism).

## Why Telegram, Not WhatsApp

WhatsApp (via OpenClaw's Baileys integration) requires a QR code scan per deployment and sessions expire periodically. For a platform-provisioned service, Telegram's bot token model is the only approach that supports:
- Zero-friction provisioning (token assigned from pool, no human in the loop)
- Stable sessions (Telegram bot tokens don't expire)
- Bot name customization during onboarding
- No personal number required

## Update (2026-03-03)

A channel pivot was evaluated: moving to WhatsApp as primary. Determined not feasible because:
1. OpenClaw's WhatsApp uses Baileys (not Meta WABA) — requires QR scan, not bot token
2. Baileys sessions don't persist reliably across container restarts
3. The 60-second payment-to-live-bot target cannot be met with a manual QR scan step

**Decision confirmed:** Telegram stays primary. WhatsApp (Baileys) is optional outreach channel (see ADR-0005).

## Consequences

**Positive:**
- Zero-friction 60-second provisioning maintained.
- Bot token pool architecture works cleanly.
- Stable, reliable sessions.

**Negative:**
- Some markets prefer WhatsApp. Tenants must have Telegram installed.
- Tiger Claw cannot reach tenants who don't use Telegram.

## Status of Implementation

Implemented. Full Telegram channel config in `docker/customer/entrypoint.sh`. Bot pool in `api/src/services/pool.ts`.
