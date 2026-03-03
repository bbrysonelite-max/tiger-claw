# ADR-0001: Per-Tenant SQLite for Prospect Data

**Status:** Accepted
**Date:** 2026-02-27
**Deciders:** Brent Bryson

## Context

Tiger Claw is a multi-tenant platform where each tenant's prospect data (leads, nurture state, contact history, aftercare records) must be completely isolated. Early versions (v4) used a shared PostgreSQL database with tenant-scoped rows.

## Decision

Each tenant container runs its own SQLite database inside the container's data volume. Shared PostgreSQL is used only for platform-level operations: tenant registry, billing, bot pool, admin events, hive patterns.

## Consequences

**Positive:**
- Complete data isolation between tenants by design. No tenant can ever see another tenant's prospects.
- No database connection pooling overhead. Each container owns its DB.
- Trivially portable — SQLite file is part of the container's data volume. Backup = copy file.
- Consistent with OpenClaw's own architecture (OpenClaw uses SQLite for session data).

**Negative:**
- Cross-tenant analytics require aggregation across multiple SQLite files (Hive patterns use this).
- No shared prospect deduplication across tenants without the Hive pattern system.

## Status of Implementation

Implemented. `tiger_score.ts` uses `leads.json` (not yet migrated to SQLite). Full SQLite schema migration is pending but the architectural decision is locked.
