// Tiger Claw Admin Bot — Daily Fleet Briefing
// Sent automatically at 7:30 AM Phoenix time
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1 "Daily Admin Briefing"
//
// Format (spec example):
//   🐯 Tiger Claw Fleet Report
//   February 27, 2026
//
//   Active tenants: 47 | Onboarding: 3 | Paused: 2
//   New signups: 4 | Key failures: 1 | Container restarts: 0
//   Revenue: MRR $4,653 | Churn risk: 2 inactive >7 days
//
//   Action needed:
//     • Nancy's primary key expired 6 hours ago — monitor
//     • Container tiger-claw-somchai using 92% memory — investigate

import { type FleetResponse, type HealthResponse } from "./api-client.js";
import { escMd } from "./commands/fleet.js";

export async function generateDailyBriefing(
  fleet: FleetResponse,
  health: HealthResponse
): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const tenants = fleet.tenants;
  const lines: string[] = [];

  lines.push(`🐯 *Tiger Claw Fleet Report*`);
  lines.push(escMd(dateStr));
  lines.push("");

  // Counts by status
  const countBy = (status: string) => tenants.filter((t) => t.status === status).length;
  lines.push(
    `Active: *${countBy("active")}* \\| ` +
    `Onboarding: ${countBy("onboarding")} \\| ` +
    `Paused: ${countBy("paused")} \\| ` +
    `Suspended: ${countBy("suspended")}`
  );
  lines.push("");

  // System health summary
  const sysOk = health.status === "ok";
  lines.push(`System: ${sysOk ? "✅ OK" : "⚠️ DEGRADED"}`);
  lines.push(
    `Fleet: ${health.fleet.running} running / ${health.fleet.total} total`
  );
  lines.push(
    `Memory: ${health.system.usedMemPercent}% \\| Load: ${health.system.loadAvg1m}`
  );
  lines.push("");

  // New signups in last 24h
  const oneDayAgo = Date.now() - 86400_000;
  const newToday = tenants.filter(
    (t) => new Date(t.createdAt).getTime() > oneDayAgo
  ).length;
  if (newToday > 0) {
    lines.push(`🆕 *New signups today: ${newToday}*`);
    const newNames = tenants
      .filter((t) => new Date(t.createdAt).getTime() > oneDayAgo)
      .map((t) => escMd(t.name))
      .join(", ");
    lines.push(`  ${newNames}`);
    lines.push("");
  }

  // Action needed
  const actions: string[] = [];

  // Churn risk: inactive > 7 days
  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const churnRisk = tenants.filter((t) => {
    if (t.status !== "active") return false;
    if (!t.lastActivityAt) return true;
    return new Date(t.lastActivityAt).getTime() < sevenDaysAgo;
  });
  if (churnRisk.length > 0) {
    actions.push(`${churnRisk.length} tenant\\(s\\) inactive >7 days — churn risk: ${churnRisk.map((t) => escMd(t.name)).join(", ")}`);
  }

  // Suspended tenants
  const recentlySuspended = tenants.filter((t) => {
    if (t.status !== "suspended" || !t.suspendedAt) return false;
    return new Date(t.suspendedAt).getTime() > oneDayAgo;
  });
  for (const t of recentlySuspended) {
    actions.push(`${escMd(t.name)} suspended: ${escMd(t.suspendedReason ?? "—")}`);
  }

  // System degradation
  if (!sysOk) {
    for (const [svc, status] of Object.entries(health.checks)) {
      if (status !== "ok") {
        actions.push(`Service *${escMd(svc)}* is degraded: ${escMd(String(status))}`);
      }
    }
  }

  if (actions.length > 0) {
    lines.push("*⚠️ Action Needed*");
    for (const a of actions) lines.push(`  • ${a}`);
    lines.push("");
  } else {
    lines.push("✅ No action needed — all systems nominal\\.");
    lines.push("");
  }

  lines.push(`_Auto\\-generated at 7:30 AM Phoenix time_`);

  return lines.join("\n");
}
