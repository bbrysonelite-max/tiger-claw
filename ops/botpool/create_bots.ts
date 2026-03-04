#!/usr/bin/env npx tsx
// Tiger Claw — Bot Pool Token Loader
//
// Three paths for populating the bot token pool:
//
// 1. --file ./tokens.json
//    Reads a JSON file of pre-created { botToken, botUsername } pairs
//    and inserts them via the API. For manual batch imports.
//
// 2. --tokens-file ./tokens.txt
//    Reads a plain-text file with one raw bot token per line.
//    Fetches the bot username automatically via Telegram's getMe API.
//    No manual JSON formatting required.
//
// 3. --mtproto --sessions ./sessions.json --count 50
//    Automated BotFather creation via GramJS MTProto.
//    Rotates across multiple Telegram accounts with flood-wait handling.
//
// Usage:
//   npx tsx ops/botpool/create_bots.ts --file ./tokens.json
//   npx tsx ops/botpool/create_bots.ts --tokens-file ./tokens.txt
//   npx tsx ops/botpool/create_bots.ts --mtproto --sessions ./sessions.json --count 50
//   npx tsx ops/botpool/create_bots.ts --mtproto --sessions ./sessions.json --count 50 --delay 480
//
// Session strings are generated via:
//   npx tsx ops/botpool/auth_session.ts --api-id <id> --api-hash <hash>

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenEntry {
  botToken: string;
  botUsername: string;
}

interface SessionEntry {
  accountLabel: string;
  sessionString: string;
}

interface AccountState {
  entry: SessionEntry;
  lastUsedAt: number;
  floodUntil: number;
}

// ---------------------------------------------------------------------------
// Constants & config
// ---------------------------------------------------------------------------

const API_BASE = process.env["TIGER_CLAW_API_URL"] ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";
const BOTFATHER_PEER = "BotFather";
const TOKEN_REGEX = /(\d{8,12}:[A-Za-z0-9_-]{35,})/;
const NAME_RETRY_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flag(name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1]! : fallback;
}
function hasFlag(name: string): boolean {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomAlphanumeric(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function formatDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

async function postToPool(botToken: string, botUsername: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/admin/pool/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      },
      body: JSON.stringify({ botToken, botUsername }),
    });
    if (resp.ok) return true;
    const body = await resp.json().catch(() => ({}));
    console.error(`  FAIL: @${botUsername} — ${(body as Record<string, string>).error ?? resp.statusText}`);
    return false;
  } catch (err) {
    console.error(`  FAIL: @${botUsername} — ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Path 1: File import (unchanged from original)
// ---------------------------------------------------------------------------

async function addTokensFromFile(filePath: string): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  let entries: TokenEntry[];
  try {
    const raw = fs.readFileSync(resolved, "utf8");
    entries = JSON.parse(raw) as TokenEntry[];
  } catch (err) {
    console.error(`Failed to parse ${resolved}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    console.error("JSON file must contain a non-empty array of { botToken, botUsername } objects.");
    process.exit(1);
  }

  console.log(`Loading ${entries.length} tokens from ${resolved}`);

  let success = 0;
  let failed = 0;

  for (const entry of entries) {
    if (!entry.botToken || !entry.botUsername) {
      console.error("  SKIP: missing botToken or botUsername in entry");
      failed++;
      continue;
    }

    const ok = await postToPool(entry.botToken, entry.botUsername);
    if (ok) {
      console.log(`  OK: @${entry.botUsername}`);
      success++;
    } else {
      failed++;
    }
  }

  console.log(`\nDone: ${success} imported, ${failed} failed.`);
}

// ---------------------------------------------------------------------------
// Path 2: Plain-text token file import (auto-resolves usernames via getMe)
// ---------------------------------------------------------------------------

async function addTokensFromTextFile(filePath: string): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(resolved, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (lines.length === 0) {
    console.error("No tokens found in file (blank lines and # comments are ignored).");
    process.exit(1);
  }

  console.log(`Found ${lines.length} token(s) in ${resolved}\n`);

  let success = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const token = lines[i]!;

    let username: string;
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (!resp.ok) {
        console.error(`  SKIP [${i + 1}/${lines.length}]: getMe returned ${resp.status} — token may be invalid`);
        skipped++;
        continue;
      }
      const data = (await resp.json()) as { ok: boolean; result?: { username?: string } };
      if (!data.ok || !data.result?.username) {
        console.error(`  SKIP [${i + 1}/${lines.length}]: getMe response missing username`);
        skipped++;
        continue;
      }
      username = data.result.username;
    } catch (err) {
      console.error(`  SKIP [${i + 1}/${lines.length}]: getMe failed — ${err instanceof Error ? err.message : err}`);
      skipped++;
      continue;
    }

    const ok = await postToPool(token, username);
    if (ok) {
      console.log(`  OK [${i + 1}/${lines.length}]: @${username}`);
      success++;
    } else {
      skipped++;
    }
  }

  console.log(`\nDone: ${success} imported, ${skipped} skipped.`);
}

// ---------------------------------------------------------------------------
// Path 3: MTProto automated creation
// ---------------------------------------------------------------------------

async function createBotsViaMTProto(
  sessionsPath: string,
  count: number,
  delaySeconds: number,
  apiId: number,
  apiHash: string,
): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");

  const MIN_DELAY_MS = delaySeconds * 1000;

  // Load sessions
  const resolved = path.resolve(sessionsPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Sessions file not found: ${resolved}`);
    process.exit(1);
  }

  let sessionEntries: SessionEntry[];
  try {
    sessionEntries = JSON.parse(fs.readFileSync(resolved, "utf8")) as SessionEntry[];
  } catch (err) {
    console.error(`Failed to parse sessions file: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (!Array.isArray(sessionEntries) || sessionEntries.length === 0) {
    console.error("Sessions file must contain a non-empty array of { accountLabel, sessionString }.");
    process.exit(1);
  }

  const accounts: AccountState[] = sessionEntries.map((entry) => ({
    entry,
    lastUsedAt: 0,
    floodUntil: 0,
  }));

  console.log(`[${ts()}] MTProto mode — ${accounts.length} account(s), creating ${count} bots`);
  console.log(`[${ts()}] Delay between reuses of same account: ${formatDuration(MIN_DELAY_MS)}\n`);

  let created = 0;

  for (let i = 0; i < count; i++) {
    if (created >= count) break;

    // Pick account with smallest lastUsedAt that isn't flood-blocked
    const now = Date.now();
    const eligible = accounts.filter((a) => a.floodUntil <= now);

    if (eligible.length === 0) {
      const earliest = Math.min(...accounts.map((a) => a.floodUntil));
      const waitMs = earliest - now;
      console.log(`[${ts()}] All accounts flood-blocked. Waiting ${formatDuration(waitMs)}...`);
      await sleep(waitMs);
      i--;
      continue;
    }

    eligible.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const account = eligible[0]!;

    // Enforce per-account delay
    const timeSinceUse = now - account.lastUsedAt;
    const waitMs = MIN_DELAY_MS - timeSinceUse;
    if (waitMs > 0 && account.lastUsedAt > 0) {
      console.log(`[${ts()}] [${account.entry.accountLabel}] waiting ${formatDuration(waitMs)} before next use...`);
      await sleep(waitMs);
    }

    // Connect
    let client: InstanceType<typeof TelegramClient>;
    try {
      const session = new StringSession(account.entry.sessionString);
      client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 3,
        retryDelay: 2000,
      });
      await client.connect();
    } catch (err) {
      console.error(`[${ts()}] [${account.entry.accountLabel}] Connection failed: ${err instanceof Error ? err.message : err}`);
      account.floodUntil = Date.now() + 60_000;
      i--;
      continue;
    }

    // Attempt bot creation
    const result = await attemptCreateBot(client, account.entry.accountLabel);

    // Always disconnect (preserves session)
    try { await client.disconnect(); } catch { /* ignore */ }

    if (result.success && result.token && result.username) {
      // POST to pool
      const ok = await postToPool(result.token, result.username);
      created++;
      account.lastUsedAt = Date.now();

      const nextAccountLabel = findNextAccount(accounts, MIN_DELAY_MS);
      console.log(
        `[${ts()}] [${created}/${count}] @${result.username} created` +
        ` (${account.entry.accountLabel}, ${nextAccountLabel})`,
      );

      if (!ok) {
        console.log(`  WARNING: bot created in Telegram but pool import failed. Token: ${result.token.slice(0, 25)}...`);
      }
    } else if (result.nameTaken) {
      console.log(`[${ts()}] [${account.entry.accountLabel}] Name/username taken — retrying with new name in ${formatDuration(NAME_RETRY_DELAY_MS)}...`);
      await sleep(NAME_RETRY_DELAY_MS);
      account.lastUsedAt = Date.now();
      i--;
    } else if (result.floodWait) {
      const blockMs = (result.floodWaitSeconds ?? 900) * 1000;
      account.floodUntil = Date.now() + blockMs;
      console.log(`[${ts()}] [${account.entry.accountLabel}] Flood wait — blocked for ${formatDuration(blockMs)}`);
      i--;
    } else {
      console.error(`[${ts()}] [${account.entry.accountLabel}] Error: ${result.error ?? "unknown"}`);
      account.lastUsedAt = Date.now();
      i--;
      await sleep(NAME_RETRY_DELAY_MS);
    }
  }

  console.log(`\n[${ts()}] Done: ${created}/${count} bots created.`);
}

function findNextAccount(accounts: AccountState[], minDelay: number): string {
  const now = Date.now();
  const eligible = accounts.filter((a) => a.floodUntil <= now);
  if (eligible.length === 0) return "all blocked";
  eligible.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const next = eligible[0]!;
  const waitMs = Math.max(0, minDelay - (now - next.lastUsedAt));
  return waitMs > 0
    ? `next: ${next.entry.accountLabel} in ${formatDuration(waitMs)}`
    : `next: ${next.entry.accountLabel} ready`;
}

interface CreateBotResult {
  success: boolean;
  token?: string;
  username?: string;
  nameTaken?: boolean;
  floodWait?: boolean;
  floodWaitSeconds?: number;
  error?: string;
}

async function attemptCreateBot(
  client: InstanceType<typeof import("telegram").TelegramClient>,
  accountLabel: string,
): Promise<CreateBotResult> {
  const botDisplayName = `Tiger Agent ${randomAlphanumeric(6)}`;
  const botUsername = `tc_${randomAlphanumeric(8)}_bot`;

  try {
    // Step 1: /newbot
    let reply = await sendAndAwaitReply(client, BOTFATHER_PEER, "/newbot");
    if (isFloodResponse(reply)) {
      return { success: false, floodWait: true, floodWaitSeconds: extractFloodSeconds(reply) };
    }

    // If BotFather is in the middle of a previous conversation, cancel first
    if (!looksLikeNamePrompt(reply)) {
      await sendAndAwaitReply(client, BOTFATHER_PEER, "/cancel");
      reply = await sendAndAwaitReply(client, BOTFATHER_PEER, "/newbot");
      if (isFloodResponse(reply)) {
        return { success: false, floodWait: true, floodWaitSeconds: extractFloodSeconds(reply) };
      }
    }

    // Step 2: Send display name
    reply = await sendAndAwaitReply(client, BOTFATHER_PEER, botDisplayName);
    if (isFloodResponse(reply)) {
      return { success: false, floodWait: true, floodWaitSeconds: extractFloodSeconds(reply) };
    }

    // Step 3: Send username
    reply = await sendAndAwaitReply(client, BOTFATHER_PEER, botUsername);
    if (isFloodResponse(reply)) {
      return { success: false, floodWait: true, floodWaitSeconds: extractFloodSeconds(reply) };
    }
    if (isUsernameTaken(reply)) {
      return { success: false, nameTaken: true };
    }

    // Extract token
    const match = reply.match(TOKEN_REGEX);
    if (!match) {
      return { success: false, error: `No token in BotFather reply: ${reply.slice(0, 200)}` };
    }

    return { success: true, token: match[1], username: botUsername };
  } catch (err) {
    return { success: false, error: `[${accountLabel}] ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendAndAwaitReply(
  client: InstanceType<typeof import("telegram").TelegramClient>,
  peer: string,
  message: string,
  timeoutMs = 45_000,
): Promise<string> {
  await client.sendMessage(peer, { message });

  // Poll for reply — simpler than event handlers for short conversations
  const deadline = Date.now() + timeoutMs;
  const startTime = Date.now();

  while (Date.now() < deadline) {
    await sleep(2000);
    const messages = await client.getMessages(peer, { limit: 3 });
    for (const msg of messages) {
      if (!msg.out && msg.date && msg.date * 1000 > startTime - 5000) {
        return msg.message ?? "";
      }
    }
  }

  throw new Error(`BotFather did not respond within ${timeoutMs / 1000}s`);
}

function isFloodResponse(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("too many attempts") ||
    lower.includes("please try again later") ||
    lower.includes("flood") ||
    lower.includes("slow down")
  );
}

function extractFloodSeconds(text: string): number {
  const match = text.match(/(\d+)\s*seconds?/i);
  return match ? parseInt(match[1]!) : 900;
}

function isUsernameTaken(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("already taken") ||
    lower.includes("try something different") ||
    lower.includes("sorry, this username")
  );
}

function looksLikeNamePrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("how are you going to call it") ||
    lower.includes("what is this bot going to be called") ||
    lower.includes("choose a name") ||
    lower.includes("new bot") ||
    lower.includes("alright")
  );
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const fileIdx = args.indexOf("--file");
const tokensFileIdx = args.indexOf("--tokens-file");

if (hasFlag("--mtproto")) {
  const sessionsPath = flag("--sessions", "");
  const count = parseInt(flag("--count", "10"));
  const delay = parseInt(flag("--delay", "480"));
  const apiId = parseInt(flag("--api-id", process.env["TELEGRAM_API_ID"] ?? ""));
  const apiHash = flag("--api-hash", process.env["TELEGRAM_API_HASH"] ?? "");

  if (!sessionsPath) {
    console.error("--sessions <path> is required for MTProto mode.");
    process.exit(1);
  }
  if (!apiId || !apiHash) {
    console.error("--api-id and --api-hash (or TELEGRAM_API_ID / TELEGRAM_API_HASH env vars) are required.");
    process.exit(1);
  }
  if (isNaN(count) || count < 1) {
    console.error("--count must be a positive integer.");
    process.exit(1);
  }

  createBotsViaMTProto(sessionsPath, count, delay, apiId, apiHash).catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else if (tokensFileIdx >= 0 && args[tokensFileIdx + 1]) {
  addTokensFromTextFile(args[tokensFileIdx + 1]!).catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else if (fileIdx >= 0 && args[fileIdx + 1]) {
  addTokensFromFile(args[fileIdx + 1]!).catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  console.log("Usage:");
  console.log("");
  console.log("  Plain-text import (auto-resolves usernames):");
  console.log("    npx tsx ops/botpool/create_bots.ts --tokens-file ./tokens.txt");
  console.log("");
  console.log("  JSON import:");
  console.log("    npx tsx ops/botpool/create_bots.ts --file ./tokens.json");
  console.log("");
  console.log("  MTProto automation:");
  console.log("    npx tsx ops/botpool/create_bots.ts --mtproto --sessions ./sessions.json --count 50");
  console.log("");
  console.log("  Options:");
  console.log("    --tokens-file <path> Plain-text file, one bot token per line (# comments OK)");
  console.log("    --file <path>       JSON file of { botToken, botUsername } pairs");
  console.log("    --mtproto           Use MTProto automated creation");
  console.log("    --sessions <path>   Session strings JSON file (required for --mtproto)");
  console.log("    --count <n>         Number of bots to create (default: 10)");
  console.log("    --delay <seconds>   Seconds between reuses of same account (default: 480)");
  console.log("    --api-id <id>       Telegram API ID (or TELEGRAM_API_ID env var)");
  console.log("    --api-hash <hash>   Telegram API hash (or TELEGRAM_API_HASH env var)");
  console.log("    --api-url <url>     Tiger Claw API base URL (default: http://localhost:4000)");
  console.log("    --admin-token <tok> Admin auth token (or ADMIN_TOKEN env var)");
  process.exit(0);
}
