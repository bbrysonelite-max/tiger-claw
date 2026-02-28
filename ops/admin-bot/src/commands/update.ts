// /update status   — show current image versions, pending updates, canary status
// /update build v2.1.0   — build new image (triggers CI/deploy script)
// /update canary v2.1.0  — deploy to canary group
// /update rollout v2.1.0 10  — deploy to 10% of fleet
// /update rollback v2.1.0    — emergency rollback
// /canary list             — show all designated canary tenants
// /canary add [slug]       — add tenant to canary group
// /canary remove [slug]    — remove tenant from canary group
// TIGERCLAW-MASTER-SPEC-v2.md Block 1.6, Block 6.4

import * as fs from "fs";
import * as path from "path";
import { escMd } from "./fleet.js";
import { apiGet, apiPost, apiDelete } from "../api-client.js";

// Deploy state is written/read by ops/deploy.sh
const DEPLOY_STATE_PATH =
  process.env["DEPLOY_STATE_PATH"] ??
  path.join(process.cwd(), "../../deploy-state.json");

interface DeployState {
  currentVersion: string;
  previousVersion?: string;
  canaryVersion?: string;
  canaryTenants?: string[];
  canaryStartedAt?: string;
  rolloutPercent?: number;
  rolloutStartedAt?: string;
  lastDeployedAt?: string;
  status: "stable" | "canary" | "rolling" | "rollback";
}

function readState(): DeployState {
  try {
    const raw = fs.readFileSync(DEPLOY_STATE_PATH, "utf8");
    return JSON.parse(raw) as DeployState;
  } catch {
    return { currentVersion: "unknown", status: "stable" };
  }
}

// ---------------------------------------------------------------------------
// /update status
// ---------------------------------------------------------------------------

export async function handleUpdateStatus(): Promise<string> {
  const state = readState();
  const lines: string[] = ["🚀 *Deployment Status*", ""];

  lines.push(`Current version: \`${escMd(state.currentVersion)}\``);
  if (state.previousVersion) lines.push(`Previous: \`${escMd(state.previousVersion)}\``);
  lines.push(`Status: *${escMd(state.status.toUpperCase())}*`);

  if (state.status === "canary" && state.canaryVersion) {
    lines.push("");
    lines.push("*Canary Rollout*");
    lines.push(`  Version: \`${escMd(state.canaryVersion)}\``);
    lines.push(`  Tenants: ${state.canaryTenants?.length ?? 0}`);
    if (state.canaryStartedAt) {
      const hoursAgo = Math.floor(
        (Date.now() - new Date(state.canaryStartedAt).getTime()) / 3_600_000
      );
      lines.push(`  Started: ${hoursAgo}h ago \\(24h soak period\\)`);
    }
  }

  if (state.status === "rolling") {
    lines.push("");
    lines.push("*Rolling Rollout*");
    lines.push(`  Version: \`${escMd(state.canaryVersion ?? "—")}\``);
    lines.push(`  Progress: ${state.rolloutPercent ?? 0}% of fleet`);
    if (state.rolloutStartedAt) {
      lines.push(`  Started: ${escMd(new Date(state.rolloutStartedAt).toLocaleString())}`);
    }
  }

  if (state.lastDeployedAt) {
    lines.push("");
    lines.push(`_Last deploy: ${escMd(new Date(state.lastDeployedAt).toLocaleString())}_`);
  }

  lines.push("");
  lines.push(
    `To deploy: run \`ops/deploy\\.sh build|canary|rollout|rollback\` on the server\\.`
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /update build|canary|rollout|rollback — these are server-side ops
// We send back the deploy command the operator should run, rather than
// executing it directly from Telegram (safer — keeps deploy authority on server)
// ---------------------------------------------------------------------------

export async function handleUpdateCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0] ?? "";

  switch (sub) {
    case "build":
      return (
        `🔨 To build image \`${escMd(parts[1] ?? "vX.Y.Z")}\`, run on the server:\n\n` +
        `\`\`\`\nops/deploy.sh build ${escMd(parts[1] ?? "v2.X.0")}\n\`\`\``
      );

    case "canary":
      return (
        `🐦 To deploy canary \`${escMd(parts[1] ?? "vX.Y.Z")}\`, run on the server:\n\n` +
        `\`\`\`\nops/deploy.sh canary ${escMd(parts[1] ?? "v2.X.0")}\n\`\`\``
      );

    case "rollout": {
      const pct = parts[2] ?? "10";
      return (
        `📦 To roll out \`${escMd(parts[1] ?? "vX.Y.Z")}\` to ${pct}% of fleet, run on the server:\n\n` +
        `\`\`\`\nops/deploy.sh rollout ${escMd(parts[1] ?? "v2.X.0")} ${pct}\n\`\`\``
      );
    }

    case "rollback":
      return (
        `⏪ *Emergency rollback* to previous version\\.\n\nRun on the server:\n\n` +
        `\`\`\`\nops/deploy.sh rollback ${escMd(parts[1] ?? "v2.X.0")}\n\`\`\``
      );

    default:
      return (
        `Usage:\n` +
        `/update status\n` +
        `/update build v2\\.1\\.0\n` +
        `/update canary v2\\.1\\.0\n` +
        `/update rollout v2\\.1\\.0 10\n` +
        `/update rollback v2\\.1\\.0`
      );
  }
}

// ---------------------------------------------------------------------------
// /canary list — show all designated canary tenants
// ---------------------------------------------------------------------------

export async function handleCanaryList(): Promise<string> {
  const data = await apiGet("/admin/canary");
  const tenants = (data as { count: number; tenants: { slug: string; name: string; status: string }[] });

  if (!tenants.tenants || tenants.tenants.length === 0) {
    return (
      `🐦 *Canary Group*\n\n` +
      `No tenants designated\\. Use:\n` +
      `/canary add \\[slug\\] to add a tenant\\.`
    );
  }

  const lines = [`🐦 *Canary Group* \\(${tenants.count} tenants\\)`, ""];
  for (const t of tenants.tenants) {
    lines.push(`• \`${escMd(t.slug)}\` — ${escMd(t.name)} \\(${escMd(t.status)}\\)`);
  }
  lines.push("", "_These tenants receive updates first in the canary stage\\._");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /canary add [slug] — designate a tenant as a canary tenant
// ---------------------------------------------------------------------------

export async function handleCanaryAdd(slug: string): Promise<string> {
  if (!slug) return `Usage: /canary add \\[slug\\]`;

  await apiPost(`/admin/fleet/${encodeURIComponent(slug)}/canary`);
  return (
    `✅ \`${escMd(slug)}\` added to canary group\\.\n\n` +
    `This tenant will receive updates first during canary deployments\\.`
  );
}

// ---------------------------------------------------------------------------
// /canary remove [slug] — remove a tenant from the canary group
// ---------------------------------------------------------------------------

export async function handleCanaryRemove(slug: string): Promise<string> {
  if (!slug) return `Usage: /canary remove \\[slug\\]`;

  await apiDelete(`/admin/fleet/${encodeURIComponent(slug)}/canary`);
  return `✅ \`${escMd(slug)}\` removed from canary group\\.`;
}
