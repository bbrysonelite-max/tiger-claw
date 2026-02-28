// Tiger Claw API — Database Layer
// Platform PostgreSQL: tenant registry + hive patterns
// TIGERCLAW-MASTER-SPEC-v2.md Block 1.4, Block 5.1
//
// Schema (auto-applied on startup via initSchema):
//   tenants     — tenant registry, lifecycle states, container metadata
//   hive_patterns — cross-tenant anonymous learning patterns (opt-in only)
//   key_events    — API key rotation log (platform-level)
//   admin_events  — audit log for admin actions

import { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Connection pool
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env["DATABASE_URL"] ?? "postgresql://botcraft:chatwoot123@localhost:5432/tiger_bot",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("[db] Pool error:", err.message);
    });
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

export async function initSchema(): Promise<void> {
  await withClient(async (client) => {
    await client.query(`
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
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Add canary_group column to existing deployments (idempotent)
      DO $$ BEGIN
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS canary_group BOOLEAN NOT NULL DEFAULT FALSE;
      END $$;

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

      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
      CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
      CREATE INDEX IF NOT EXISTS idx_hive_flavor_region ON hive_patterns(flavor, region);
      CREATE INDEX IF NOT EXISTS idx_hive_category ON hive_patterns(category);
    `);
  });
  console.log("[db] Schema ready.");
}

// ---------------------------------------------------------------------------
// Tenant types + queries
// ---------------------------------------------------------------------------

export type TenantStatus =
  | "pending"
  | "onboarding"
  | "active"
  | "paused"
  | "suspended"
  | "terminated";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  email?: string;
  status: TenantStatus;
  flavor: string;
  region: string;
  language: string;
  preferredChannel: string;
  botToken?: string;
  port?: number;
  containerId?: string;
  containerName?: string;
  onboardingKeyUsed: number;
  canaryGroup: boolean;
  lastActivityAt?: Date;
  suspendedAt?: Date;
  suspendedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

function rowToTenant(row: Record<string, unknown>): Tenant {
  return {
    id: row["id"] as string,
    slug: row["slug"] as string,
    name: row["name"] as string,
    email: row["email"] as string | undefined,
    status: row["status"] as TenantStatus,
    flavor: row["flavor"] as string,
    region: row["region"] as string,
    language: row["language"] as string,
    preferredChannel: row["preferred_channel"] as string,
    botToken: row["bot_token"] as string | undefined,
    port: row["port"] as number | undefined,
    containerId: row["container_id"] as string | undefined,
    containerName: row["container_name"] as string | undefined,
    onboardingKeyUsed: row["onboarding_key_used"] as number,
    canaryGroup: (row["canary_group"] as boolean) ?? false,
    lastActivityAt: row["last_activity_at"] ? new Date(row["last_activity_at"] as string) : undefined,
    suspendedAt: row["suspended_at"] ? new Date(row["suspended_at"] as string) : undefined,
    suspendedReason: row["suspended_reason"] as string | undefined,
    createdAt: new Date(row["created_at"] as string),
    updatedAt: new Date(row["updated_at"] as string),
  };
}

export async function createTenant(data: {
  slug: string;
  name: string;
  email?: string;
  flavor: string;
  region: string;
  language: string;
  preferredChannel: string;
  botToken?: string;
  port: number;
}): Promise<Tenant> {
  const containerName = `tiger-claw-${data.slug}`;
  const result = await getPool().query(
    `INSERT INTO tenants
       (slug, name, email, flavor, region, language, preferred_channel, bot_token, port, container_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [data.slug, data.name, data.email ?? null, data.flavor, data.region,
     data.language, data.preferredChannel, data.botToken ?? null, data.port, containerName]
  );
  return rowToTenant(result.rows[0]);
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const result = await getPool().query("SELECT * FROM tenants WHERE id = $1", [id]);
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const result = await getPool().query("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return result.rows[0] ? rowToTenant(result.rows[0]) : null;
}

export async function listTenants(status?: TenantStatus): Promise<Tenant[]> {
  const result = status
    ? await getPool().query("SELECT * FROM tenants WHERE status = $1 ORDER BY created_at DESC", [status])
    : await getPool().query("SELECT * FROM tenants ORDER BY created_at DESC");
  return result.rows.map(rowToTenant);
}

export async function updateTenantStatus(
  id: string,
  status: TenantStatus,
  extra?: { suspendedReason?: string; containerId?: string }
): Promise<void> {
  await getPool().query(
    `UPDATE tenants SET status=$1, updated_at=NOW(),
       suspended_at = CASE WHEN $1='suspended' THEN NOW() ELSE suspended_at END,
       suspended_reason = COALESCE($3, suspended_reason),
       container_id = COALESCE($4, container_id)
     WHERE id=$2`,
    [status, id, extra?.suspendedReason ?? null, extra?.containerId ?? null]
  );
}

export async function updateTenantActivity(id: string): Promise<void> {
  await getPool().query(
    "UPDATE tenants SET last_activity_at=NOW(), updated_at=NOW() WHERE id=$1",
    [id]
  );
}

export async function setCanaryGroup(id: string, inGroup: boolean): Promise<void> {
  await getPool().query(
    "UPDATE tenants SET canary_group=$1, updated_at=NOW() WHERE id=$2",
    [inGroup, id]
  );
}

export async function listCanaryTenants(): Promise<Tenant[]> {
  const result = await getPool().query(
    "SELECT * FROM tenants WHERE canary_group = TRUE ORDER BY created_at ASC"
  );
  return result.rows.map(rowToTenant);
}

export async function getNextAvailablePort(): Promise<number> {
  const result = await getPool().query(
    "SELECT COALESCE(MAX(port), 18800) + 1 AS next_port FROM tenants"
  );
  return result.rows[0]["next_port"] as number;
}

export async function logAdminEvent(
  action: string,
  tenantId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  await getPool().query(
    "INSERT INTO admin_events (action, tenant_id, details) VALUES ($1,$2,$3)",
    [action, tenantId ?? null, details ? JSON.stringify(details) : null]
  );
}

// ---------------------------------------------------------------------------
// Hive pattern queries
// ---------------------------------------------------------------------------

export interface HivePattern {
  id: string;
  flavor: string;
  region: string;
  category: string;
  observation: string;
  dataPoints: number;
  confidence: number;
  anonymous: boolean;
  submittedAt: Date;
}

function rowToPattern(row: Record<string, unknown>): HivePattern {
  return {
    id: row["id"] as string,
    flavor: row["flavor"] as string,
    region: row["region"] as string,
    category: row["category"] as string,
    observation: row["observation"] as string,
    dataPoints: row["data_points"] as number,
    confidence: row["confidence"] as number,
    anonymous: row["anonymous"] as boolean,
    submittedAt: new Date(row["submitted_at"] as string),
  };
}

export async function queryHivePatterns(params: {
  flavor: string;
  region?: string;
  category?: string;
  limit?: number;
}): Promise<HivePattern[]> {
  const conditions: string[] = ["flavor = $1", "approved = TRUE"];
  const values: unknown[] = [params.flavor];
  let idx = 2;

  if (params.region) { conditions.push(`region = $${idx++}`); values.push(params.region); }
  if (params.category) { conditions.push(`category = $${idx++}`); values.push(params.category); }

  const limit = Math.min(params.limit ?? 10, 50);
  const result = await getPool().query(
    `SELECT * FROM hive_patterns WHERE ${conditions.join(" AND ")}
     ORDER BY confidence DESC, data_points DESC
     LIMIT $${idx}`,
    [...values, limit]
  );
  return result.rows.map(rowToPattern);
}

export async function insertHivePattern(data: {
  flavor: string;
  region: string;
  category: string;
  observation: string;
  dataPoints: number;
  confidence: number;
  tenantHash?: string;
}): Promise<HivePattern> {
  const result = await getPool().query(
    `INSERT INTO hive_patterns
       (flavor, region, category, observation, data_points, confidence, anonymous, tenant_hash)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)
     RETURNING *`,
    [data.flavor, data.region, data.category, data.observation,
     data.dataPoints, data.confidence, data.tenantHash ?? null]
  );
  return rowToPattern(result.rows[0]);
}
