# ADR-0009: Telegram Streaming Explicitly Disabled

**Status:** Accepted — IMMUTABLE
**Date:** 2026-03-03
**Deciders:** Brent Bryson

## Context

OpenClaw v2026.3.2 changed the default value of `channels.telegram.streaming` from `"off"` to `"partial"`. New containers built on this version will stream partial messages to users as the LLM generates them.

For Tiger Claw's use cases, streaming partial messages is not appropriate:
- Prospect outreach messages (first contact, nurture) must arrive as complete, coherent messages — a partially streamed sales message breaks the conversational flow
- Daily briefings to tenants can tolerate streaming, but consistency across all message types is more important

## Decision

All generated `openclaw.json` files must include:
```json5
{
  channels: {
    telegram: {
      streaming: "off"
    }
  }
}
```

This is an explicit override. It does not rely on the OpenClaw default. Future OpenClaw updates that change this default will not affect Tiger Claw containers.

## Consequences

**Positive:**
- Consistent message delivery behavior across all OpenClaw versions.
- Prospect messages arrive as complete, polished text.
- No risk of partial-message delivery during sales conversations.

**Negative:**
- Tenant Q&A sessions don't benefit from streaming preview (lower perceived responsiveness).
- This will be revisited if Tiger Claw ever supports per-account streaming config (tenant chat vs. prospect outreach on separate Telegram accounts).

## Agent Rule

`entrypoint.sh` must always set `channels.telegram.streaming: "off"`. If you see it absent or set to any other value, fix it. Never remove this line.

## Status of Implementation

Pending. Phase 0 Task P0-5 in `tasks/PHASE-0.md`.
