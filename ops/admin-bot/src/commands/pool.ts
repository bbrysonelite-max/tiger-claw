// Tiger Claw Admin Bot — Pool Commands
// /pool [subcommand] — bot token pool management
//
// Commands:
//   /pool                          — show counts (available, assigned, retired)
//   /pool import [token]           — validate and import a single token
//   /pool import-batch [tokens]    — import multiple tokens (one per line after the command)
//   /pool assign [slug] [username] — manually assign a bot to a tenant
//   /pool release [username]       — release a bot back to available pool
//   /pool retire [username]        — retire a bot (token revoked or problematic)
//   /pool refill                   — reminder to run the creation script

import { escMd } from "./fleet.js";
import { apiGet, apiPost, apiDelete } from "../api-client.js";

interface PoolStatus {
  counts: { available: number; assigned: number; retired: number };
  bots: Array<{
    id: string;
    username: string;
    telegramBotId: string;
    status: string;
    phoneAccount?: string;
    assignedAt?: string;
    tenantId?: string;
    createdAt: string;
  }>;
}

interface ImportResult {
  ok: boolean;
  username?: string;
  telegramBotId?: string;
  error?: string;
  imported?: number;
  failed?: number;
  results?: ImportResult[];
}

export async function handlePoolStatus(): Promise<string> {
  const data = await apiGet("/admin/pool") as PoolStatus;
  const { available, assigned, retired } = data.counts;
  const total = available + assigned + retired;

  const levelIcon =
    available === 0 ? "🚨" :
    available < 10  ? "⚠️" :
    available < 25  ? "🟡" :
    "✅";

  const lines = [
    `🤖 *Bot Token Pool*`,
    ``,
    `${levelIcon} Available: *${available}*`,
    `📌 Assigned:  *${assigned}*`,
    `🗑 Retired:   *${retired}*`,
    `📊 Total:     *${total}*`,
  ];

  if (available === 0) {
    lines.push(``, `⚠️ Pool empty — new customers will be waitlisted\\.`);
  } else if (available < 10) {
    lines.push(``, `⚠️ Pool critical \\— run /pool refill to add more bots\\.`);
  } else if (available < 25) {
    lines.push(``, `🟡 Pool low \\— consider running /pool refill soon\\.`);
  }

  return lines.join("\n");
}

export async function handlePoolImport(tokenArg: string): Promise<string> {
  const token = tokenArg.trim();
  if (!token) {
    return `Usage: /pool import \\[bot\\_token\\]\nGet tokens from @BotFather\\.`;
  }

  const result = await apiPost("/admin/pool/import", { token }) as ImportResult;

  if (!result.ok) {
    return `❌ Import failed: ${escMd(result.error ?? "unknown error")}`;
  }

  return [
    `✅ Bot imported successfully`,
    `Username: @${escMd(result.username ?? "unknown")}`,
    `Telegram ID: ${escMd(result.telegramBotId ?? "unknown")}`,
    `Status: available`,
  ].join("\n");
}

export async function handlePoolImportBatch(tokensBlock: string): Promise<string> {
  const tokens = tokensBlock
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return `Usage: /pool import\\-batch\\nThen paste tokens one per line\\.`;
  }

  const result = await apiPost("/admin/pool/import-batch", { tokens }) as ImportResult;
  const imported = result.imported ?? 0;
  const failed = result.failed ?? 0;

  const lines = [
    `📦 Batch import complete`,
    `✅ Imported: *${imported}*`,
    `❌ Failed:   *${failed}*`,
  ];

  // Show failures
  if (failed > 0 && result.results) {
    lines.push(``, `*Failed tokens:*`);
    for (const r of result.results.filter((x) => !x.ok).slice(0, 5)) {
      lines.push(`  • ${escMd(r.error ?? "unknown error")}`);
    }
    if (failed > 5) lines.push(`  \\.\\.\\. and ${failed - 5} more`);
  }

  return lines.join("\n");
}

export async function handlePoolAssign(slug: string, usernameArg: string): Promise<string> {
  if (!slug || !usernameArg) {
    return `Usage: /pool assign \\[slug\\] \\[bot\\_username\\]`;
  }

  // Look up the tenant by slug first
  let tenantId: string;
  try {
    const fleetData = await apiGet("/admin/fleet") as { tenants: Array<{ id: string; slug: string }> };
    const tenant = fleetData.tenants.find((t) => t.slug === slug);
    if (!tenant) return `❌ Tenant @${escMd(slug)} not found\\.`;
    tenantId = tenant.id;
  } catch (err) {
    return `❌ Fleet lookup failed: ${escMd(err instanceof Error ? err.message : String(err))}`;
  }

  // Look up bot by username
  const poolData = await apiGet("/admin/pool") as PoolStatus;
  const bot = poolData.bots.find(
    (b) => b.username.toLowerCase() === usernameArg.toLowerCase().replace(/^@/, "")
  );
  if (!bot) return `❌ Bot @${escMd(usernameArg)} not found in pool\\.`;

  await apiPost(`/admin/pool/${bot.id}/assign`, { tenantId });

  return [
    `✅ Assigned @${escMd(bot.username)} → tenant ${escMd(slug)}`,
    `Bot ID: ${escMd(bot.id.slice(0, 8))}\\.\\.\\. \\| Tenant ID: ${escMd(tenantId.slice(0, 8))}\\.`,
  ].join("\n");
}

export async function handlePoolRelease(usernameArg: string): Promise<string> {
  if (!usernameArg) return `Usage: /pool release \\[bot\\_username\\]`;

  await apiPost(`/admin/pool/${encodeURIComponent(usernameArg)}/release`, {});
  return `✅ Bot @${escMd(usernameArg)} released and reset \\— status: available\\.`;
}

export async function handlePoolRetire(usernameArg: string): Promise<string> {
  if (!usernameArg) return `Usage: /pool retire \\[bot\\_username\\]`;

  await apiDelete(`/admin/pool/${encodeURIComponent(usernameArg)}`);
  return `🗑 Bot @${escMd(usernameArg)} retired\\.`;
}

export function handlePoolRefill(): string {
  return [
    `🔔 *Pool Refill Reminder*`,
    ``,
    `To add bots to the pool:`,
    `1\\. Open Telegram and talk to @BotFather`,
    `2\\. Create each bot with /newbot`,
    `3\\. Copy each token`,
    `4\\. Run: /pool import \\[token\\] for each`,
    `   OR: /pool import\\-batch \\[paste all tokens\\]`,
    ``,
    `_Target: keep available ≥ 25 at all times\\._`,
  ].join("\n");
}
