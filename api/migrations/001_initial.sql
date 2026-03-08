CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  flavor          TEXT NOT NULL DEFAULT 'network-marketer',
  region          TEXT NOT NULL DEFAULT 'us-en',
  language        TEXT NOT NULL DEFAULT 'en',
  preferred_channel TEXT NOT NULL DEFAULT 'telegram',
  bot_token       TEXT,
  port            INTEGER UNIQUE,
  container_id    TEXT,
  container_name  TEXT,
  onboarding_key_used INTEGER NOT NULL DEFAULT 0,
  canary_group    BOOLEAN NOT NULL DEFAULT FALSE,
  last_activity_at TIMESTAMPTZ,
  suspended_at    TIMESTAMPTZ,
  suspended_reason TEXT,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  line_token      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hive_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flavor          TEXT NOT NULL,
  region          TEXT NOT NULL,
  category        TEXT NOT NULL,
  observation     TEXT NOT NULL,
  data_points     INTEGER NOT NULL DEFAULT 1,
  confidence      INTEGER NOT NULL DEFAULT 50,
  anonymous       BOOLEAN NOT NULL DEFAULT TRUE,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_hash     TEXT,
  approved        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS key_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  layer           INTEGER,
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT NOT NULL,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_pool (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_token       TEXT NOT NULL UNIQUE,
  bot_username    TEXT NOT NULL,
  telegram_bot_id TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'available',
  phone_account   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at     TIMESTAMPTZ,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_hive_flavor_region ON hive_patterns(flavor, region);
CREATE INDEX IF NOT EXISTS idx_hive_category ON hive_patterns(category);
CREATE INDEX IF NOT EXISTS idx_bot_pool_status ON bot_pool(status);
CREATE INDEX IF NOT EXISTS idx_bot_pool_tenant_id ON bot_pool(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bot_pool_assignment ON bot_pool(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS bot_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  state_key TEXT NOT NULL,
  state_value JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, state_key)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  status TEXT DEFAULT 'pending', 
  telegram_bot_token TEXT,
  telegram_username TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  deployed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bot_ai_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID REFERENCES bots(id) UNIQUE,
  connection_type TEXT NOT NULL, 
  provider TEXT, 
  model TEXT,
  encrypted_key TEXT, 
  key_iv TEXT, 
  key_preview TEXT, 
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  bot_id UUID REFERENCES bots(id),
  stripe_subscription_id TEXT UNIQUE,
  plan_tier TEXT NOT NULL, 
  status TEXT NOT NULL, 
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
