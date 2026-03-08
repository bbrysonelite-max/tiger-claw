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
import { runMigrations } from "./migrate.js";

// ---------------------------------------------------------------------------
// Connection pool
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env["DATABASE_URL"] ?? "postgresql://botcraft:REDACTED_DB_PASSWORD@localhost:5432/tiger_bot",
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
  await runMigrations();
  console.log("[db] Schema ready.");
}

// ---------------------------------------------------------------------------
// Tenant types + queries
// ---------------------------------------------------------------------------

export type TenantStatus =
  | "pending"
  | "onboarding"
  | "active"
  | "updating"
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
  whatsappEnabled: boolean;
  lineToken?: string;
  lineChannelSecret?: string;
  lineChannelAccessToken?: string;
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
    whatsappEnabled: (row["whatsapp_enabled"] as boolean) ?? false,
    lineToken: row["line_token"] as string | undefined,
    lineChannelSecret: row["line_channel_secret"] as string | undefined,
    lineChannelAccessToken: row["line_channel_access_token"] as string | undefined,
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
  eventOrAction: string | { action: string; tenantId?: string; details?: Record<string, unknown> },
  tenantId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  // Support both positional args and object form
  const action = typeof eventOrAction === "string" ? eventOrAction : eventOrAction.action;
  const tid = typeof eventOrAction === "string" ? tenantId : eventOrAction.tenantId;
  const det = typeof eventOrAction === "string" ? details : eventOrAction.details;
  await getPool().query(
    "INSERT INTO admin_events (action, tenant_id, details) VALUES ($1,$2,$3)",
    [action, tid ?? null, det ? JSON.stringify(det) : null]
  );
}

export interface AdminEvent {
  id: string;
  action: string;
  tenantId?: string;
  tenantName?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export async function getRecentAdminEvents(sinceHours = 24): Promise<AdminEvent[]> {
  const result = await getPool().query(
    `SELECT e.id, e.action, e.tenant_id, t.name AS tenant_name, e.details, e.created_at
     FROM admin_events e
     LEFT JOIN tenants t ON t.id = e.tenant_id
     WHERE e.created_at > NOW() - INTERVAL '1 hour' * $1
     ORDER BY e.created_at DESC
     LIMIT 200`,
    [sinceHours]
  );
  return result.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    action: r.action as string,
    tenantId: r.tenant_id as string | undefined,
    tenantName: r.tenant_name as string | undefined,
    details: r.details as Record<string, unknown> | undefined,
    createdAt: (r.created_at as Date).toISOString(),
  }));
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

// ---------------------------------------------------------------------------
// Bot pool queries
// Tokens are stored encrypted (see api/src/services/pool.ts for encrypt/decrypt).
// The raw encrypted string is stored here; pool.ts handles all crypto.
// ---------------------------------------------------------------------------

export type BotPoolStatus = "available" | "assigned" | "retired";

export interface BotPoolEntry {
  id: string;
  botToken: string;        // encrypted at rest — decrypt via pool.decryptToken()
  botUsername: string;
  telegramBotId: string;
  status: BotPoolStatus;
  phoneAccount?: string;
  createdAt: Date;
  assignedAt?: Date;
  tenantId?: string;
}

function rowToBotPoolEntry(row: Record<string, unknown>): BotPoolEntry {
  return {
    id: row["id"] as string,
    botToken: row["bot_token"] as string,
    botUsername: row["bot_username"] as string,
    telegramBotId: row["telegram_bot_id"] as string,
    status: row["status"] as BotPoolStatus,
    phoneAccount: row["phone_account"] as string | undefined,
    createdAt: new Date(row["created_at"] as string),
    assignedAt: row["assigned_at"] ? new Date(row["assigned_at"] as string) : undefined,
    tenantId: row["tenant_id"] as string | undefined,
  };
}

export async function insertBotPoolEntry(data: {
  botToken: string;        // already encrypted by caller
  botUsername: string;
  telegramBotId: string;
  phoneAccount?: string;
}): Promise<BotPoolEntry> {
  const result = await getPool().query(
    `INSERT INTO bot_pool (bot_token, bot_username, telegram_bot_id, phone_account)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.botToken, data.botUsername, data.telegramBotId, data.phoneAccount ?? null]
  );
  return rowToBotPoolEntry(result.rows[0]);
}

export async function getNextAvailableBotEntry(): Promise<BotPoolEntry | null> {
  const result = await getPool().query(
    `SELECT * FROM bot_pool WHERE status = 'available' ORDER BY created_at ASC LIMIT 1`
  );
  return result.rows[0] ? rowToBotPoolEntry(result.rows[0]) : null;
}

export async function getBotPoolEntry(id: string): Promise<BotPoolEntry | null> {
  const result = await getPool().query("SELECT * FROM bot_pool WHERE id = $1", [id]);
  return result.rows[0] ? rowToBotPoolEntry(result.rows[0]) : null;
}

export async function getBotPoolEntryByUsername(username: string): Promise<BotPoolEntry | null> {
  const result = await getPool().query(
    "SELECT * FROM bot_pool WHERE bot_username = $1",
    [username.replace(/^@/, "")]
  );
  return result.rows[0] ? rowToBotPoolEntry(result.rows[0]) : null;
}

export async function assignBotToTenant(botId: string, tenantId: string): Promise<void> {
  await getPool().query(
    `UPDATE bot_pool SET status='assigned', tenant_id=$1, assigned_at=NOW() WHERE id=$2`,
    [tenantId, botId]
  );
}

export async function releaseBotToPool(botId: string): Promise<void> {
  await getPool().query(
    `UPDATE bot_pool SET status='available', tenant_id=NULL, assigned_at=NULL WHERE id=$1`,
    [botId]
  );
}

export async function retireBotFromPool(botId: string): Promise<void> {
  await getPool().query(
    "UPDATE bot_pool SET status='retired' WHERE id=$1",
    [botId]
  );
}

export async function getPoolCounts(): Promise<{ available: number; assigned: number; retired: number }> {
  const result = await getPool().query(`
    SELECT status, COUNT(*)::int AS cnt
    FROM bot_pool
    GROUP BY status
  `);
  const counts = { available: 0, assigned: 0, retired: 0 };
  for (const row of result.rows) {
    const s = row["status"] as string;
    if (s === "available" || s === "assigned" || s === "retired") {
      counts[s] = row["cnt"] as number;
    }
  }
  return counts;
}

export async function listBotPool(status?: BotPoolStatus): Promise<BotPoolEntry[]> {
  const result = status
    ? await getPool().query("SELECT * FROM bot_pool WHERE status=$1 ORDER BY created_at ASC", [status])
    : await getPool().query("SELECT * FROM bot_pool ORDER BY created_at ASC");
  return result.rows.map(rowToBotPoolEntry);
}

/**
 * Atomically assign the oldest available bot token to a tenant.
 * Uses SELECT FOR UPDATE SKIP LOCKED to prevent race conditions
 * under concurrent provisioning.
 */
export async function assignBotToken(
  tenantId: string,
): Promise<{ botToken: string; botUsername: string } | null> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await client.query(
        `SELECT * FROM bot_pool
         WHERE status = 'available'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const row = result.rows[0];
      await client.query(
        `UPDATE bot_pool SET status = 'assigned', tenant_id = $1, assigned_at = NOW()
         WHERE id = $2`,
        [tenantId, row["id"]],
      );
      await client.query("COMMIT");

      return {
        botToken: row["bot_token"] as string,
        botUsername: row["bot_username"] as string,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}

/** Return the bot_token assigned to a tenant, or null. */
export async function getTenantBotToken(tenantId: string): Promise<string | null> {
  const result = await getPool().query(
    "SELECT bot_token FROM bot_pool WHERE tenant_id = $1 AND status = 'assigned' LIMIT 1",
    [tenantId],
  );
  return result.rows[0] ? (result.rows[0]["bot_token"] as string) : null;
}

/** Return the bot username assigned to a tenant, or null. */
export async function getTenantBotUsername(tenantId: string): Promise<string | null> {
  const result = await getPool().query(
    "SELECT bot_username FROM bot_pool WHERE tenant_id = $1 AND status = 'assigned' LIMIT 1",
    [tenantId],
  );
  return result.rows[0] ? (result.rows[0]["bot_username"] as string) : null;
}

/** Update a tenant's channel config (whatsapp, LINE fields). */
export async function updateTenantChannelConfig(
  id: string,
  config: {
    whatsappEnabled?: boolean;
    lineToken?: string | null;
    lineChannelSecret?: string | null;
    lineChannelAccessToken?: string | null;
  },
): Promise<void> {
  const sets: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let idx = 1;

  if (config.whatsappEnabled !== undefined) {
    sets.push(`whatsapp_enabled = $${idx++}`);
    values.push(config.whatsappEnabled);
  }
  if (config.lineToken !== undefined) {
    sets.push(`line_token = $${idx++}`);
    values.push(config.lineToken);
  }
  if (config.lineChannelSecret !== undefined) {
    sets.push(`line_channel_secret = $${idx++}`);
    values.push(config.lineChannelSecret);
  }
  if (config.lineChannelAccessToken !== undefined) {
    sets.push(`line_channel_access_token = $${idx++}`);
    values.push(config.lineChannelAccessToken);
  }

  values.push(id);
  await getPool().query(
    `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

/** Pool stats: total, assigned, unassigned counts. */
export async function getPoolStats(): Promise<{ total: number; assigned: number; unassigned: number }> {
  const result = await getPool().query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
      COUNT(*) FILTER (WHERE status = 'available')::int AS unassigned
    FROM bot_pool
    WHERE status != 'retired'
  `);
  const row = result.rows[0];
  return {
    total: (row["total"] as number) ?? 0,
    assigned: (row["assigned"] as number) ?? 0,
    unassigned: (row["unassigned"] as number) ?? 0,
  };
}

/** Simple insert into pool (no Telegram validation — use importToken for validated inserts). */
export async function addTokenToPool(botToken: string, botUsername: string): Promise<void> {
  await getPool().query(
    `INSERT INTO bot_pool (bot_token, bot_username, telegram_bot_id, status)
     VALUES ($1, $2, $2, 'available')`,
    [botToken, botUsername],
  );
}

// ---------------------------------------------------------------------------
// BYOK Architecture Queries (Tiger Claw V4.0)
// ---------------------------------------------------------------------------

export async function createBYOKUser(email: string, name?: string, stripeCustomerId?: string): Promise<string> {
  const result = await getPool().query(
    `INSERT INTO users (email, name, stripe_customer_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = $2, stripe_customer_id = COALESCE($3, users.stripe_customer_id)
     RETURNING id`,
    [email, name ?? null, stripeCustomerId ?? null]
  );
  return result.rows[0]["id"] as string;
}

export async function createBYOKBot(
  userId: string,
  name: string,
  niche: string,
  status: string = "pending"
): Promise<string> {
  const result = await getPool().query(
    `INSERT INTO bots (user_id, name, niche, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, name, niche, status]
  );
  return result.rows[0]["id"] as string;
}

export async function createBYOKConfig(data: {
  botId: string;
  connectionType: string;
  provider?: string;
  model?: string;
  encryptedKey?: string;
  keyPreview?: string;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO bot_ai_config (bot_id, connection_type, provider, model, encrypted_key, key_preview)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.botId,
      data.connectionType,
      data.provider ?? null,
      data.model ?? null,
      data.encryptedKey ?? null,
      data.keyPreview ?? null
    ]
  );
}

export async function createBYOKSubscription(data: {
  userId: string;
  botId: string;
  stripeSubscriptionId: string;
  planTier: string;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO subscriptions (user_id, bot_id, stripe_subscription_id, plan_tier, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [data.userId, data.botId, data.stripeSubscriptionId, data.planTier]
  );
}

export async function getBotState<T>(tenantId: string, stateKey: string): Promise<T | null> {
  const result = await getPool().query(
    "SELECT state_value FROM bot_states WHERE tenant_id = $1 AND state_key = $2",
    [tenantId, stateKey]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].state_value as T;
}

export async function setBotState(tenantId: string, stateKey: string, value: any): Promise<void> {
  await getPool().query(
    `INSERT INTO bot_states (tenant_id, state_key, state_value, updated_at) 
     VALUES ($1, $2, $3, NOW()) 
     ON CONFLICT (tenant_id, state_key) 
     DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()`,
    [tenantId, stateKey, value]
  );
}
