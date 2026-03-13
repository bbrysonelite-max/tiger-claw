#!/usr/bin/env ts-node
/**
 * Tiger Claw — create-bot-pool
 *
 * Automated Telegram bot creation through BotFather using MTProto (gramjs).
 * Logs into Telegram user accounts, creates bots via BotFather conversation,
 * and imports each token into the Tiger Claw pool via POST /admin/pool/import.
 *
 * Multi-account rotation:
 *   TELEGRAM_PHONE="phone1,phone2,phone3" — each account has its own session file.
 *   Script always picks the account with the earliest available-at timestamp.
 *   Three accounts with 7-min cooldowns → ~1 bot per 2.5 minutes.
 *
 * Usage:
 *   npx ts-node index.ts [--count 10] [--start 1] [--dry-run]
 *
 * Environment variables:
 *   TELEGRAM_API_ID      — from https://my.telegram.org (required)
 *   TELEGRAM_API_HASH    — from https://my.telegram.org (required)
 *   TELEGRAM_PHONE       — phone number(s), comma-separated (required)
 *   TIGER_CLAW_API_URL   — Tiger Claw API base URL (required — set TIGER_CLAW_API_URL env var)
 *   ADMIN_TOKEN          — Bearer token for Tiger Claw API (required)
 *   BOT_NAME_PREFIX      — prefix for display name (default: "Tiger Claw Agent")
 *   BOT_USERNAME_PREFIX  — prefix for @username (default: "TC_Agent")
 *   SESSIONS_DIR         — session file directory (default: ./sessions)
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import type { NewMessageEvent } from "telegram/events/NewMessage";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as readline from "readline";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface Config {
  apiId: number;
  apiHash: string;
  phones: string[];
  apiUrl: string;
  adminToken: string;
  count: number;
  startN: number;
  dryRun: boolean;
  botNamePrefix: string;
  botUsernamePrefix: string;
  sessionsDir: string;
  cooldownMs: number;   // milliseconds between bots per account (default 420s)
  botfatherTimeout: number; // ms to wait for BotFather reply
}

function loadConfig(): Config {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string): string => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1]! : fallback;
  };
  const hasFlag = (name: string) => args.includes(name);

  const apiId = parseInt(process.env["TELEGRAM_API_ID"] ?? "");
  const apiHash = process.env["TELEGRAM_API_HASH"] ?? "";
  const phonesRaw = process.env["TELEGRAM_PHONE"] ?? "";
  const adminToken = process.env["ADMIN_TOKEN"] ?? "";

  if (!apiId || !apiHash) {
    fatal("TELEGRAM_API_ID and TELEGRAM_API_HASH are required (get from https://my.telegram.org)");
  }
  if (!phonesRaw) {
    fatal("TELEGRAM_PHONE is required (comma-separated for multi-account)");
  }
  if (!adminToken) {
    fatal("ADMIN_TOKEN is required (Bearer token for Tiger Claw API)");
  }

  return {
    apiId,
    apiHash,
    phones: phonesRaw.split(",").map((p) => p.trim()).filter(Boolean),
    apiUrl: process.env["TIGER_CLAW_API_URL"] ?? (() => { throw new Error("[FATAL] TIGER_CLAW_API_URL environment variable is required"); })(),
    adminToken,
    count: parseInt(flag("--count", "10")),
    startN: parseInt(flag("--start", "0")),  // 0 = auto-detect from pool
    dryRun: hasFlag("--dry-run"),
    botNamePrefix: process.env["BOT_NAME_PREFIX"] ?? "Tiger Claw Agent",
    botUsernamePrefix: process.env["BOT_USERNAME_PREFIX"] ?? "TC_Agent",
    sessionsDir: process.env["SESSIONS_DIR"] ?? path.join(__dirname, "sessions"),
    cooldownMs: 420_000,   // 7 minutes per BotFather rate limit
    botfatherTimeout: 45_000, // 45 seconds to wait for a reply
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Account {
  phone: string;
  client: TelegramClient;
  sessionPath: string;
  availableAt: number; // epoch ms — when this account can create the next bot
}

interface CreateResult {
  success: boolean;
  token?: string;
  usernameTaken?: boolean;
  rateLimited?: boolean;
  retryAfterMs?: number;
  error?: string;
}

interface PoolImportResult {
  ok: boolean;
  username?: string;
  telegramBotId?: string;
  error?: string;
}

interface PoolStatusResult {
  counts: { available: number; assigned: number; retired: number };
  bots?: Array<{ username: string }>;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function fatal(msg: string): never {
  console.error(`[FATAL] ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function sessionPath(sessionsDir: string, phone: string): string {
  const normalized = phone.replace(/[^0-9+]/g, "");
  return path.join(sessionsDir, `${normalized}.session`);
}

function loadSession(sessionsDir: string, phone: string): StringSession {
  const p = sessionPath(sessionsDir, phone);
  try {
    if (fs.existsSync(p)) {
      const saved = fs.readFileSync(p, "utf8").trim();
      if (saved) return new StringSession(saved);
    }
  } catch { /* fall through */ }
  return new StringSession("");
}

function saveSession(sessionsDir: string, phone: string, client: TelegramClient): void {
  const p = sessionPath(sessionsDir, phone);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // gramjs session.save() returns string | void — cast through unknown
  const saved = client.session.save() as unknown as string | undefined;
  if (saved != null && saved !== "") fs.writeFileSync(p, saved, "utf8");
}

// ---------------------------------------------------------------------------
// Readline prompt (used for first-time auth only)
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ---------------------------------------------------------------------------
// Account initialization — connect + auth
// ---------------------------------------------------------------------------

async function initAccount(phone: string, config: Config): Promise<Account> {
  const session = loadSession(config.sessionsDir, phone);

  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    retryDelay: 2000,
    autoReconnect: true,
    // Suppress gramjs debug noise unless explicitly enabled
    baseLogger: {
      levels: ["error"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  log(`Connecting account ${phone}...`);

  await client.start({
    phoneNumber: async () => phone,
    password: async () => {
      return prompt(`[${phone}] Enter 2FA password: `);
    },
    phoneCode: async () => {
      return prompt(`[${phone}] Enter the verification code sent to ${phone}: `);
    },
    onError: (err: Error) => {
      log(`[${phone}] Auth error: ${err.message}`);
    },
  });

  // Persist session so we don't need the code on next run
  saveSession(config.sessionsDir, phone, client);
  log(`[${phone}] Connected and session saved.`);

  return {
    phone,
    client,
    sessionPath: sessionPath(config.sessionsDir, phone),
    availableAt: 0, // ready immediately
  };
}

// ---------------------------------------------------------------------------
// BotFather conversation helpers
// ---------------------------------------------------------------------------

const BOTFATHER_ID = BigInt("93372553");

/**
 * Register a one-shot event handler on `client` that resolves with the next
 * incoming message from @BotFather, or rejects on timeout.
 */
function waitForBotFather(client: TelegramClient, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeEventHandler(handler, eventFilter);
      reject(new Error(`BotFather did not respond within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventFilter = new NewMessage({ incoming: true } as any);

    const handler = async (event: NewMessageEvent) => {
      // Accept only messages from BotFather (id 93372553)
      const sender = event.message.senderId;
      // senderId may be a BigInt or a Peer — check both representations
      const isFromBotFather =
        (sender != null && BigInt(sender.toString()) === BOTFATHER_ID) ||
        event.message.peerId?.toString().includes("93372553");

      if (!isFromBotFather) return;

      clearTimeout(timer);
      client.removeEventHandler(handler, eventFilter);

      const text = event.message.message ?? "";
      resolve(text);
    };

    client.addEventHandler(handler, eventFilter);
  });
}

/**
 * Send a message to @BotFather and await its reply.
 * Registers the listener BEFORE sending to avoid a race condition.
 */
async function sendAndAwait(
  client: TelegramClient,
  message: string,
  timeoutMs: number
): Promise<string> {
  const replyPromise = waitForBotFather(client, timeoutMs);
  await client.sendMessage("@BotFather", { message });
  return replyPromise;
}

function isRateLimited(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("too many attempts") ||
    lower.includes("please try again later") ||
    lower.includes("i'm afraid") ||
    lower.includes("flood")
  );
}

function isUsernameTaken(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("already taken") ||
    lower.includes("try something different") ||
    lower.includes("sorry, this username")
  );
}

function extractToken(text: string): string | null {
  // BotFather token format: digits:alphanumeric_characters (35+ chars after colon)
  const match = text.match(/(\d{8,12}:[A-Za-z0-9_-]{35,})/);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------
// Core: create one bot via BotFather
// ---------------------------------------------------------------------------

async function createBot(
  account: Account,
  n: number,
  config: Config
): Promise<CreateResult> {
  const botName = `${config.botNamePrefix} ${n}`;
  const username = `${config.botUsernamePrefix}_${n}_bot`;

  if (config.dryRun) {
    log(`[dry-run] Would create "${botName}" @${username}`);
    await sleep(500); // Simulate a tiny delay
    return { success: true, token: `DRY_RUN_${n}:${"x".repeat(35)}` };
  }

  const { client, phone } = account;
  log(`[${phone}] Creating "${botName}" (@${username})...`);

  // ── Step 1: /newbot ──
  let reply: string;
  try {
    reply = await sendAndAwait(client, "/newbot", config.botfatherTimeout);
  } catch (err) {
    return { success: false, error: `Step 1 error: ${String(err)}` };
  }

  log(`[${phone}] BotFather: ${reply.slice(0, 80)}`);

  if (isRateLimited(reply)) {
    // Extract retry-after if BotFather provides it (it usually doesn't)
    return { success: false, rateLimited: true, retryAfterMs: 15 * 60_000 };
  }

  // BotFather asks for the full name
  if (
    !reply.toLowerCase().includes("how are you going to call it") &&
    !reply.toLowerCase().includes("what is this bot going to be called") &&
    !reply.toLowerCase().includes("alright") &&
    !reply.toLowerCase().includes("new bot")
  ) {
    // Unknown state — BotFather might be mid-conversation from a prior run.
    // Send /cancel to reset, then retry /newbot.
    log(`[${phone}] Unexpected /newbot reply — sending /cancel and retrying...`);
    try {
      const cancelReply = await sendAndAwait(client, "/cancel", config.botfatherTimeout);
      log(`[${phone}] Cancel reply: ${cancelReply.slice(0, 80)}`);
    } catch {
      // Ignore cancel errors
    }
    // Retry /newbot once after cancel
    try {
      reply = await sendAndAwait(client, "/newbot", config.botfatherTimeout);
    } catch (err) {
      return { success: false, error: `Step 1 retry error: ${String(err)}` };
    }
    if (isRateLimited(reply)) {
      return { success: false, rateLimited: true, retryAfterMs: 15 * 60_000 };
    }
  }

  // ── Step 2: Send bot display name ──
  try {
    reply = await sendAndAwait(client, botName, config.botfatherTimeout);
  } catch (err) {
    return { success: false, error: `Step 2 error: ${String(err)}` };
  }

  log(`[${phone}] BotFather: ${reply.slice(0, 80)}`);

  if (isRateLimited(reply)) {
    return { success: false, rateLimited: true, retryAfterMs: 15 * 60_000 };
  }

  // BotFather asks for a username
  if (
    !reply.toLowerCase().includes("username") &&
    !reply.toLowerCase().includes("now let's choose")
  ) {
    return {
      success: false,
      error: `Unexpected name reply (step 2): ${reply.slice(0, 200)}`,
    };
  }

  // ── Step 3: Send username ──
  try {
    reply = await sendAndAwait(client, username, config.botfatherTimeout);
  } catch (err) {
    return { success: false, error: `Step 3 error: ${String(err)}` };
  }

  log(`[${phone}] BotFather: ${reply.slice(0, 120)}`);

  if (isRateLimited(reply)) {
    return { success: false, rateLimited: true, retryAfterMs: 15 * 60_000 };
  }

  if (isUsernameTaken(reply)) {
    return { success: false, usernameTaken: true };
  }

  // ── Extract token ──
  const token = extractToken(reply);
  if (!token) {
    return {
      success: false,
      error: `No token found in reply (step 3): ${reply.slice(0, 300)}`,
    };
  }

  log(`[${phone}] ✅ Got token for @${username}`);
  return { success: true, token };
}

// ---------------------------------------------------------------------------
// Tiger Claw API — import token + read pool count
// ---------------------------------------------------------------------------

function apiRequest<T>(
  method: string,
  urlStr: string,
  adminToken: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = body != null ? JSON.stringify(body) : undefined;
    const lib = url.protocol === "https:" ? https : http;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${adminToken}`,
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(20_000, () => { req.destroy(); reject(new Error("API request timeout")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function importToPool(
  token: string,
  phoneAccount: string,
  config: Config
): Promise<PoolImportResult> {
  if (config.dryRun) {
    return { ok: true, username: "DRY_RUN", telegramBotId: "0" };
  }

  return apiRequest<PoolImportResult>(
    "POST",
    `${config.apiUrl}/admin/pool/import`,
    config.adminToken,
    { token, phoneAccount }
  );
}

async function getPoolStatus(config: Config): Promise<PoolStatusResult> {
  return apiRequest<PoolStatusResult>(
    "GET",
    `${config.apiUrl}/admin/pool`,
    config.adminToken
  );
}

/**
 * Query the pool to find the highest N already used in TC_Agent_N_bot usernames.
 * Returns 0 if none found.
 */
async function detectHighestN(config: Config): Promise<number> {
  try {
    const status = await getPoolStatus(config);
    if (!status.bots || status.bots.length === 0) return 0;

    const prefix = `${config.botUsernamePrefix}_`.toLowerCase();
    let highest = 0;

    for (const bot of status.bots) {
      const u = bot.username.toLowerCase().replace(/^@/, "");
      if (u.startsWith(prefix) && u.endsWith("_bot")) {
        const mid = u.slice(prefix.length, -4); // remove prefix and _bot
        const n = parseInt(mid, 10);
        if (!isNaN(n) && n > highest) highest = n;
      }
    }

    return highest;
  } catch (err) {
    log(`Warning: could not query pool to detect starting N: ${String(err)}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false;

function setupShutdown(accounts: Account[], startedAt: number, created: number): void {
  const handler = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`\n[shutdown] Ctrl+C received — shutting down gracefully.`);
    console.log(`[shutdown] Created ${created} bot(s) in ${elapsed}s.`);

    for (const account of accounts) {
      try {
        await account.client.disconnect();
        log(`[${account.phone}] Disconnected.`);
      } catch { /* ignore */ }
    }

    rl.close();
    process.exit(0);
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(`
╔══════════════════════════════════════════════════════════╗
║       Tiger Claw — Bot Pool Creator (MTProto)           ║
╚══════════════════════════════════════════════════════════╝

  API:         ${config.apiUrl}
  Accounts:    ${config.phones.length} (${config.phones.join(", ")})
  Count:       ${config.count} bots to create
  Dry run:     ${config.dryRun ? "YES — no real bots will be created" : "no"}
  Sessions:    ${config.sessionsDir}
`);

  if (config.dryRun) {
    log("[dry-run] Mode active — BotFather responses will be parsed but no bots created.");
  }

  // ── Initialize all accounts ──
  log(`Initializing ${config.phones.length} account(s)...`);
  const accounts: Account[] = [];

  for (const phone of config.phones) {
    try {
      const account = await initAccount(phone, config);
      accounts.push(account);
    } catch (err) {
      fatal(`Failed to initialize account ${phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Determine starting N ──
  let n = config.startN;
  if (n === 0) {
    log("Auto-detecting highest N from pool...");
    const highest = await detectHighestN(config);
    n = highest + 1;
    log(`Starting at N = ${n} (highest in pool: ${highest})`);
  } else {
    log(`Starting at N = ${n} (override via --start)`);
  }

  // ── Setup graceful shutdown ──
  let totalCreated = 0;
  const startedAt = Date.now();
  setupShutdown(accounts, startedAt, totalCreated);

  // ── Main creation loop ──
  log(`Starting creation loop — target: ${config.count} bot(s)...\n`);

  while (totalCreated < config.count && !shuttingDown) {
    // Pick the account with the earliest availableAt (round-robin with cooldown awareness)
    const account = accounts.reduce((best, a) => a.availableAt < best.availableAt ? a : best);

    // Wait if all accounts are in cooldown
    const waitMs = Math.max(0, account.availableAt - Date.now());
    if (waitMs > 0) {
      log(
        `All accounts cooling down. Next: ${account.phone} in ${formatDuration(waitMs)}. ` +
        `(${totalCreated}/${config.count} created)`
      );
      await sleep(waitMs);
    }

    if (shuttingDown) break;

    // ── Attempt to create the bot ──
    const result = await createBot(account, n, config);

    if (result.success && result.token) {
      // Import to pool
      const importResult = await importToPool(result.token, account.phone, config);

      if (importResult.ok) {
        // Get updated pool count
        let availableCount = "?";
        try {
          const status = await getPoolStatus(config);
          availableCount = String(status.counts.available);
        } catch { /* non-fatal */ }

        totalCreated++;
        log(
          `✅ [${totalCreated}/${config.count}] Created @${config.botUsernamePrefix}_${n}_bot` +
          ` — pool available: ${availableCount}`
        );

        // Set cooldown for this account
        account.availableAt = Date.now() + config.cooldownMs;
        log(
          `[${account.phone}] Cooling down for ${formatDuration(config.cooldownMs)} ` +
          `(next available: ${new Date(account.availableAt).toLocaleTimeString()})`
        );

        n++; // Advance to next bot number
      } else {
        log(`⚠️ Bot created but import failed: ${importResult.error ?? "unknown error"}`);
        log(`   Token: ${result.token.slice(0, 20)}... (save it manually!)`);
        // Still advance N and set cooldown — the bot exists in Telegram now
        account.availableAt = Date.now() + config.cooldownMs;
        n++;
      }
    } else if (result.usernameTaken) {
      log(`⚠️ Username @${config.botUsernamePrefix}_${n}_bot is taken — trying N=${n + 1}`);
      n++;
      // No cooldown needed for taken usernames — BotFather doesn't rate limit this
      // But add a small delay to be safe
      await sleep(2000);
    } else if (result.rateLimited) {
      const retryMs = result.retryAfterMs ?? 15 * 60_000;
      log(
        `🚫 [${account.phone}] Rate limited by BotFather. ` +
        `Cooling down for ${formatDuration(retryMs)}.`
      );
      account.availableAt = Date.now() + retryMs;

      // Check if ALL accounts are rate limited — if so, print a summary
      const allBlocked = accounts.every((a) => a.availableAt > Date.now());
      if (allBlocked) {
        const earliestMs = Math.min(...accounts.map((a) => a.availableAt)) - Date.now();
        log(`All accounts rate limited. Waiting ${formatDuration(earliestMs)} before next attempt.`);
      }
    } else {
      // Unrecoverable error
      log(`❌ Unrecoverable error: ${result.error ?? "unknown"}`);
      log(`   Stopping. Created ${totalCreated}/${config.count} bots.`);
      break;
    }
  }

  // ── Summary ──
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                    Creation Complete                    ║
╚══════════════════════════════════════════════════════════╝

  Created:  ${totalCreated} / ${config.count} bots
  Elapsed:  ${elapsed}s
  Mode:     ${config.dryRun ? "DRY RUN" : "production"}
`);

  // Show final pool status
  if (!config.dryRun) {
    try {
      const status = await getPoolStatus(config);
      console.log(
        `  Pool status:  ${status.counts.available} available,` +
        ` ${status.counts.assigned} assigned,` +
        ` ${status.counts.retired} retired`
      );
    } catch { /* non-fatal */ }
  }

  // ── Disconnect all accounts ──
  for (const account of accounts) {
    try {
      await account.client.disconnect();
    } catch { /* ignore */ }
  }

  rl.close();
  process.exit(totalCreated >= config.count ? 0 : 1);
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : String(err));
  rl.close();
  process.exit(1);
});
