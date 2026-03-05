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
//   PATCH /tenants/:id/status
//   POST  /tenants/:id/keys/activate
//   POST  /tenants/:id/scout
//
// Health monitor:
//   Every 30 seconds, pings all active container /health endpoints.
//   3 consecutive failures → auto-restart + admin alert.
//   Alert thresholds per Block 6.2.

import "dotenv/config";
import express, { type Request, type Response } from "express";
import { initSchema, listTenants, updateTenantStatus, logAdminEvent } from "./services/db.js";
import {
  getContainerHealth,
  inspectContainer,
  startExistingContainer,
} from "./services/docker.js";
import { getPoolStatus } from "./services/pool.js";
import { sendAdminAlert } from "./routes/admin.js";
import healthRouter from "./routes/health.js";
import webhooksRouter from "./routes/webhooks.js";
import adminRouter from "./routes/admin.js";
import hiveRouter from "./routes/hive.js";
import tenantsRouter from "./routes/tenants.js";
import updateRouter from "./routes/update.js";
import wizardRouter from "./routes/wizard.js";
import keysRouter from "./routes/keys.js";
import subscriptionsRouter from "./routes/subscriptions.js";

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
app.use("/admin/update", updateRouter);
app.use("/hive", hiveRouter);
app.use("/tenants", tenantsRouter);
app.use("/wizard", wizardRouter);
app.use("/keys", keysRouter);
app.use("/subscriptions", subscriptionsRouter);

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
  ACTIVITY_WARN_H: 24,  // hours → flag as potentially churned
  ACTIVITY_CRIT_H: 72,  // hours → critical churn flag
  DISK_WARN: 80,     // %
  DISK_CRIT: 95,     // % → alert, run cleanup
};

// Alert dedup: only alert once per hour per tenant per condition.
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const lastKeyLayerAlert: Record<string, { layer: number; alertedAt: number }> = {};
const lastActivityAlert: Record<string, { level: string; alertedAt: number }> = {};
const lastDiskAlert: { level: string; alertedAt: number } = { level: "ok", alertedAt: 0 };

// Pool level alert state — Block 5.3 Decision 9
// Alert thresholds: ≥25=no action, 10-24=once/day, <10=every hour, 0=immediate
const POOL_ALERT = {
  LOW_THRESHOLD: 25,      // below this → daily alert
  CRITICAL_THRESHOLD: 10, // below this → hourly alert
  LOW_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours
  CRIT_COOLDOWN_MS: 60 * 60 * 1000,      // 1 hour
  EMPTY_COOLDOWN_MS: 0,                   // immediate, no cooldown
};
let lastPoolAlert = { level: "ok" as "ok" | "low" | "critical" | "empty", alertedAt: 0 };

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
            await logAdminEvent("container_restart", tenant.id, {
              slug: tenant.slug, failures: count, source: "health_monitor",
            });
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
          const withinCooldown = prev !== undefined && (now - prev.alertedAt) < ALERT_COOLDOWN_MS;
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

        // Check agent activity — flag inactive tenants as potential churn
        if (health.lastAgentActivity) {
          const idleMs = Date.now() - new Date(health.lastAgentActivity).getTime();
          const idleHours = idleMs / (1000 * 60 * 60);
          const prev = lastActivityAlert[tenant.slug];
          const now = Date.now();
          const cooldownOk = !prev || (now - prev.alertedAt) > ALERT_COOLDOWN_MS;

          if (idleHours >= ALERT_THRESHOLD.ACTIVITY_CRIT_H && cooldownOk) {
            lastActivityAlert[tenant.slug] = { level: "critical", alertedAt: now };
            await sendAdminAlert(
              `🚨 No agent activity for ${tenant.name} (${tenant.slug}) in ${Math.round(idleHours)}h — potential churn`
            );
          } else if (idleHours >= ALERT_THRESHOLD.ACTIVITY_WARN_H && cooldownOk) {
            lastActivityAlert[tenant.slug] = { level: "warning", alertedAt: now };
            await sendAdminAlert(
              `⚠️ No agent activity for ${tenant.name} (${tenant.slug}) in ${Math.round(idleHours)}h — monitoring`
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[monitor] Health monitor error:", err);
  }

  // Disk usage check — Block 6.2 threshold
  try {
    const { execSync } = await import("child_process");
    const dfOutput = execSync("df -P /home/ubuntu/customers 2>/dev/null || df -P /", {
      encoding: "utf8",
    });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1]!.split(/\s+/);
      const usageStr = parts[4]?.replace("%", "");
      const usage = usageStr ? parseInt(usageStr, 10) : 0;
      const now = Date.now();
      const cooldownOk = (now - lastDiskAlert.alertedAt) > ALERT_COOLDOWN_MS;

      if (usage >= ALERT_THRESHOLD.DISK_CRIT && cooldownOk) {
        lastDiskAlert.level = "critical";
        lastDiskAlert.alertedAt = now;
        await sendAdminAlert(
          `🚨 Disk usage at ${usage}% — run cleanup immediately`
        );
      } else if (usage >= ALERT_THRESHOLD.DISK_WARN && cooldownOk) {
        lastDiskAlert.level = "warning";
        lastDiskAlert.alertedAt = now;
        await sendAdminAlert(
          `⚠️ Disk usage at ${usage}% (threshold: ${ALERT_THRESHOLD.DISK_WARN}%)`
        );
      }
    }
  } catch {
    // Non-fatal — disk check is best-effort
  }

  // Pool level check — Block 5.3 Decision 9
  try {
    const { available } = await getPoolStatus();
    const now = Date.now();
    const elapsed = now - lastPoolAlert.alertedAt;

    if (available === 0) {
      // Empty — alert immediately every cycle (no cooldown)
      if (elapsed > POOL_ALERT.EMPTY_COOLDOWN_MS || lastPoolAlert.level !== "empty") {
        lastPoolAlert = { level: "empty", alertedAt: now };
        await sendAdminAlert(`🚨 POOL EMPTY — waitlist mode active. No bots available for new customers. Run /pool refill.`);
      }
    } else if (available < POOL_ALERT.CRITICAL_THRESHOLD) {
      // Critical (<10) — alert every hour
      if (elapsed > POOL_ALERT.CRIT_COOLDOWN_MS || lastPoolAlert.level !== "critical") {
        lastPoolAlert = { level: "critical", alertedAt: now };
        await sendAdminAlert(`⚠️ Pool critical: ${available} bot${available !== 1 ? "s" : ""} available. Run /pool refill.`);
      }
    } else if (available < POOL_ALERT.LOW_THRESHOLD) {
      // Low (10-24) — alert once per day
      if (elapsed > POOL_ALERT.LOW_COOLDOWN_MS || lastPoolAlert.level !== "low") {
        lastPoolAlert = { level: "low", alertedAt: now };
        await sendAdminAlert(`🟡 Pool low: ${available} bot${available !== 1 ? "s" : ""} available. Consider running /pool refill.`);
      }
    } else {
      // Healthy — reset alert state so we re-alert if it drops again
      lastPoolAlert = { level: "ok", alertedAt: now };
    }
  } catch {
    // Non-fatal — don't let pool check break the fleet monitor
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
