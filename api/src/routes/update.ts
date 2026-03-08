// Tiger Claw API — Update Pipeline Routes
// TIGERCLAW-BLUEPRINT-v3.md §4.3, §4.4
//
// Endpoints:
//   GET  /admin/update/status           — deployment overview
//   POST /admin/update/build            — trigger image build via ops/build.sh
//   POST /admin/update/canary/start     — deploy latest image to canary group
//   POST /admin/update/canary/advance   — advance to next rollout stage
//   POST /admin/update/fleet            — skip to 100% immediately
//   POST /admin/update/rollback         — rollback current stage to previous image
//   POST /admin/update/canary/set       — set the 5-tenant canary group
//
// Route handlers call ops/build.sh and ops/update.sh via child_process.execFile
// (no shell — prevents injection).

import { Router, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import {
  readDeploymentState,
  writeDeploymentState,
  updateTenantRecord,
  type DeploymentState,
} from "../services/deploymentState.js";
import {
  listTenants,
  getTenantBySlug,
  updateTenantStatus,
  type Tenant,
} from "../services/db.js";
import { sendAdminAlert } from "./admin.js";

const execFileAsync = promisify(execFile);

const router = Router();

const REPO_ROOT = process.env["REPO_ROOT"] ?? path.resolve(__dirname, "../../../..");
const BUILD_SCRIPT = path.join(REPO_ROOT, "ops", "build.sh");
const UPDATE_SCRIPT = path.join(REPO_ROOT, "ops", "update.sh");

const BATCH_SIZE = 5;
const AUTO_ROLLBACK_THRESHOLD = 3;

// ── Rollout stage definitions ────────────────────────────────────────────────

const ROLLOUT_STAGES: Array<{ name: string; percentage: number; soakHours: number }> = [
  { name: "canary", percentage: 0, soakHours: 24 },
  { name: "10%", percentage: 10, soakHours: 6 },
  { name: "25%", percentage: 25, soakHours: 6 },
  { name: "50%", percentage: 50, soakHours: 6 },
  { name: "100%", percentage: 100, soakHours: 0 },
];

// ── Shared helpers ───────────────────────────────────────────────────────────

interface UpdateResult { slug: string; success: boolean; error?: string }

async function updateTenantContainer(
  slug: string,
  imageTag: string,
): Promise<UpdateResult> {
  // Pause flywheel: set tenant status to "updating" if currently "active"
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    console.warn(`[update] Tenant ${slug} not found in DB — skipping.`);
    return { slug, success: false, error: "Tenant not found in DB" };
  }
  if (tenant.status !== "active") {
    console.warn(`[update] Tenant ${slug} status is '${tenant.status}' (not active) — skipping.`);
    return { slug, success: false, error: `Tenant status is ${tenant.status}, not active` };
  }

  await updateTenantStatus(tenant.id, "updating");

  try {
    await execFileAsync(UPDATE_SCRIPT, ["--slug", slug, "--image-tag", imageTag], {
      timeout: 120_000,
    });

    // Resume flywheel
    await updateTenantStatus(tenant.id, "active");
    updateTenantRecord(slug, {
      imageTag,
      updatedAt: new Date().toISOString(),
      successCount: (readDeploymentState().tenants[slug]?.successCount ?? 0) + 1,
      consecutiveFailures: 0,
    });
    return { slug, success: true };
  } catch (err) {
    // Resume flywheel even on failure (container rolled back by update.sh)
    await updateTenantStatus(tenant.id, "active");
    const now = new Date().toISOString();
    let existing;
    try { existing = readDeploymentState().tenants[slug]; } catch { /* state unreadable — use defaults */ }
    updateTenantRecord(slug, {
      lastFailedAt: now,
      failureCount: (existing?.failureCount ?? 0) + 1,
      consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
    });
    const msg = err instanceof Error ? err.message : String(err);
    return { slug, success: false, error: msg };
  }
}

async function rolloutBatch(
  slugs: string[],
  imageTag: string,
): Promise<{ results: UpdateResult[]; autoRolledBack: boolean }> {
  const allResults: UpdateResult[] = [];
  let autoRolledBack = false;

  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    const batch = slugs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((slug) => updateTenantContainer(slug, imageTag)),
    );
    allResults.push(...batchResults);

    // Check auto-rollback after each batch
    for (const r of batchResults) {
      if (!r.success && await checkAutoRollback(r.slug)) {
        console.error(`[update] Auto-rollback triggered by ${r.slug} (${AUTO_ROLLBACK_THRESHOLD} consecutive failures)`);
        await sendAdminAlert(
          `Auto-rollback triggered: ${r.slug} hit ${AUTO_ROLLBACK_THRESHOLD} consecutive failures. Rolling back.`,
        );
        await performRollback();
        autoRolledBack = true;
        return { results: allResults, autoRolledBack };
      }
    }
  }

  return { results: allResults, autoRolledBack };
}

async function checkAutoRollback(slug: string): Promise<boolean> {
  const state = readDeploymentState();
  const record = state.tenants[slug];
  return (record?.consecutiveFailures ?? 0) >= AUTO_ROLLBACK_THRESHOLD;
}

async function performRollback(): Promise<{ previousImageTag: string; results: UpdateResult[] }> {
  const state = readDeploymentState();
  const previousBuilds = state.builds.slice(1);
  if (previousBuilds.length === 0) {
    throw new Error("No previous build to roll back to.");
  }

  const previousBuild = previousBuilds[0];
  const previousImageTag = previousBuild.imageTag;
  if (!previousImageTag) {
    throw new Error("Previous build has no image tag.");
  }

  const currentImageTag = state.imageTag;
  const results: UpdateResult[] = [];

  // Find all tenants that were updated to the current image
  const canaryGroup = state.canary.group;
  const currentStage = state.rollout.stage;

  if (currentStage === "canary") {
    // Roll back canary group only
    for (const slug of canaryGroup) {
      results.push(await rollbackSingleTenant(slug, previousImageTag));
    }
  } else {
    // Roll back all tenants whose imageTag matches the current (failed) image
    for (const [slug, record] of Object.entries(state.tenants)) {
      if (record.imageTag === currentImageTag) {
        results.push(await rollbackSingleTenant(slug, previousImageTag));
      }
    }
  }

  // Update deployment state
  state.imageTag = previousImageTag;
  state.tigerClaw = {
    current: previousBuild.tcVersion,
    previous: state.tigerClaw.current,
  };
  state.openClaw = {
    current: previousBuild.ocVersion,
    previous: state.openClaw.current,
  };
  state.rollout = { stage: "none", percentage: 0, startedAt: null };
  state.canary = { ...state.canary, stage: "none", startedAt: null };
  state.rollback = {
    rolledBackAt: new Date().toISOString(),
    rolledBackFrom: currentImageTag,
    rolledBackTo: previousImageTag,
  };
  writeDeploymentState(state);

  await sendAdminAlert(
    `Rollback complete: ${results.length} container(s) rolled back from ${currentImageTag} to ${previousImageTag}.`,
  );

  return { previousImageTag, results };
}

async function rollbackSingleTenant(slug: string, imageTag: string): Promise<UpdateResult> {
  try {
    await execFileAsync(UPDATE_SCRIPT, ["--slug", slug, "--image-tag", imageTag], {
      timeout: 120_000,
    });
    updateTenantRecord(slug, {
      imageTag,
      updatedAt: new Date().toISOString(),
    });
    return { slug, success: true };
  } catch (err) {
    return { slug, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function getActiveTenantsSorted(tenants: Tenant[]): Tenant[] {
  return tenants
    .filter((t) => t.status === "active")
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// ── GET /status ──────────────────────────────────────────────────────────────

router.get("/status", (_req: Request, res: Response) => {
  const state = readDeploymentState();
  const lastBuild = state.builds[0];

  res.json({
    tigerClaw: state.tigerClaw,
    openClaw: state.openClaw,
    imageTag: state.imageTag || "none",
    lastBuildAt: lastBuild?.builtAt ?? null,
    canary: state.canary,
    rollout: state.rollout,
    rollback: state.rollback,
  });
});

// ── POST /build ──────────────────────────────────────────────────────────────

router.post("/build", async (req: Request, res: Response) => {
  const { ocVersion } = req.body as { ocVersion?: string };

  const state = readDeploymentState();
  const resolvedOcVersion = ocVersion ?? state.openClaw.current;
  if (!resolvedOcVersion) {
    return res.status(400).json({ error: "ocVersion is required (no current version in state)." });
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  let buildNum = 1;
  for (const b of state.builds) {
    const v = b.tcVersion;
    if (v.startsWith(`v${today}.`)) {
      const n = parseInt(v.slice(`v${today}.`.length), 10);
      if (n >= buildNum) buildNum = n + 1;
    }
  }
  const tcVersion = `v${today}.${buildNum}`;

  try {
    const { stdout, stderr } = await execFileAsync(BUILD_SCRIPT, [
      "--tc-version", tcVersion,
      "--oc-version", resolvedOcVersion,
    ], { timeout: 600_000 });

    const updatedState = readDeploymentState();

    await sendAdminAlert(`Build complete: ${updatedState.imageTag} (TC ${tcVersion}, OC ${resolvedOcVersion})`);

    return res.json({
      ok: true,
      tcVersion,
      ocVersion: resolvedOcVersion,
      imageTag: updatedState.imageTag || `tiger-claw:${tcVersion}-oc${resolvedOcVersion}`,
      stdout: stdout.trim(),
      stderr: stderr.trim() || undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendAdminAlert(`Build FAILED: ${msg}`);
    return res.status(500).json({ error: `Build failed: ${msg}` });
  }
});

// ── POST /canary/start ───────────────────────────────────────────────────────

router.post("/canary/start", async (_req: Request, res: Response) => {
  const state = readDeploymentState();
  const imageTag = state.imageTag;
  if (!imageTag) {
    return res.status(400).json({ error: "No image tag in deployment state. Run /update build first." });
  }

  const canaryGroup = state.canary.group;
  if (canaryGroup.length === 0) {
    return res.status(400).json({ error: "Canary group is empty. Set it with /update canary set." });
  }

  const results: UpdateResult[] = [];
  for (const slug of canaryGroup) {
    results.push(await updateTenantContainer(slug, imageTag));
  }

  const now = new Date().toISOString();
  const soakEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const freshState = readDeploymentState();
  freshState.canary = { ...freshState.canary, startedAt: now, stage: "canary" };
  freshState.rollout = { stage: "canary", percentage: 0, startedAt: now };
  writeDeploymentState(freshState);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  await sendAdminAlert(
    `Canary started: ${succeeded}/${canaryGroup.length} containers updated (${failed} failed). Soak until ${soakEnd.slice(0, 16)}.`,
  );

  return res.json({
    ok: true,
    slugs: canaryGroup,
    containerCount: canaryGroup.length,
    results,
    soakEndAt: soakEnd,
  });
});

// ── POST /canary/advance ─────────────────────────────────────────────────────

router.post("/canary/advance", async (_req: Request, res: Response) => {
  const state = readDeploymentState();
  const currentStage = state.rollout.stage;
  const stageIdx = ROLLOUT_STAGES.findIndex((s) => s.name === currentStage);

  if (stageIdx < 0) {
    return res.status(400).json({ error: "No active rollout. Start with /update canary start." });
  }

  // Enforce soak time
  const startedAt = state.rollout.startedAt;
  if (startedAt) {
    const soakHours = ROLLOUT_STAGES[stageIdx].soakHours;
    const elapsed = (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60);
    if (elapsed < soakHours) {
      const remaining = Math.ceil(soakHours - elapsed);
      return res.status(400).json({
        error: `Soak period not elapsed. ${remaining}h remaining at ${currentStage} stage.`,
      });
    }
  }

  const nextIdx = stageIdx + 1;
  if (nextIdx >= ROLLOUT_STAGES.length) {
    return res.status(400).json({ error: "Already at 100%. Rollout complete." });
  }

  const nextStage = ROLLOUT_STAGES[nextIdx];
  const previousPercentage = ROLLOUT_STAGES[stageIdx].percentage;
  const imageTag = state.imageTag;

  // Get all active tenants, sorted by slug
  const allTenants = await listTenants("active");
  const sorted = getActiveTenantsSorted(allTenants);
  const total = sorted.length;

  // Calculate the slice: tenants from previousPercentage to nextStage.percentage
  const prevCount = Math.floor(total * previousPercentage / 100);
  const nextCount = Math.floor(total * nextStage.percentage / 100);
  const canarySet = new Set(state.canary.group);
  // Exclude canary tenants (already updated) from the slice
  const eligible = sorted.filter((t) => !canarySet.has(t.slug));
  const sliceSlugs = eligible.slice(prevCount, nextCount).map((t) => t.slug);

  // Execute rollout in batches of 5
  const { results, autoRolledBack } = await rolloutBatch(sliceSlugs, imageTag);

  if (autoRolledBack) {
    return res.json({
      ok: false,
      autoRolledBack: true,
      stage: "none",
      percentage: 0,
      results,
    });
  }

  // Update state
  const freshState = readDeploymentState();
  freshState.rollout = {
    stage: nextStage.name,
    percentage: nextStage.percentage,
    startedAt: new Date().toISOString(),
  };
  writeDeploymentState(freshState);

  const succeeded = results.filter((r) => r.success).length;
  await sendAdminAlert(
    `Rollout advanced to ${nextStage.name}: ${succeeded}/${sliceSlugs.length} containers updated.`,
  );

  return res.json({
    ok: true,
    stage: nextStage.name,
    percentage: nextStage.percentage,
    containerCount: sliceSlugs.length,
    previousStage: currentStage,
    results,
  });
});

// ── POST /fleet ──────────────────────────────────────────────────────────────

router.post("/fleet", async (_req: Request, res: Response) => {
  const state = readDeploymentState();
  if (!state.imageTag) {
    return res.status(400).json({ error: "No image tag in deployment state." });
  }

  const currentPercentage = state.rollout.percentage;
  const imageTag = state.imageTag;

  // Get all active tenants, sorted by slug
  const allTenants = await listTenants("active");
  const sorted = getActiveTenantsSorted(allTenants);
  const total = sorted.length;

  // Calculate remaining tenants (those not yet updated)
  const alreadyCount = Math.floor(total * currentPercentage / 100);
  const canarySet = new Set(state.canary.group);
  const eligible = sorted.filter((t) => !canarySet.has(t.slug));
  const remainingSlugs = eligible.slice(alreadyCount).map((t) => t.slug);

  // Execute in batches of 5
  const { results, autoRolledBack } = await rolloutBatch(remainingSlugs, imageTag);

  if (autoRolledBack) {
    return res.json({
      ok: false,
      autoRolledBack: true,
      stage: "none",
      percentage: 0,
      results,
    });
  }

  const freshState = readDeploymentState();
  freshState.rollout = {
    stage: "100%",
    percentage: 100,
    startedAt: new Date().toISOString(),
  };
  writeDeploymentState(freshState);

  const succeeded = results.filter((r) => r.success).length;
  await sendAdminAlert(
    `Fleet rollout to 100%: ${succeeded}/${remainingSlugs.length} containers updated.`,
  );

  return res.json({
    ok: true,
    stage: "100%",
    percentage: 100,
    containerCount: remainingSlugs.length,
    imageTag,
    results,
  });
});

// ── POST /rollback ───────────────────────────────────────────────────────────

router.post("/rollback", async (_req: Request, res: Response) => {
  try {
    const { previousImageTag, results } = await performRollback();
    return res.json({
      ok: true,
      previousImageTag,
      containerCount: results.length,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg });
  }
});

// ── POST /canary/set ─────────────────────────────────────────────────────────

router.post("/canary/set", (req: Request, res: Response) => {
  const { slugs } = req.body as { slugs?: string[] };
  if (!Array.isArray(slugs) || slugs.length !== 5) {
    return res.status(400).json({ error: "Exactly 5 slugs required." });
  }

  const state = readDeploymentState();
  state.canary = { ...state.canary, group: slugs };
  writeDeploymentState(state);

  return res.json({ ok: true, canaryGroup: slugs });
});

export default router;
