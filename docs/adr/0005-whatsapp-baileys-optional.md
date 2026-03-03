# ADR-0005: WhatsApp (Baileys) as Optional Outreach Channel

**Status:** Accepted
**Date:** 2026-03-03
**Deciders:** Brent Bryson

## Context

Many tenants (especially in US market) conduct sales conversations on WhatsApp. Limiting Tiger Claw to Telegram for prospect outreach reduces the addressable market. However, WhatsApp provisioning is fundamentally different from Telegram.

Meta WhatsApp Business API (WABA) was evaluated as the official, compliant path. OpenClaw does not support WABA — only Baileys (WhatsApp Web, unofficial). WABA would require building a custom OpenClaw plugin, which is out of scope for v3.

## Decision

WhatsApp is available as an **optional outreach channel** in Tiger Claw v3 with the following constraints:

1. **Implementation:** OpenClaw's Baileys-based WhatsApp extension (`@openclaw/whatsapp`)
2. **Auth model:** Tenant brings their own WhatsApp number, authenticates via QR scan
3. **Default state:** Disabled. Tenant must opt in via Channel Wizard or in-chat command
4. **Provisioning model:** No platform number pool. Self-service only.
5. **Role:** Outreach to prospects only. Tenant admin interface stays on Telegram.

## ToS Risk (Non-Negotiable Disclosure)

Baileys is an unofficial WhatsApp Web automation library. WhatsApp's terms of service prohibit:
- Automated bulk messaging
- Cold outreach via personal accounts
- Use of unauthorized third-party clients

Tiger Claw must display a clear ToS disclosure before any tenant enables WhatsApp outreach. Tenants accept this risk explicitly. Guidance: use a dedicated phone number, not a personal number.

## Why Not Meta WABA

- OpenClaw does not support it (no plugin exists)
- Requires Tiger Claw to become a WhatsApp Business Solution Provider (BSP)
- Requires per-tenant Meta business verification
- Minimum 3-6 months to implement
- Added to the v4 roadmap

## Consequences

**Positive:**
- Tenants can reach prospects on WhatsApp without platform switching.
- Extends Tiger Claw's market reach.
- Self-service model keeps provisioning simple.

**Negative:**
- Baileys sessions expire; tenants may need to re-scan after container restarts.
- Numbers risk being banned for sales outreach.
- No platform guarantee of delivery — it's the tenant's personal number.

## Status of Implementation

Not yet implemented. Phase 3 in `TIGERCLAW-BLUEPRINT-v3.md`. See `tasks/PHASE-0.md` for current phase.
