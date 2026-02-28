// /fleet          — list all tenants
// /fleet [slug]   — single tenant detail
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1

import { getFleet, getTenant, type TenantSummary } from "../api-client.js";

// ---------------------------------------------------------------------------
// /fleet (no arg) — all tenants table
// ---------------------------------------------------------------------------

export async function handleFleet(): Promise<string> {
  const data = await getFleet();
  if (data.count === 0) return "No tenants provisioned yet.";

  const byStatus = groupBy(data.tenants, (t) => t.status);
  const lines: string[] = [`🐯 *Tiger Claw Fleet* (${data.count} tenants)`, ""];

  const ORDER = ["active", "onboarding", "pending", "paused", "suspended", "terminated"];
  for (const status of ORDER) {
    const group = byStatus[status] ?? [];
    if (group.length === 0) continue;

    const label = status.toUpperCase();
    lines.push(`*${label}* (${group.length})`);
    for (const t of group) {
      const since = t.lastActivityAt
        ? `last seen ${relativeTime(t.lastActivityAt)}`
        : "never active";
      lines.push(`  • ${t.name} \\(${t.slug}\\) — ${t.flavor} | ${since}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /fleet [slug] — single tenant detail
// ---------------------------------------------------------------------------

export async function handleFleetDetail(slug: string): Promise<string> {
  const t = await getTenant(slug);
  const lines: string[] = [`🐯 *${escMd(t.name)}* \\(${escMd(t.slug)}\\)`, ""];

  lines.push(`Status: *${t.status}*`);
  lines.push(`Flavor: ${t.flavor} / Region: ${t.region}`);
  lines.push(`Language: ${t.language} | Channel: ${t.preferredChannel}`);
  lines.push(`Port: ${t.port ?? "—"}`);
  lines.push(`Container: ${escMd(t.containerName ?? "—")}`);
  lines.push(`Created: ${formatDate(t.createdAt)}`);
  if (t.lastActivityAt) lines.push(`Last active: ${relativeTime(t.lastActivityAt)}`);
  if (t.suspendedAt) lines.push(`Suspended: ${formatDate(t.suspendedAt)} — ${escMd(t.suspendedReason ?? "")}`);

  lines.push("");
  lines.push("*Health*");
  if (t.health) {
    const h = t.health;
    lines.push(`  Reachable: ${h.httpReachable ? "✅" : "❌"}`);
    if (h.gatewayStatus) lines.push(`  Gateway: ${h.gatewayStatus}`);
    if (h.memoryMb !== undefined) lines.push(`  Memory: ${h.memoryMb}MB`);
    if (h.keyLayerActive !== undefined) lines.push(`  Key layer: ${h.keyLayerActive}`);
    if (h.channelConnections) {
      const channels = Object.entries(h.channelConnections)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(`  Channels: ${escMd(channels)}`);
    }
    lines.push(`  Checked: ${relativeTime(h.checkedAt)}`);
  } else {
    lines.push("  No health data");
  }

  if (t.containerStats) {
    const s = t.containerStats;
    lines.push("");
    lines.push("*Container Stats*");
    lines.push(`  Memory: ${s.memoryUsageMb}MB / ${s.memoryLimitMb}MB \\(${s.memoryPercent}%\\)`);
    lines.push(`  Running: ${s.running ? "yes" : "no"}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Escape MarkdownV2 special chars
export function escMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
