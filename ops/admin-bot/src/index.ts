// Tiger Claw Admin Bot — Entry Point
// Super-tenant fleet management via Telegram
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1
//
// Commands:
//   /fleet             — all tenants
//   /fleet [slug]      — single tenant detail
//   /provision ...     — manual provision
//   /suspend [slug]    — suspend tenant
//   /resume [slug]     — resume tenant
//   /report [slug]     — trigger daily report
//   /logs [slug]       — tail container logs
//   /health            — system health
//   /update ...        — deployment status and commands
//   /help              — command list
//
// Daily briefing: 7:30 AM Phoenix time (America/Phoenix = UTC-7)

import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import { handleFleet, handleFleetDetail, escMd } from "./commands/fleet.js";
import { handleProvision, handleProvisionAsync } from "./commands/provision.js";
import { handleSuspend, handleResume, handleReport, handleLogs } from "./commands/lifecycle.js";
import { handleHealth } from "./commands/health.js";
import {
  handleUpdateStatus,
  handleUpdateCommand,
  handleCanaryList,
  handleCanaryAdd,
  handleCanaryRemove,
} from "./commands/update.js";
import {
  handlePoolStatus,
  handlePoolImport,
  handlePoolImportBatch,
  handlePoolAssign,
  handlePoolRelease,
  handlePoolRetire,
  handlePoolRefill,
} from "./commands/pool.js";
import { generateDailyBriefing } from "./briefing.js";
import { getFleet, getSystemHealth } from "./api-client.js";

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env["ADMIN_TELEGRAM_BOT_TOKEN"];
const ADMIN_CHAT_ID = process.env["ADMIN_TELEGRAM_CHAT_ID"];

if (!BOT_TOKEN) {
  console.error("[admin-bot] ADMIN_TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}
if (!ADMIN_CHAT_ID) {
  console.error("[admin-bot] ADMIN_TELEGRAM_CHAT_ID is required");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const chatId = ADMIN_CHAT_ID;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function reply(text: string): Promise<void> {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
  } catch (err) {
    console.error("[admin-bot] Send error:", err);
    // Fallback: send as plain text if MarkdownV2 fails
    try {
      await bot.sendMessage(chatId, text.replace(/[\\*_`[\]()~>#+\-=|{}.!]/g, ""));
    } catch {
      // Swallow
    }
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | string> {
  try {
    return await fn();
  } catch (err) {
    return `❌ Error: ${escMd(err instanceof Error ? err.message : String(err))}`;
  }
}

// ---------------------------------------------------------------------------
// Command routing
// ---------------------------------------------------------------------------

bot.on("message", async (msg) => {
  if (String(msg.chat.id) !== chatId) return; // Only respond to admin channel

  const text = msg.text?.trim() ?? "";
  if (!text.startsWith("/")) return;

  // Parse command and args
  const spaceIdx = text.indexOf(" ");
  const cmd = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

  console.log(`[admin-bot] Command: ${cmd} ${args ? `(args: ${args.slice(0, 60)})` : ""}`);

  switch (cmd) {
    case "/fleet": {
      if (args) {
        await reply(await safe(() => handleFleetDetail(args)));
      } else {
        await reply(await safe(() => handleFleet()));
      }
      break;
    }

    case "/provision": {
      // Two-step: send pending message, then provision async
      if (!args) {
        await reply(
          `Usage: /provision \\-\\-name "John Doe" \\-\\-lang en \\-\\-channel telegram \\-\\-token BOT\\_TOKEN\n\n` +
          `Optional: \\-\\-slug, \\-\\-flavor, \\-\\-region, \\-\\-tz, \\-\\-port`
        );
        break;
      }
      try {
        const pendingMsg = await handleProvision(args);
        await reply(pendingMsg);
        const result = await handleProvisionAsync(args);
        await reply(result);
      } catch (err) {
        await reply(`❌ ${escMd(err instanceof Error ? err.message : String(err))}`);
      }
      break;
    }

    case "/suspend":
      await reply(await safe(() => handleSuspend(args)));
      break;

    case "/resume":
      await reply(await safe(() => handleResume(args)));
      break;

    case "/report":
      await reply(await safe(() => handleReport(args)));
      break;

    case "/logs":
      await reply(await safe(() => handleLogs(args)));
      break;

    case "/health":
      await reply(await safe(() => handleHealth()));
      break;

    case "/update":
      if (!args || args === "status") {
        await reply(await safe(() => handleUpdateStatus()));
      } else {
        await reply(await safe(() => handleUpdateCommand(args)));
      }
      break;

    case "/canary": {
      const [subCmd, ...rest] = args.split(/\s+/);
      if (!subCmd || subCmd === "list") {
        await reply(await safe(() => handleCanaryList()));
      } else if (subCmd === "add") {
        await reply(await safe(() => handleCanaryAdd(rest[0] ?? "")));
      } else if (subCmd === "remove") {
        await reply(await safe(() => handleCanaryRemove(rest[0] ?? "")));
      } else {
        await reply(`Usage:\n/canary list\n/canary add \\[slug\\]\n/canary remove \\[slug\\]`);
      }
      break;
    }

    case "/pool": {
      const [subCmd, ...rest] = args.split(/\s+/);
      if (!subCmd) {
        await reply(await safe(() => handlePoolStatus()));
      } else if (subCmd === "import") {
        // /pool import [token]  OR  /pool import\n[token1]\n[token2]...
        const remaining = rest.join("\n");
        if (remaining.includes("\n")) {
          await reply(await safe(() => handlePoolImportBatch(remaining)));
        } else {
          await reply(await safe(() => handlePoolImport(remaining)));
        }
      } else if (subCmd === "import-batch") {
        await reply(await safe(() => handlePoolImportBatch(rest.join("\n"))));
      } else if (subCmd === "assign") {
        await reply(await safe(() => handlePoolAssign(rest[0] ?? "", rest[1] ?? "")));
      } else if (subCmd === "release") {
        await reply(await safe(() => handlePoolRelease(rest[0] ?? "")));
      } else if (subCmd === "retire") {
        await reply(await safe(() => handlePoolRetire(rest[0] ?? "")));
      } else if (subCmd === "refill") {
        await reply(handlePoolRefill());
      } else {
        await reply(
          `Usage:\n/pool \\- show counts\n/pool import \\[token\\]\n/pool import\\-batch\n` +
          `/pool assign \\[slug\\] \\[username\\]\n/pool release \\[username\\]\n` +
          `/pool retire \\[username\\]\n/pool refill`
        );
      }
      break;
    }

    case "/help":
    case "/start":
      await reply(buildHelp());
      break;

    default:
      await reply(`Unknown command\\. Send /help for the command list\\.`);
  }
});

// ---------------------------------------------------------------------------
// Daily admin briefing — 7:30 AM Phoenix time (UTC-7, no DST)
// Cron: 14:30 UTC = 7:30 AM America/Phoenix
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1 "Daily Admin Briefing"
// ---------------------------------------------------------------------------

cron.schedule("30 14 * * *", async () => {
  console.log("[admin-bot] Generating daily briefing...");
  try {
    const [fleet, health] = await Promise.all([getFleet(), getSystemHealth()]);
    const msg = await generateDailyBriefing(fleet, health);
    await reply(msg);
    console.log("[admin-bot] Daily briefing sent.");
  } catch (err) {
    console.error("[admin-bot] Daily briefing error:", err);
    await reply(`❌ Daily briefing failed: ${escMd(err instanceof Error ? err.message : String(err))}`);
  }
});

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function buildHelp(): string {
  return [
    "🐯 *Tiger Claw Admin Bot*",
    "",
    "*Fleet Management*",
    "/fleet — all tenants \\(name, status, health\\)",
    "/fleet \\[slug\\] — single tenant detail",
    "",
    "*Provisioning*",
    "/provision \\-\\-name \\-\\-lang \\-\\-channel \\-\\-token",
    "/suspend \\[slug\\] \\[reason\\]",
    "/resume \\[slug\\]",
    "",
    "*Operations*",
    "/report \\[slug\\] — trigger daily report",
    "/logs \\[slug\\] \\[lines\\] — tail container logs",
    "/health — system\\-wide health",
    "",
    "*Deployments*",
    "/update status — current versions \\& canary",
    "/update build|canary|rollout|rollback",
    "",
    "*Canary Group*",
    "/canary list — show designated canary tenants",
    "/canary add \\[slug\\] — add to canary group",
    "/canary remove \\[slug\\] — remove from canary group",
    "",
    "*Bot Token Pool*",
    "/pool — show available/assigned/retired counts",
    "/pool import \\[token\\] — import a single bot token",
    "/pool import\\-batch — import multiple tokens",
    "/pool assign \\[slug\\] \\[username\\] — manual assignment",
    "/pool release \\[username\\] — return bot to pool",
    "/pool retire \\[username\\] — retire a revoked bot",
    "/pool refill — instructions to add more bots",
    "",
    "_Daily briefing auto\\-sent at 7:30 AM Phoenix\\._",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Startup message
// ---------------------------------------------------------------------------

bot.getMe().then((me) => {
  console.log(`[admin-bot] Started as @${me.username}`);
  bot.sendMessage(chatId, "🐯 Tiger Claw admin bot online\\. Send /help for commands\\.", {
    parse_mode: "MarkdownV2",
  }).catch(() => {/* ignore */});
});

bot.on("polling_error", (err) => {
  console.error("[admin-bot] Polling error:", err.message);
});
