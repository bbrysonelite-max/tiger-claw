# ADR-0010: Thinking Level Explicitly Set to Low

**Status:** Accepted
**Date:** 2026-03-03
**Deciders:** Brent Bryson

## Context

OpenClaw v2026.3.1 changed the default thinking level for Anthropic Claude 4.6 models to `"adaptive"`. Adaptive thinking uses extended reasoning on complex queries. It produces higher quality responses but significantly increases token usage and cost per call.

Tiger Claw's flywheel runs automated tools frequently:
- `tiger_scout` — runs daily (5 AM)
- `tiger_briefing` — runs daily (7 AM)
- `tiger_contact` — runs for each qualified lead
- `tiger_nurture` — 8 touches over 30 days per lead
- `tiger_aftercare` — ongoing per converted contact

At 100 tenants with 5 active leads each in nurture, adaptive thinking would generate thousands of extended-reasoning calls per day with no benefit over standard reasoning for these use cases.

## Decision

All generated `openclaw.json` files must include:
```json5
{
  agents: {
    defaults: {
      thinkingDefault: "low"
    }
  }
}
```

> **Note (P0-5b):** The correct config key is `thinkingDefault`, not `think`.
> `think` is a display/template alias only. Source: docs.openclaw.ai/gateway/configuration-reference

This is an explicit override that does not rely on the OpenClaw default.

## Cost Rationale

`adaptive` thinking can use 3-10x more tokens per call than `low` thinking for complex prompts. At 1,000 tenants, the difference between `low` and `adaptive` could be the difference between a sustainable platform and an unprofitable one.

## When Adaptive Thinking Is Appropriate

If a specific Tiger Claw tool genuinely needs deeper reasoning (e.g., `tiger_objection` handling complex multi-part objections), it can override at the tool level. This is a per-tool decision, not a platform default.

## Agent Rule

`entrypoint.sh` must always set `agents.defaults.thinkingDefault: "low"`. Never remove this line. Never set it to `"adaptive"` at the platform level.

## Status of Implementation

Complete. Implemented in `docker/customer/entrypoint.sh` (P0-5/P0-5b). Config key corrected from `think` to `thinkingDefault` during P0-5b.
