// Tiger Claw API — GET /health
// System-wide health: PostgreSQL, Docker, fleet container summary
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.2

import { Router, type Request, type Response } from "express";
import { getPool } from "../services/db.js";
import { listTigerContainers } from "../services/docker.js";
import * as os from "os";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const startMs = Date.now();
  const checks: Record<string, unknown> = {};

  // PostgreSQL
  try {
    await getPool().query("SELECT 1");
    checks["postgres"] = "ok";
  } catch (err) {
    checks["postgres"] = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Docker
  let containerCount = 0;
  let runningCount = 0;
  try {
    const containers = await listTigerContainers();
    containerCount = containers.length;
    runningCount = containers.filter((c) => c.state === "running").length;
    checks["docker"] = "ok";
  } catch (err) {
    checks["docker"] = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // System stats
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMemPercent = Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100);
  const loadAvg = os.loadavg()[0];

  const healthy = checks["postgres"] === "ok" && checks["docker"] === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptimeSec: Math.round(process.uptime()),
    responseMs: Date.now() - startMs,
    checks,
    fleet: {
      total: containerCount,
      running: runningCount,
      stopped: containerCount - runningCount,
    },
    system: {
      totalMemMb,
      freeMemMb,
      usedMemPercent,
      loadAvg1m: Math.round(loadAvg * 100) / 100,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
