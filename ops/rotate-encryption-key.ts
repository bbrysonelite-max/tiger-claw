#!/usr/bin/env npx tsx
/**
 * Tiger Claw — Encryption Key Rotation Script
 *
 * Re-encrypts all bot tokens (bot_pool) and BYOK API keys (bot_ai_config)
 * from the old ENCRYPTION_KEY to a new one.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> DATABASE_URL=<url> npx tsx ops/rotate-encryption-key.ts
 *
 * Run from the project root. Safe to run multiple times (idempotent).
 */

import * as crypto from "crypto";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const OLD_RAW = process.env["OLD_ENCRYPTION_KEY"];
const NEW_RAW = process.env["NEW_ENCRYPTION_KEY"];
const DB_URL  = process.env["DATABASE_URL"];

if (!OLD_RAW) { console.error("[FATAL] OLD_ENCRYPTION_KEY must be set"); process.exit(1); }
if (!NEW_RAW) { console.error("[FATAL] NEW_ENCRYPTION_KEY must be set"); process.exit(1); }
if (!DB_URL)  { console.error("[FATAL] DATABASE_URL must be set"); process.exit(1); }
if (OLD_RAW === NEW_RAW) { console.error("[FATAL] OLD and NEW keys must be different"); process.exit(1); }

// ---------------------------------------------------------------------------
// Crypto helpers (matches pool.ts format: enc:{iv}:{authtag}:{ciphertext})
// ---------------------------------------------------------------------------

function deriveKey(raw: string): Buffer {
  return crypto.createHash("sha256").update(raw).digest();
}

function decrypt(stored: string, key: Buffer): string {
  if (!stored.startsWith("enc:")) return stored; // plaintext pass-through
  const [, ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error(`Malformed token: ${stored.slice(0, 20)}...`);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).toString("utf8");
}

function encryptWith(plaintext: string, key: Buffer): string {
  const iv         = crypto.randomBytes(16);
  const cipher     = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function reencrypt(stored: string, oldKey: Buffer, newKey: Buffer): string {
  return encryptWith(decrypt(stored, oldKey), newKey);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const oldKey = deriveKey(OLD_RAW!);
  const newKey = deriveKey(NEW_RAW!);
  const pool   = new Pool({ connectionString: DB_URL });

  let errors = 0;

  // ── bot_pool.bot_token ────────────────────────────────────────────────────
  console.log("\n[1/2] Rotating bot_pool tokens...");
  const poolRows = await pool.query<{ id: string; bot_token: string }>(
    `SELECT id, bot_token FROM bot_pool`
  );
  console.log(`  Found ${poolRows.rows.length} rows.`);

  for (const row of poolRows.rows) {
    try {
      const rotated = reencrypt(row.bot_token, oldKey, newKey);
      await pool.query(`UPDATE bot_pool SET bot_token = $1 WHERE id = $2`, [rotated, row.id]);
    } catch (err: any) {
      console.error(`  ERROR on bot_pool id=${row.id}: ${err.message}`);
      errors++;
    }
  }
  console.log(`  Done. ${poolRows.rows.length - errors} rotated, ${errors} errors.`);

  // ── bot_ai_config.encrypted_key ───────────────────────────────────────────
  console.log("\n[2/2] Rotating bot_ai_config encrypted keys...");
  const aiRows = await pool.query<{ id: string; encrypted_key: string }>(
    `SELECT id, encrypted_key FROM bot_ai_config WHERE encrypted_key IS NOT NULL`
  );
  console.log(`  Found ${aiRows.rows.length} rows.`);

  let aiErrors = 0;
  for (const row of aiRows.rows) {
    try {
      const rotated = reencrypt(row.encrypted_key, oldKey, newKey);
      await pool.query(`UPDATE bot_ai_config SET encrypted_key = $1 WHERE id = $2`, [rotated, row.id]);
    } catch (err: any) {
      console.error(`  ERROR on bot_ai_config id=${row.id}: ${err.message}`);
      aiErrors++;
    }
  }
  console.log(`  Done. ${aiRows.rows.length - aiErrors} rotated, ${aiErrors} errors.`);

  await pool.end();

  const totalErrors = errors + aiErrors;
  console.log("\n─────────────────────────────────────────");
  if (totalErrors > 0) {
    console.error(`[FAILED] ${totalErrors} error(s). Fix before updating ENCRYPTION_KEY in production.`);
    process.exit(1);
  }

  console.log("[SUCCESS] All tokens re-encrypted with new key.");
  console.log("\nNext: update ENCRYPTION_KEY in GCP Secret Manager and redeploy.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
