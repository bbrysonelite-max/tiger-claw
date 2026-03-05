// Tiger Claw — Deployment State Service
// TIGERCLAW-BLUEPRINT-v3.md §4.2 (B4.3)
//
// Central state file tracking Tiger Claw and OpenClaw versions, the active
// image tag, canary group, rollout stage, per-tenant update results, and
// rollback history. Read/written by:
//   - ops/build.sh (builds[], tigerClaw, openClaw, imageTag)
//   - ops/update.sh (tenants.{slug})
//   - api/src/routes/update.ts (canary, rollout, rollback)
//
// File locking: uses a .lock sidecar file to prevent concurrent writes.
// Stale locks older than 30s are automatically reclaimed.

import * as fs from "fs";
import * as path from "path";

// ── Schema ───────────────────────────────────────────────────────────────────

export interface VersionPair {
  current: string;
  previous: string;
}

export interface BuildRecord {
  tcVersion: string;
  ocVersion: string;
  imageTag: string;
  builtAt: string;
  commitHash: string;
  gitTagged: boolean;
}

export interface CanaryState {
  group: string[];
  startedAt: string | null;
  stage: string;
}

export interface RolloutState {
  stage: string;
  percentage: number;
  startedAt: string | null;
}

export interface TenantUpdateRecord {
  imageTag?: string;
  updatedAt?: string;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastFailedAt?: string;
}

export interface RollbackRecord {
  rolledBackAt: string;
  rolledBackFrom: string;
  rolledBackTo: string;
}

export interface DeploymentState {
  tigerClaw: VersionPair;
  openClaw: VersionPair;
  imageTag: string;
  builds: BuildRecord[];
  canary: CanaryState;
  rollout: RolloutState;
  tenants: Record<string, TenantUpdateRecord>;
  rollback: RollbackRecord | null;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const EMPTY_STATE: DeploymentState = {
  tigerClaw: { current: "", previous: "" },
  openClaw: { current: "", previous: "" },
  imageTag: "",
  builds: [],
  canary: { group: [], startedAt: null, stage: "none" },
  rollout: { stage: "none", percentage: 0, startedAt: null },
  tenants: {},
  rollback: null,
};

// ── Configuration ────────────────────────────────────────────────────────────

const REPO_ROOT = process.env["REPO_ROOT"] ?? path.resolve(__dirname, "../../../..");
const STATE_FILE = process.env["DEPLOYMENT_STATE_FILE"] ?? path.join(REPO_ROOT, "deployment_state.json");
const LOCK_FILE = `${STATE_FILE}.lock`;
const LOCK_STALE_MS = 30_000;

// ── File Locking ─────────────────────────────────────────────────────────────

function acquireLock(): void {
  // Reclaim stale locks older than 30s
  try {
    const stat = fs.statSync(LOCK_FILE);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Lock file doesn't exist — good
  }

  // Create lock file (exclusive — fails if already exists)
  let attempts = 0;
  while (attempts < 10) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      return;
    } catch {
      attempts++;
      // Busy-wait briefly (50ms)
      const start = Date.now();
      while (Date.now() - start < 50) { /* spin */ }
    }
  }
  throw new Error("Failed to acquire deployment_state.json lock after 10 attempts.");
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Already released or never acquired
  }
}

// ── Read / Write ─────────────────────────────────────────────────────────────

export function readDeploymentState(): DeploymentState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<DeploymentState>;
    return {
      tigerClaw: raw.tigerClaw ?? { ...EMPTY_STATE.tigerClaw },
      openClaw: raw.openClaw ?? { ...EMPTY_STATE.openClaw },
      imageTag: raw.imageTag ?? "",
      builds: raw.builds ?? [],
      canary: raw.canary ?? { ...EMPTY_STATE.canary },
      rollout: raw.rollout ?? { ...EMPTY_STATE.rollout },
      tenants: raw.tenants ?? {},
      rollback: raw.rollback ?? null,
    };
  } catch {
    return { ...EMPTY_STATE, tenants: {} };
  }
}

export function writeDeploymentState(state: DeploymentState): void {
  acquireLock();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } finally {
    releaseLock();
  }
}

export function updateTenantRecord(
  slug: string,
  update: Partial<TenantUpdateRecord>,
): void {
  acquireLock();
  try {
    const state = readDeploymentState();
    const existing = state.tenants[slug] ?? {
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    };
    state.tenants[slug] = { ...existing, ...update };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } finally {
    releaseLock();
  }
}
