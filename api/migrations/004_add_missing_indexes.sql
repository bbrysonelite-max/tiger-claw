-- Migration 004: Add missing indexes for bot_states and key_events
-- These queries are called on every Telegram message and key rotation event.
-- Without indexes they do full table scans which degrade at scale.

-- getBotState / setBotState called on EVERY Telegram message (composite index covers both)
CREATE INDEX IF NOT EXISTS idx_bot_states_tenant_state
  ON bot_states(tenant_id, state_key);

-- key_events lookup by tenant (key rotation audit, report generation)
CREATE INDEX IF NOT EXISTS idx_key_events_tenant_id
  ON key_events(tenant_id);

-- admin_events lookup by tenant (GET /admin/fleet/:tenantId and daily reports)
CREATE INDEX IF NOT EXISTS idx_admin_events_tenant_id
  ON admin_events(tenant_id);

-- tenants lookup by email (used by getBYOKStatus and Stripe webhook flow)
CREATE INDEX IF NOT EXISTS idx_tenants_email
  ON tenants(email);
