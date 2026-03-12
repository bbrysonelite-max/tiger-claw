// Tiger Claw — Bot Token Pool Service
// Pre-created Telegram bots assigned to customers at payment time.
// Customer never touches BotFather — LOCKED (Block 5.3 Decision 1)
//
// Tokens are stored AES-256-GCM encrypted in PostgreSQL.
// Encryption key: ENCRYPTION_KEY env var (any string, SHA-256 derived to 32 bytes).
//
// Lifecycle:
//   importToken  → validate → clearWebhook → insert as 'available'
//   getNextAvailable → select oldest available
//   assignToTenant   → status: 'assigned', records tenant_id + assigned_at
//   releaseBot       → reset display name/description via Telegram API → status: 'available'
//   retireBot        → status: 'retired' (token revoked or problem)
//
// Reset on release:
//   - deleteWebhook (clear any existing webhook)
//   - setMyName: "Tiger Claw Agent"
//   - setMyDescription: "Tiger Claw powered agent."
//   - setMyShortDescription: "Tiger Claw Agent"

import * as crypto from "crypto";
import * as https from "https";
import * as http from "http";
import {
  insertBotPoolEntry,
  getNextAvailableBotEntry,
  getBotPoolEntry,
  getBotPoolEntryByUsername,
  assignBotToTenant,
  releaseBotToPool,
  retireBotFromPool,
  getPoolCounts,
  type BotPoolEntry,
} from "./db.js";

// ---------------------------------------------------------------------------
// Encryption helpers
// AES-256-GCM with a 32-byte key derived from ENCRYPTION_KEY via SHA-256.
// Stored format: "enc:iv_hex:authtag_hex:ciphertext_hex"
// Plaintext fallback if ENCRYPTION_KEY is not set (dev/test only).
// ---------------------------------------------------------------------------

function getEncKey(): Buffer | null {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getEncKey();
  if (!key) {
    // ENCRYPTION_KEY not set — tokens stored as plaintext. Safe in dev only.
    // In production this is a critical security failure.
    console.error("[pool] SECURITY WARNING: ENCRYPTION_KEY not set. Bot tokens stored as PLAINTEXT. Set ENCRYPTION_KEY in production immediately.");
    return plaintext;
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith("enc:")) return stored; // plaintext (dev/test)

  const key = getEncKey();
  if (!key) throw new Error("ENCRYPTION_KEY not set but token is encrypted");

  const [, ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error("Malformed encrypted token");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// ---------------------------------------------------------------------------
// Telegram API helper — uses a specific bot token for API calls
// ---------------------------------------------------------------------------

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

function telegramRequest<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramResponse<T>> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: "api.telegram.org",
      path: `/bot${token}/${method}`,
      method: bodyStr ? "POST" : "GET",
      headers: {
        ...(bodyStr ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
        } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as TelegramResponse<T>);
        } catch {
          reject(new Error(`Non-JSON from Telegram (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Telegram request timed out")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Pool operations
// ---------------------------------------------------------------------------

export interface ImportResult {
  ok: boolean;
  botId?: string;
  username?: string;
  telegramBotId?: string;
  error?: string;
}

/**
 * Validate a token against Telegram getMe, clear its webhook,
 * and insert into the pool as 'available'.
 */
export async function importToken(token: string, phoneAccount?: string): Promise<ImportResult> {
  // Validate via getMe
  let getMeResult: TelegramResponse<{ id: number; username: string; first_name: string }>;
  try {
    getMeResult = await telegramRequest(token, "getMe");
  } catch (err) {
    return { ok: false, error: `Telegram unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!getMeResult.ok || !getMeResult.result) {
    return { ok: false, error: `Invalid token: ${getMeResult.description ?? "unknown error"}` };
  }

  const { id: botId, username } = getMeResult.result;

  // Clear any existing webhook so the pool bot doesn't receive conflicting updates
  try {
    await telegramRequest(token, "deleteWebhook", { drop_pending_updates: true });
  } catch {
    // Non-fatal — continue
  }

  // Encrypt and store
  const encryptedToken = encryptToken(token);
  try {
    const entry = await insertBotPoolEntry({
      botToken: encryptedToken,
      botUsername: username,
      telegramBotId: String(botId),
      phoneAccount,
    });
    return { ok: true, botId: entry.id, username, telegramBotId: String(botId) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Duplicate telegram_bot_id → already imported
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, error: `Bot @${username} (id: ${botId}) already in pool.` };
    }
    return { ok: false, error: `DB insert failed: ${msg}` };
  }
}

export interface BatchImportResult {
  imported: number;
  failed: number;
  results: ImportResult[];
}

/** Run importToken on each token, return summary. */
export async function importBatch(tokens: string[], phoneAccount?: string): Promise<BatchImportResult> {
  const results: ImportResult[] = [];
  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;
    results.push(await importToken(t, phoneAccount));
  }
  return {
    imported: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** Return the next available bot from the pool, or null if pool is empty. */
export async function getNextAvailable(): Promise<BotPoolEntry | null> {
  return getNextAvailableBotEntry();
}

/** Mark a bot as assigned to a tenant. */
export async function assignToTenant(botId: string, tenantId: string): Promise<void> {
  await assignBotToTenant(botId, tenantId);
}

/**
 * Reset bot identity via Telegram API and return to available pool.
 * Clears webhook, resets display name, description, short description.
 */
export async function releaseBot(botId: string): Promise<void> {
  const entry = await getBotPoolEntry(botId);
  if (!entry) throw new Error(`Bot pool entry ${botId} not found`);

  const token = decryptToken(entry.botToken);

  // Best-effort Telegram resets — don't throw if any fail
  const resets: Array<[string, Record<string, unknown>]> = [
    ["deleteWebhook", { drop_pending_updates: true }],
    ["setMyName", { name: "Tiger Claw Agent" }],
    ["setMyDescription", { description: "Tiger Claw powered agent." }],
    ["setMyShortDescription", { short_description: "Tiger Claw Agent" }],
  ];

  for (const [method, body] of resets) {
    try {
      await telegramRequest(token, method, body);
    } catch {
      // Non-fatal — bot identity reset is best-effort
    }
  }

  await releaseBotToPool(botId);
}

/** Permanently retire a bot (token revoked, reported, or problematic). */
export async function retireBot(botId: string): Promise<void> {
  await retireBotFromPool(botId);
}

/** Return counts: available, assigned, retired. */
export async function getPoolStatus(): Promise<{ available: number; assigned: number; retired: number }> {
  return getPoolCounts();
}

// Re-export for use in admin routes
export { getBotPoolEntry, getBotPoolEntryByUsername };

// ---------------------------------------------------------------------------
// Bot customization — call from tiger_onboard after naming ceremony
// Updates the assigned bot's display name and description.
// Called with the bot's own token so it can update itself.
// ---------------------------------------------------------------------------

export async function customizeBotIdentity(
  token: string,
  botName: string,
  description: string,
  shortDescription: string,
  languageCode?: string
): Promise<void> {
  const body = languageCode ? { language_code: languageCode } : {};

  const calls: Array<[string, Record<string, unknown>]> = [
    ["setMyName", { name: botName, ...body }],
    ["setMyDescription", { description, ...body }],
    ["setMyShortDescription", { short_description: shortDescription, ...body }],
  ];

  for (const [method, params] of calls) {
    try {
      const result = await telegramRequest(token, method, params);
      if (!result.ok) {
        console.warn(`[pool] ${method} returned not-ok: ${result.description}`);
      }
    } catch (err) {
      // Non-fatal — bot name update is best-effort
      console.warn(`[pool] ${method} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP request helper for internal API calls (non-Telegram)
// Used by pool alerts path in index.ts
// ---------------------------------------------------------------------------
export function httpPost(url: string, body: Record<string, unknown>, authToken: string): void {
  const parsed = new URL(url);
  const bodyStr = JSON.stringify(body);
  const lib = parsed.protocol === "https:" ? https : (http as unknown as typeof https);

  const req = lib.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        "Authorization": `Bearer ${authToken}`,
      },
    },
    () => {} // fire-and-forget
  );
  req.on("error", () => {});
  req.write(bodyStr);
  req.end();
}
