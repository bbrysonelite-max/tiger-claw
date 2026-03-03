// Tiger Claw API — Admin Fleet Management Routes
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.3, Block 6.1
//
// Endpoints:
//   POST /admin/provision          — manual provision (comped/gifted tenant)
//   GET  /admin/fleet              — list all tenants with health summary
//   GET  /admin/fleet/:tenantId    — single tenant detail
//   POST /admin/fleet/:tenantId/report    — trigger manual daily report
//   POST /admin/fleet/:tenantId/suspend   — suspend tenant
//   POST /admin/fleet/:tenantId/resume    — resume suspended tenant
//   DELETE /admin/fleet/:tenantId         — terminate tenant
//   GET  /admin/fleet/:tenantId/logs      — tail last 50 container log lines
//
// All admin routes require ADMIN_TOKEN header:
//   Authorization: Bearer <ADMIN_TOKEN>

import { Router, type Request, type Response, type NextFunction } from "express";
import TelegramBot from "node-telegram-bot-api";
import {
  listTenants,
  getTenant,
  logAdminEvent,
  setCanaryGroup,
  listCanaryTenants,
  listBotPool,
  getRecentAdminEvents,
  getPoolStats,
  addTokenToPool,
  type Tenant,
} from "../services/db.js";
import {
  getContainerHealth,
  getContainerLogs,
  inspectContainer,
} from "../services/docker.js";
import {
  provisionTenant,
  suspendTenant,
  resumeTenant,
  terminateTenant,
  deprovisionTenant,
  type ProvisionInput,
} from "../services/provisioner.js";
import {
  importToken,
  importBatch,
  assignToTenant,
  releaseBot,
  retireBot,
  getPoolStatus,
  getBotPoolEntryByUsername,
} from "../services/pool.js";

const router = Router();

// ---------------------------------------------------------------------------
// Admin auth middleware
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAdmin);

// ---------------------------------------------------------------------------
// POST /admin/provision — manual provisioning
// ---------------------------------------------------------------------------

router.post("/provision", async (req: Request, res: Response) => {
  const body = req.body as Partial<ProvisionInput>;

  const required: (keyof ProvisionInput)[] = ["slug", "name", "flavor", "region", "language", "preferredChannel"];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  }

  const result = await provisionTenant(body as ProvisionInput);
  return res.status(result.success ? 201 : 500).json(result);
});

// ---------------------------------------------------------------------------
// GET /admin/fleet — list all tenants
// ---------------------------------------------------------------------------

router.get("/fleet", async (_req: Request, res: Response) => {
  const tenants = await listTenants();
  res.json({
    count: tenants.length,
    tenants: tenants.map(tenantSummary),
  });
});

// ---------------------------------------------------------------------------
// GET /admin/fleet/:tenantId — single tenant detail with live health
// ---------------------------------------------------------------------------

router.get("/fleet/:tenantId", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const health = tenant.port
    ? await getContainerHealth(tenant.slug, tenant.port)
    : null;

  const stats = await inspectContainer(tenant.slug);

  return res.json({
    ...tenantSummary(tenant),
    health,
    containerStats: stats,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/fleet/:tenantId/report — trigger manual daily report
// ---------------------------------------------------------------------------

router.post("/fleet/:tenantId/report", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  if (tenant.status !== "active") {
    return res.status(400).json({ error: "Tenant is not active" });
  }

  // Signal the container to generate a briefing by POSTing to its internal
  // OpenClaw webhook endpoint (the tiger_briefing tool handles "generate" action)
  const triggered = await triggerContainerWebhook(tenant, "tiger_briefing", { action: "generate" });
  await logAdminEvent("manual_report", tenant.id, { triggered });

  return res.json({ ok: true, triggered, tenantId: tenant.id });
});

// ---------------------------------------------------------------------------
// POST /admin/fleet/:tenantId/suspend
// ---------------------------------------------------------------------------

router.post("/fleet/:tenantId/suspend", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const reason = (req.body as { reason?: string })["reason"] ?? "Admin suspension";
  await suspendTenant(tenant, reason);

  return res.json({ ok: true, tenantId: tenant.id, status: "suspended" });
});

// ---------------------------------------------------------------------------
// POST /admin/fleet/:tenantId/resume
// ---------------------------------------------------------------------------

router.post("/fleet/:tenantId/resume", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  if (tenant.status !== "suspended") {
    return res.status(400).json({ error: "Tenant is not suspended" });
  }

  await resumeTenant(tenant);
  return res.json({ ok: true, tenantId: tenant.id, status: "active" });
});

// ---------------------------------------------------------------------------
// DELETE /admin/fleet/:tenantId — terminate (permanent)
// ---------------------------------------------------------------------------

router.delete("/fleet/:tenantId", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  await terminateTenant(tenant);
  return res.json({ ok: true, tenantId: tenant.id, status: "terminated" });
});

// ---------------------------------------------------------------------------
// GET /admin/canary — list all tenants designated in the canary group
// Used by ops/deploy.sh canary to fetch the designated canary slugs
// ---------------------------------------------------------------------------

router.get("/canary", async (_req: Request, res: Response) => {
  const tenants = await listCanaryTenants();
  res.json({
    count: tenants.length,
    tenants: tenants.map(tenantSummary),
  });
});

// ---------------------------------------------------------------------------
// POST /admin/fleet/:tenantId/canary — add tenant to canary group
// ---------------------------------------------------------------------------

router.post("/fleet/:tenantId/canary", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  await setCanaryGroup(tenant.id, true);
  await logAdminEvent("canary_add", tenant.id);
  return res.json({ ok: true, tenantId: tenant.id, slug: tenant.slug, canaryGroup: true });
});

// ---------------------------------------------------------------------------
// DELETE /admin/fleet/:tenantId/canary — remove tenant from canary group
// ---------------------------------------------------------------------------

router.delete("/fleet/:tenantId/canary", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  await setCanaryGroup(tenant.id, false);
  await logAdminEvent("canary_remove", tenant.id);
  return res.json({ ok: true, tenantId: tenant.id, slug: tenant.slug, canaryGroup: false });
});

// ---------------------------------------------------------------------------
// GET /admin/fleet/:tenantId/logs — tail container logs
// ---------------------------------------------------------------------------

router.get("/fleet/:tenantId/logs", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const tail = Number(req.query["tail"] ?? 50);
  try {
    const lines = await getContainerLogs(tenant.slug, tail);
    return res.json({ tenantId: tenant.id, slug: tenant.slug, lines });
  } catch (err) {
    return res.status(500).json({
      error: `Could not fetch logs: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/alerts — internal alert endpoint for skills and ops scripts
// Called by tiger_keys.ts (key rotation/recovery events) and
// pipeline-advance.sh (stage transitions, finalize reverts).
// Without this endpoint those callers silently 404 and admins are never notified.
// ---------------------------------------------------------------------------

router.post("/alerts", async (req: Request, res: Response) => {
  const { message, tenantId, severity } = req.body as {
    message?: string;
    tenantId?: string;
    severity?: string;
  };

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const prefixed = severity === "high" ? `🚨 ${message}` : message;
  await sendAdminAlert(prefixed);

  if (tenantId) {
    await logAdminEvent("skill_alert", tenantId, { message, severity });
  }

  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /admin/events/recent — last 24h admin events for daily briefing
// ---------------------------------------------------------------------------

router.get("/events/recent", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const events = await getRecentAdminEvents(24);

    const keyFailures = events.filter((e) =>
      ["key_rotation", "onboarding_key_deactivated", "key_recovery"].includes(e.action) ||
      (e.details && (e.details as Record<string, unknown>)["type"] === "key_failure")
    );

    const containerRestarts = events.filter((e) =>
      e.action === "container_restart" ||
      (e.details && String((e.details as Record<string, unknown>)["message"] ?? "").includes("Auto-restarted"))
    );

    res.json({
      totalEvents: events.length,
      keyFailures: keyFailures.length,
      keyFailureDetails: keyFailures.map((e) => ({
        tenantName: e.tenantName ?? "unknown",
        action: e.action,
        at: e.createdAt,
        details: e.details,
      })),
      containerRestarts: containerRestarts.length,
      events: events.slice(0, 50),
    });
  } catch (err) {
    console.error("[admin] events/recent error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Admin Telegram alert utility (exported for use in webhooks.ts)
// ---------------------------------------------------------------------------

let adminBot: TelegramBot | null = null;
const ADMIN_CHAT_ID = process.env["ADMIN_TELEGRAM_CHAT_ID"] ?? "";
const ADMIN_BOT_TOKEN = process.env["ADMIN_TELEGRAM_BOT_TOKEN"] ?? "";

export async function sendAdminAlert(message: string): Promise<void> {
  if (!ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID) return;

  try {
    if (!adminBot) adminBot = new TelegramBot(ADMIN_BOT_TOKEN);
    await adminBot.sendMessage(ADMIN_CHAT_ID, message);
  } catch (err) {
    console.error("[admin] Failed to send Telegram alert:", err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantSummary(t: Tenant) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    email: t.email,
    status: t.status,
    flavor: t.flavor,
    region: t.region,
    language: t.language,
    preferredChannel: t.preferredChannel,
    port: t.port,
    containerName: t.containerName,
    canaryGroup: t.canaryGroup,
    lastActivityAt: t.lastActivityAt?.toISOString(),
    suspendedAt: t.suspendedAt?.toISOString(),
    suspendedReason: t.suspendedReason,
    createdAt: t.createdAt.toISOString(),
  };
}

async function resolveTenant(idOrSlug: string): Promise<Tenant | null> {
  // Accept both UUID and slug
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(idOrSlug)) {
    return getTenant(idOrSlug);
  }
  const tenants = await listTenants();
  return tenants.find((t) => t.slug === idOrSlug) ?? null;
}

async function triggerContainerWebhook(
  tenant: Tenant,
  _skill: string,
  _payload: unknown
): Promise<boolean> {
  // The container's OpenClaw agent doesn't expose a direct skill-call webhook
  // in the current architecture. Instead, cron jobs inside the container handle
  // scheduled actions. For manual report triggering, we send a Telegram message
  // to the bot's admin context if available — the agent then invokes tiger_briefing.
  //
  // This is a lightweight approach consistent with the spec's "conversational interface"
  // principle. A future iteration could add a /tiger-claw/run-skill internal endpoint.
  if (!tenant.botToken) return false;

  try {
    const bot = new TelegramBot(tenant.botToken);
    const updates = await bot.getUpdates({ limit: 1, timeout: 1 });
    const chatId = updates[0]?.message?.chat?.id;
    if (!chatId) return false;
    await bot.sendMessage(chatId, "🐯 Generate daily briefing now.");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bot pool management — Block 5.3
// ---------------------------------------------------------------------------

// GET /admin/pool/status — pool stats (total, assigned, unassigned)
router.get("/pool/status", async (_req: Request, res: Response) => {
  const stats = await getPoolStats();
  return res.json(stats);
});

// POST /admin/pool/add — simple token insert (no Telegram validation)
router.post("/pool/add", async (req: Request, res: Response) => {
  const { botToken, botUsername } = req.body as { botToken?: string; botUsername?: string };
  if (!botToken || !botUsername) {
    return res.status(400).json({ error: "botToken and botUsername are required." });
  }
  try {
    await addTokenToPool(botToken, botUsername);
    return res.json({ ok: true, botUsername });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: `Bot @${botUsername} already in pool.` });
    }
    return res.status(500).json({ error: msg });
  }
});

// GET /admin/pool — full pool listing with details
router.get("/pool", async (_req: Request, res: Response) => {
  const counts = await getPoolStatus();
  const all = await listBotPool();
  return res.json({
    counts,
    bots: all.map((b) => ({
      id: b.id,
      username: b.botUsername,
      telegramBotId: b.telegramBotId,
      status: b.status,
      phoneAccount: b.phoneAccount,
      assignedAt: b.assignedAt?.toISOString(),
      tenantId: b.tenantId,
      createdAt: b.createdAt.toISOString(),
    })),
  });
});

// POST /admin/pool/import — import a single token
router.post("/pool/import", async (req: Request, res: Response) => {
  const { token, phoneAccount } = req.body as { token?: string; phoneAccount?: string };
  if (!token) return res.status(400).json({ error: "token is required" });

  const result = await importToken(token, phoneAccount);
  if (!result.ok) return res.status(422).json(result);
  return res.json(result);
});

// POST /admin/pool/import-batch — import multiple tokens (newline or array)
router.post("/pool/import-batch", async (req: Request, res: Response) => {
  const { tokens, phoneAccount } = req.body as { tokens?: string | string[]; phoneAccount?: string };
  if (!tokens) return res.status(400).json({ error: "tokens is required" });

  const list = Array.isArray(tokens)
    ? tokens
    : String(tokens).split(/\r?\n/).filter(Boolean);

  const result = await importBatch(list, phoneAccount);
  return res.json(result);
});

// POST /admin/pool/:botId/assign — manually assign to a tenant
router.post("/pool/:botId/assign", async (req: Request, res: Response) => {
  const { tenantId } = req.body as { tenantId?: string };
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const tenant = await getTenant(tenantId);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  await assignToTenant(req.params["botId"]!, tenantId);
  return res.json({ ok: true, tenantId: tenant.id, slug: tenant.slug });
});

// POST /admin/pool/:botIdOrUsername/release — release back to available pool
router.post("/pool/:ref/release", async (req: Request, res: Response) => {
  const ref = req.params["ref"]!;
  let botId = ref;

  // Accept username (@handle or handle)
  if (ref.startsWith("@") || !/^[0-9a-f]{8}-/.test(ref)) {
    const entry = await getBotPoolEntryByUsername(ref);
    if (!entry) return res.status(404).json({ error: `Bot @${ref} not found in pool` });
    botId = entry.id;
  }

  await releaseBot(botId);
  return res.json({ ok: true });
});

// DELETE /admin/pool/:ref — retire a bot (token revoked/problematic)
router.delete("/pool/:ref", async (req: Request, res: Response) => {
  const ref = req.params["ref"]!;
  let botId = ref;

  if (ref.startsWith("@") || !/^[0-9a-f]{8}-/.test(ref)) {
    const entry = await getBotPoolEntryByUsername(ref);
    if (!entry) return res.status(404).json({ error: `Bot @${ref} not found in pool` });
    botId = entry.id;
  }

  await retireBot(botId);
  return res.json({ ok: true });
});

// POST /admin/fleet/:tenantId/deprovision — full cleanup with bot recycling
router.post("/fleet/:tenantId/deprovision", async (req: Request, res: Response) => {
  const tenant = await resolveTenant(req.params["tenantId"]!);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const result = await deprovisionTenant(tenant);
  return res.json({ ok: true, steps: result.steps });
});

export default router;
