// /health — system-wide: PostgreSQL, Docker, disk, memory, container count
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1, Block 6.2

import { getSystemHealth } from "../api-client.js";
import { escMd } from "./fleet.js";

export async function handleHealth(): Promise<string> {
  const h = await getSystemHealth();
  const lines: string[] = ["🏥 *Tiger Claw System Health*", ""];

  // Overall status
  const statusEmoji = h.status === "ok" ? "✅" : "⚠️";
  lines.push(`Status: ${statusEmoji} *${escMd(h.status.toUpperCase())}*`);
  lines.push(`API uptime: ${formatUptime(h.uptimeSec)}`);
  lines.push(`Response: ${h.responseMs}ms`);
  lines.push("");

  // Service checks
  lines.push("*Services*");
  for (const [service, status] of Object.entries(h.checks)) {
    const ok = status === "ok";
    lines.push(`  ${ok ? "✅" : "❌"} ${escMd(service)}: ${escMd(String(status))}`);
  }
  lines.push("");

  // Fleet
  lines.push("*Fleet*");
  lines.push(`  Total containers: ${h.fleet.total}`);
  lines.push(`  Running: ${h.fleet.running}`);
  lines.push(`  Stopped: ${h.fleet.stopped}`);
  lines.push("");

  // System resources
  lines.push("*System Resources*");
  const memPct = h.system.usedMemPercent;
  const memEmoji = memPct >= 90 ? "🚨" : memPct >= 80 ? "⚠️" : "✅";
  lines.push(`  ${memEmoji} Memory: ${h.system.usedMemPercent}% used \\(${h.system.freeMemMb}MB free / ${h.system.totalMemMb}MB total\\)`);
  lines.push(`  Load \\(1m\\): ${h.system.loadAvg1m}`);
  lines.push("");
  lines.push(`_Checked: ${escMd(new Date(h.timestamp).toLocaleString())}_`);

  return lines.join("\n");
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
