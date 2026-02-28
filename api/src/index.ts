// Tiger Claw API — TenantOrchestrator
// Express app on port 4000
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.3 "Tiger Claw API (port 4000)"
//
// Routes mounted:
//   GET  /health
//   POST /webhooks/stripe
//   POST /admin/provision
//   GET  /admin/fleet
//   GET  /admin/fleet/:id
//   POST /admin/fleet/:id/report
//   POST /admin/fleet/:id/suspend
//   POST /admin/fleet/:id/resume
//   DELETE /admin/fleet/:id
//   GET  /admin/fleet/:id/logs
//   GET  /hive/patterns
//   POST /hive/patterns
//
// Health monitor:
//   Every 30 seconds, pings all active container /health endpoints.
//   3 consecutive failures → auto-restart + admin alert.
//   Alert thresholds per Block 6.2.

import "dotenv/config";
import express, { type Request, type Response } from "express";
import { initSchema, listTenants, updateTenantStatus } from "./services/db.js";
import {
  getContainerHealth,
  inspectContainer,
  startExistingContainer,
} from "./services/docker.js";
import { sendAdminAlert } from "./routes/admin.js";
import healthRouter from "./routes/health.js";
import webhooksRouter from "./routes/webhooks.js";
import adminRouter from "./routes/admin.js";
import hiveRouter from "./routes/hive.js";

const app = express();
const PORT = Number(process.env["PORT"] ?? 4000);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Stripe requires raw body for signature verification
app.use("/webhooks/stripe", express.raw({ type: "application/json" }));

// Everything else gets JSON
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use("/health", healthRouter);
app.use("/webhooks", webhooksRouter);
app.use("/admin", adminRouter);
app.use("/hive", hiveRouter);

// Root ping
app.get("/", (_req: Request, res: Response) => {
  res.json({ service: "tiger-claw-api", version: "2.0.0" });
});

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// 30-second fleet health monitor
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.2
// ---------------------------------------------------------------------------

// Track consecutive failures per slug
const failureCount: Record<string, number> = {};
const ALERT_THRESHOLD = {
  MEMORY_WARN: 80,   // %
  MEMORY_CRIT: 95,   // % → restart
  FAIL_WARN: 1,
  FAIL_CRIT: 3,      // → auto-restart
};

// Key layer alert dedup: only alert once per hour per tenant per layer.
// Without this, a tenant stuck on Layer 3 would generate 2,880 alerts/day.
const KEY_LAYER_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const lastKeyLayerAlert: Record<string, { layer: number; alertedAt: number }> = {};

async function runHealthMonitor(): Promise<void> {
  try {
    const tenants = await listTenants("active");
    if (tenants.length === 0) return;

    for (const tenant of tenants) {
      if (!tenant.port) continue;

      const health = await getContainerHealth(tenant.slug, tenant.port);

      if (!health.httpReachable) {
        failureCount[tenant.slug] = (failureCount[tenant.slug] ?? 0) + 1;
        const count = failureCount[tenant.slug]!;

        if (count >= ALERT_THRESHOLD.FAIL_CRIT) {
          console.warn(`[monitor] ${tenant.slug} — ${count} consecutive failures → auto-restart`);
          try {
            await startExistingContainer(tenant.slug);
            failureCount[tenant.slug] = 0;
            await sendAdminAlert(
              `⚠️ Auto-restarted container for ${tenant.name} (${tenant.slug}) after ${count} health check failures.`
            );
          } catch (err) {
            await updateTenantStatus(tenant.id, "paused");
            await sendAdminAlert(
              `🚨 CRITICAL: ${tenant.name} (${tenant.slug}) failed to auto-restart after ${count} failures.\n` +
              `Error: ${err instanceof Error ? err.message : String(err)}\nStatus set to paused.`
            );
          }
        } else if (count === ALERT_THRESHOLD.FAIL_WARN) {
          await sendAdminAlert(`⚠️ Health check missed for ${tenant.name} (${tenant.slug}) — monitoring.`);
        }
      } else {
        failureCount[tenant.slug] = 0;

        // Check key layer degradation — alert at most once per hour per tenant
        if (health.keyLayerActive !== undefined && health.keyLayerActive >= 3) {
          const prev = lastKeyLayerAlert[tenant.slug];
          const now = Date.now();
          const sameLayer = prev?.layer === health.keyLayerActive;
          const withinCooldown = prev !== undefined && (now - prev.alertedAt) < KEY_LAYER_ALERT_COOLDOWN_MS;
          if (!sameLayer || !withinCooldown) {
            lastKeyLayerAlert[tenant.slug] = { layer: health.keyLayerActive, alertedAt: now };
            const severity = health.keyLayerActive === 4 ? "🚨 CRITICAL" : "⚠️";
            await sendAdminAlert(
              `${severity} Key layer ${health.keyLayerActive} active for ${tenant.name} (${tenant.slug})`
            );
          }
        }

        // Check memory via Docker stats
        const stats = await inspectContainer(tenant.slug);
        if (stats && stats.running) {
          if (stats.memoryPercent >= ALERT_THRESHOLD.MEMORY_CRIT) {
            await sendAdminAlert(
              `🚨 Container ${tenant.slug} memory at ${stats.memoryPercent}% — restarting.`
            );
            await startExistingContainer(tenant.slug);
          } else if (stats.memoryPercent >= ALERT_THRESHOLD.MEMORY_WARN) {
            await sendAdminAlert(
              `⚠️ Container ${tenant.slug} memory at ${stats.memoryPercent}% (threshold: ${ALERT_THRESHOLD.MEMORY_WARN}%)`
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[monitor] Health monitor error:", err);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Initialize PostgreSQL schema
  await initSchema();

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`[tiger-claw-api] Listening on port ${PORT}`);
  });

  // Start fleet health monitor (30-second interval)
  setInterval(runHealthMonitor, 30_000);
  console.log("[monitor] Fleet health monitor started (30s interval)");
}

main().catch((err) => {
  console.error("[tiger-claw-api] Fatal startup error:", err);
  process.exit(1);
});
