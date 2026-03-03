// Tiger Claw — Bot Pool Token Loader
//
// This script provides two paths for populating the bot token pool:
//
// 1. addTokensFromFile(filePath) — reads a JSON file of pre-created
//    { botToken, botUsername } pairs and inserts them via the API.
//    Use this for manual batch imports from BotFather.
//
// 2. Future: automated BotFather creation via MTProto (GramJS).
//    MTProto automation requires GramJS and separate Telegram account credentials.
//    See tasks/PHASE-3.md P3-0 for implementation notes.
//
// Usage:
//   npx tsx ops/botpool/create_bots.ts --file ./tokens.json
//   npx tsx ops/botpool/create_bots.ts --file ./tokens.json --api-url http://localhost:4000 --admin-token <token>
//
// tokens.json format:
//   [
//     { "botToken": "123456:ABC-DEF...", "botUsername": "tiger_agent_001_bot" },
//     { "botToken": "789012:GHI-JKL...", "botUsername": "tiger_agent_002_bot" }
//   ]

interface TokenEntry {
  botToken: string;
  botUsername: string;
}

const API_BASE = process.env["TIGER_CLAW_API_URL"] ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

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
      console.error(`  SKIP: missing botToken or botUsername in entry`);
      failed++;
      continue;
    }

    try {
      const resp = await fetch(`${API_BASE}/admin/pool/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ botToken: entry.botToken, botUsername: entry.botUsername }),
      });

      if (resp.ok) {
        console.log(`  OK: @${entry.botUsername}`);
        success++;
      } else {
        const body = await resp.json().catch(() => ({}));
        console.error(`  FAIL: @${entry.botUsername} — ${(body as Record<string, string>).error ?? resp.statusText}`);
        failed++;
      }
    } catch (err) {
      console.error(`  FAIL: @${entry.botUsername} — ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} imported, ${failed} failed.`);
}

// ── Future: automated BotFather creation ─────────────────────────────────────
//
// async function createBotsViaBotFather(count: number): Promise<void> {
//   // MTProto automation requires:
//   //   - npm install telegram (GramJS)
//   //   - A Telegram user account (api_id + api_hash from my.telegram.org)
//   //   - Session string for the user account
//   //
//   // Flow per bot:
//   //   1. Send "/newbot" to @BotFather
//   //   2. Send bot display name
//   //   3. Send bot username (must end in _bot)
//   //   4. Parse the bot token from BotFather's response
//   //   5. Call addTokenToPool() or POST /admin/pool/add
//   //
//   // See tasks/PHASE-3.md P3-0 for implementation notes.
// }

// ── CLI entrypoint ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const apiIdx = args.indexOf("--api-url");
const tokenIdx = args.indexOf("--admin-token");

if (apiIdx >= 0 && args[apiIdx + 1]) {
  (globalThis as Record<string, unknown>)["TIGER_CLAW_API_URL"] = args[apiIdx + 1];
}
if (tokenIdx >= 0 && args[tokenIdx + 1]) {
  (globalThis as Record<string, unknown>)["ADMIN_TOKEN"] = args[tokenIdx + 1];
}

if (fileIdx >= 0 && args[fileIdx + 1]) {
  addTokensFromFile(args[fileIdx + 1]).catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  console.log("Usage: npx tsx ops/botpool/create_bots.ts --file ./tokens.json");
  console.log("  --api-url <url>      Tiger Claw API base URL (default: http://localhost:4000)");
  console.log("  --admin-token <tok>   Admin auth token");
  process.exit(0);
}
