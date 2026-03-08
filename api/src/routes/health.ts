// Tiger Claw API — GET /health
// System-wide health: PostgreSQL, Redis, Docker, disk, memory, container count
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.2

import { Router, type Request, type Response } from "express";
import { execSync } from "child_process";
import { createClient } from "redis";
import { getPool } from "../services/db.js";
import { getPoolStatus } from "../services/pool.js";
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

  // Redis
  try {
    const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    const client = createClient({ url: redisUrl });
    await client.connect();
    await client.ping();
    await client.disconnect();
    checks["redis"] = "ok";
  } catch (err) {
    checks["redis"] = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Bot pool status (GAP-6 requirement: warn if below 50)
  let poolAvailable = 0;
  try {
    const poolStatus = await getPoolStatus();
    poolAvailable = poolStatus.available ?? 0;
    checks["pool"] = poolAvailable < 10
      ? `critical: ${poolAvailable} tokens`
      : poolAvailable < 50
        ? `low: ${poolAvailable} tokens`
        : `ok: ${poolAvailable} tokens`;
  } catch (err) {
    checks["pool"] = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Disk usage
  let diskUsagePercent = 0;
  try {
    const dfOutput = execSync("df -P /home/ubuntu/customers 2>/dev/null || df -P /", {
      encoding: "utf8",
    });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1]!.split(/\s+/);
      diskUsagePercent = parseInt(parts[4]?.replace("%", "") ?? "0", 10);
    }
    checks["disk"] = "ok";
  } catch {
    checks["disk"] = "unknown";
  }

  // System stats
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMemPercent = Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100);
  const loadAvg = os.loadavg()[0];

  // Healthy = Postgres + Redis up. Pool low is a warning, not a hard failure.
  const healthy =
    checks["postgres"] === "ok" &&
    checks["redis"] === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptimeSec: Math.round(process.uptime()),
    responseMs: Date.now() - startMs,
    checks,
    pool: {
      available: poolAvailable,
      warning: poolAvailable < 50,
      critical: poolAvailable < 10,
    },
    system: {
      totalMemMb,
      freeMemMb,
      usedMemPercent,
      diskUsagePercent,
      loadAvg1m: Math.round(loadAvg * 100) / 100,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
