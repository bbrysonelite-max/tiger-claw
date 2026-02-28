// /suspend [slug]  — suspend a tenant
// /resume [slug]   — resume a suspended tenant
// /report [slug]   — trigger manual daily report
// /logs [slug]     — tail last 50 container log lines
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1

import {
  suspendTenant,
  resumeTenant,
  triggerReport,
  getTenantLogs,
} from "../api-client.js";
import { escMd } from "./fleet.js";

// ---------------------------------------------------------------------------
// /suspend [slug] [optional reason]
// e.g. /suspend john-doe non-payment
// ---------------------------------------------------------------------------

export async function handleSuspend(text: string): Promise<string> {
  const parts = text.trim().split(/\s+/);
  const slug = parts[0];
  if (!slug) return "Usage: /suspend \\[slug\\] \\[optional reason\\]";

  const reason = parts.slice(1).join(" ") || "Admin suspension";

  try {
    await suspendTenant(slug, reason);
    return `✅ Suspended *${escMd(slug)}*\nReason: ${escMd(reason)}`;
  } catch (err) {
    return `❌ Failed to suspend ${escMd(slug)}: ${escMd(String(err instanceof Error ? err.message : err))}`;
  }
}

// ---------------------------------------------------------------------------
// /resume [slug]
// ---------------------------------------------------------------------------

export async function handleResume(text: string): Promise<string> {
  const slug = text.trim().split(/\s+/)[0];
  if (!slug) return "Usage: /resume \\[slug\\]";

  try {
    await resumeTenant(slug);
    return `✅ Resumed *${escMd(slug)}* — container is starting\\.`;
  } catch (err) {
    return `❌ Failed to resume ${escMd(slug)}: ${escMd(String(err instanceof Error ? err.message : err))}`;
  }
}

// ---------------------------------------------------------------------------
// /report [slug]
// ---------------------------------------------------------------------------

export async function handleReport(text: string): Promise<string> {
  const slug = text.trim().split(/\s+/)[0];
  if (!slug) return "Usage: /report \\[slug\\]";

  try {
    const result = await triggerReport(slug);
    const triggered = result.triggered
      ? "Briefing message sent to bot ✅"
      : "Queued \\(bot may not have an active chat yet\\)";
    return `📊 Manual report triggered for *${escMd(slug)}*\n${triggered}`;
  } catch (err) {
    return `❌ Failed to trigger report for ${escMd(slug)}: ${escMd(String(err instanceof Error ? err.message : err))}`;
  }
}

// ---------------------------------------------------------------------------
// /logs [slug] [optional tail count, default 50]
// ---------------------------------------------------------------------------

export async function handleLogs(text: string): Promise<string> {
  const parts = text.trim().split(/\s+/);
  const slug = parts[0];
  if (!slug) return "Usage: /logs \\[slug\\] \\[lines\\]";

  const tail = parts[1] ? Math.min(Number(parts[1]), 100) : 50;

  try {
    const result = await getTenantLogs(slug, tail);
    const lines = result.lines;
    if (lines.length === 0) return `No logs found for *${escMd(slug)}*`;

    // Telegram has a 4096 char message limit — truncate if needed
    const header = `📋 *Logs: ${escMd(slug)}* \\(last ${lines.length} lines\\)\n\`\`\`\n`;
    const footer = "\n```";
    const available = 4096 - header.length - footer.length - 10;

    let body = lines.join("\n");
    if (body.length > available) {
      body = "\\.\\.\\. \\(truncated\\)\\.\\.\\.\n" + body.slice(-available + 30);
    }

    return header + body + footer;
  } catch (err) {
    return `❌ Failed to fetch logs for ${escMd(slug)}: ${escMd(String(err instanceof Error ? err.message : err))}`;
  }
}
