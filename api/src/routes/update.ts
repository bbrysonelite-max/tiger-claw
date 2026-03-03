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
// (no shell — prevents injection). Full orchestration logic comes in P2-5.

import { Router, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import {
  readDeploymentState,
  writeDeploymentState,
  type DeploymentState,
} from "../services/deploymentState.js";

const execFileAsync = promisify(execFile);

const router = Router();

const REPO_ROOT = process.env["REPO_ROOT"] ?? path.resolve(import.meta.dirname, "../../../..");
const BUILD_SCRIPT = path.join(REPO_ROOT, "ops", "build.sh");
const UPDATE_SCRIPT = path.join(REPO_ROOT, "ops", "update.sh");

// ── GET /status ──────────────────────────────────────────────────────────────

router.get("/status", (_req: Request, res: Response) => {
  const state = readDeploymentState();
  const lastBuild = state.builds?.[0];

  res.json({
    tigerClaw: state.tigerClaw ?? { current: "unknown" },
    openClaw: state.openClaw ?? { current: "unknown" },
    imageTag: state.imageTag ?? "none",
    lastBuildAt: lastBuild?.builtAt ?? null,
    canary: state.canary ?? { group: [], stage: "none", startedAt: null },
    rollout: state.rollout ?? { stage: "none", percentage: 0, startedAt: null },
  });
});

// ── POST /build ──────────────────────────────────────────────────────────────

router.post("/build", async (req: Request, res: Response) => {
  const { ocVersion } = req.body as { ocVersion?: string };

  const state = readDeploymentState();
  const resolvedOcVersion = ocVersion ?? state.openClaw?.current;
  if (!resolvedOcVersion) {
    return res.status(400).json({ error: "ocVersion is required (no current version in state)." });
  }

  // Auto-generate TC version: v{YYYY}.{MM}.{DD}.{N}
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  let buildNum = 1;
  for (const b of state.builds ?? []) {
    const v = b.tcVersion ?? "";
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
    return res.json({
      ok: true,
      tcVersion,
      ocVersion: resolvedOcVersion,
      imageTag: updatedState.imageTag ?? `tiger-claw:${tcVersion}-oc${resolvedOcVersion}`,
      stdout: stdout.trim(),
      stderr: stderr.trim() || undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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

  const canaryGroup = state.canary?.group ?? [];
  if (canaryGroup.length === 0) {
    return res.status(400).json({ error: "Canary group is empty. Set it with /update canary set." });
  }

  // Execute ops/update.sh for each canary tenant (sequentially for safety)
  const results: Array<{ slug: string; success: boolean; error?: string }> = [];
  for (const slug of canaryGroup) {
    try {
      await execFileAsync(UPDATE_SCRIPT, ["--slug", slug, "--image-tag", imageTag], {
        timeout: 120_000,
      });
      results.push({ slug, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ slug, success: false, error: msg });
    }
  }

  const now = new Date().toISOString();
  const soakEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  state.canary = {
    ...state.canary,
    startedAt: now,
    stage: "canary",
  };
  state.rollout = { stage: "canary", percentage: 0, startedAt: now };
  writeDeploymentState(state);

  return res.json({
    ok: true,
    slugs: canaryGroup,
    containerCount: canaryGroup.length,
    results,
    soakEndAt: soakEnd,
  });
});

// ── POST /canary/advance ─────────────────────────────────────────────────────

const ROLLOUT_STAGES: Array<{ name: string; percentage: number; soakHours: number }> = [
  { name: "canary", percentage: 0, soakHours: 24 },
  { name: "10%", percentage: 10, soakHours: 6 },
  { name: "25%", percentage: 25, soakHours: 6 },
  { name: "50%", percentage: 50, soakHours: 6 },
  { name: "100%", percentage: 100, soakHours: 0 },
];

router.post("/canary/advance", async (_req: Request, res: Response) => {
  const state = readDeploymentState();
  const currentStage = state.rollout?.stage ?? "none";
  const stageIdx = ROLLOUT_STAGES.findIndex((s) => s.name === currentStage);

  if (stageIdx < 0) {
    return res.status(400).json({ error: "No active rollout. Start with /update canary start." });
  }

  // Enforce soak time
  const startedAt = state.rollout?.startedAt;
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

  // P2-5 will implement actual fleet percentage rollout here.
  // For now, update state and return the plan.
  state.rollout = {
    stage: nextStage.name,
    percentage: nextStage.percentage,
    startedAt: new Date().toISOString(),
  };
  writeDeploymentState(state);

  return res.json({
    ok: true,
    stage: nextStage.name,
    percentage: nextStage.percentage,
    containerCount: 0, // P2-5: calculate from fleet size * percentage
    previousStage: currentStage,
  });
});

// ── POST /fleet ──────────────────────────────────────────────────────────────

router.post("/fleet", async (_req: Request, res: Response) => {
  const state = readDeploymentState();
  if (!state.imageTag) {
    return res.status(400).json({ error: "No image tag in deployment state." });
  }

  // P2-5 will implement full fleet rollout.
  state.rollout = {
    stage: "100%",
    percentage: 100,
    startedAt: new Date().toISOString(),
  };
  writeDeploymentState(state);

  return res.json({
    ok: true,
    stage: "100%",
    percentage: 100,
    containerCount: 0, // P2-5: will calculate actual fleet count
    imageTag: state.imageTag,
  });
});

// ── POST /rollback ───────────────────────────────────────────────────────────

router.post("/rollback", async (_req: Request, res: Response) => {
  const state = readDeploymentState();
  const previousBuilds = (state.builds ?? []).slice(1);
  if (previousBuilds.length === 0) {
    return res.status(400).json({ error: "No previous build to roll back to." });
  }

  const previousBuild = previousBuilds[0];
  const previousImageTag = previousBuild.imageTag;
  if (!previousImageTag) {
    return res.status(400).json({ error: "Previous build has no image tag." });
  }

  // Roll back canary group if in canary stage
  const canaryGroup = state.canary?.group ?? [];
  const currentStage = state.rollout?.stage ?? "none";
  const results: Array<{ slug: string; success: boolean; error?: string }> = [];

  if (currentStage === "canary" && canaryGroup.length > 0) {
    for (const slug of canaryGroup) {
      try {
        await execFileAsync(UPDATE_SCRIPT, ["--slug", slug, "--image-tag", previousImageTag], {
          timeout: 120_000,
        });
        results.push({ slug, success: true });
      } catch (err) {
        results.push({ slug, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  // P2-5: handle rollback at other stages (10%/25%/50%/100%)

  state.imageTag = previousImageTag;
  state.tigerClaw = {
    current: previousBuild.tcVersion ?? state.tigerClaw?.previous,
    previous: state.tigerClaw?.current,
  };
  state.openClaw = {
    current: previousBuild.ocVersion ?? state.openClaw?.previous,
    previous: state.openClaw?.current,
  };
  state.rollout = { stage: "none", percentage: 0, startedAt: null };
  state.canary = { ...state.canary, stage: "none", startedAt: null };
  writeDeploymentState(state);

  return res.json({
    ok: true,
    previousImageTag,
    containerCount: results.length,
    results,
  });
});

// ── POST /canary/set ─────────────────────────────────────────────────────────

router.post("/canary/set", (req: Request, res: Response) => {
  const { slugs } = req.body as { slugs?: string[] };
  if (!Array.isArray(slugs) || slugs.length !== 5) {
    return res.status(400).json({ error: "Exactly 5 slugs required." });
  }

  const state = readDeploymentState();
  state.canary = {
    ...state.canary,
    group: slugs,
  };
  writeDeploymentState(state);

  return res.json({ ok: true, canaryGroup: slugs });
});

export default router;
