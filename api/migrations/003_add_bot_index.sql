-- 003_add_bot_index.sql
-- Performance index for findOrCreateBYOKBot idempotent lookup.
--
-- findOrCreateBYOKBot runs a query:
--   WHERE user_id = $1 AND niche = $2 AND status = 'pending' ORDER BY created_at DESC LIMIT 1
--
-- Without this index, every wizard Step 2 submit does a full table scan on bots.
-- With 1000+ tenants this becomes a performance problem at scale.

CREATE INDEX IF NOT EXISTS idx_bots_user_niche_status
    ON bots (user_id, niche, status, created_at DESC);
