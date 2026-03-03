# Architectural Decision Records

This directory contains the Architectural Decision Records (ADRs) for Tiger Claw.

Each ADR documents a significant architectural decision: the context that led to it, the decision made, and the consequences. ADRs are immutable once accepted — new decisions create new ADRs rather than modifying old ones.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](0001-per-tenant-sqlite.md) | Per-Tenant SQLite for Prospect Data | Accepted | 2026-02-27 |
| [0002](0002-four-layer-key-management.md) | Four-Layer API Key Management | Accepted | 2026-02-27 |
| [0003](0003-scoring-threshold-80.md) | Lead Scoring Threshold Fixed at 80 | Accepted — Immutable | 2026-02-27 |
| [0004](0004-telegram-primary-channel.md) | Telegram as Primary Channel | Accepted | 2026-02-27 |
| [0005](0005-whatsapp-baileys-optional.md) | WhatsApp (Baileys) as Optional Outreach Channel | Accepted | 2026-03-03 |
| [0006](0006-openclaw-update-pipeline.md) | OpenClaw Update Pipeline — Rebuild and Rolling Replace | Accepted | 2026-03-03 |
| [0007](0007-secretref-key-rotation.md) | SecretRef for Layer 2/3/4 Key Rotation | Accepted | 2026-03-03 |
| [0008](0008-readyz-for-provisioning.md) | Use `/readyz` for Container Provisioning Readiness | Accepted | 2026-03-03 |
| [0009](0009-explicit-streaming-off.md) | Telegram Streaming Explicitly Disabled | Accepted — Immutable | 2026-03-03 |
| [0010](0010-explicit-think-low.md) | Thinking Level Explicitly Set to Low | Accepted | 2026-03-03 |

## How to Add a New ADR

1. Create a new file: `NNNN-short-title.md` (next number in sequence)
2. Use this template:

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Deciders:** [names]

## Context
[What is the situation that forced this decision?]

## Decision
[What was decided?]

## Consequences
[What are the positive and negative results?]

## Status of Implementation
[Is this built? Pending? In what phase?]
```

3. Add it to the index above
4. Commit to GitHub immediately — ADRs are the source of truth
