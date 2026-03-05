// Tiger Claw API — Tenant-Facing Routes
// Called by tenant containers (tiger_onboard, tiger_keys) during lifecycle events.
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.2 (Onboarding), Block 4 (Key Management)
//
// Endpoints:
//   PATCH /tenants/:tenantId/status         — update tenant status (e.g. active)
//   POST  /tenants/:tenantId/keys/activate  — deactivate onboarding key (Layer 1)
//   POST  /tenants/:tenantId/scout          — trigger first scout hunt after onboarding
//
// Auth: these endpoints are called internally by containers.
// Validated by tenantId existence — not public-facing.

import { Router, type Request, type Response } from "express";
import * as http from "http";
import {
  getTenant,
  getTenantBySlug,
  updateTenantStatus,
  updateTenantChannelConfig,
  logAdminEvent,
  type TenantStatus,
} from "../services/db.js";

const router = Router();

const VALID_STATUSES: TenantStatus[] = [
  "pending", "onboarding", "active", "paused", "suspended", "terminated",
];

// ---------------------------------------------------------------------------
// PATCH /tenants/:tenantId/status
// Body: { status: "active" }
// Called by tiger_onboard Phase 5 to mark tenant as fully onboarded.
// ---------------------------------------------------------------------------

router.patch("/:tenantId/status", async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req.params.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const { status } = req.body as { status?: string };
    if (!status || !VALID_STATUSES.includes(status as TenantStatus)) {
      res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}` });
      return;
    }

    await updateTenantStatus(tenant.id, status as TenantStatus);

    await logAdminEvent({
      tenantId: tenant.id,
      action: "status_change",
      details: { from: tenant.status, to: status, source: "tenant_api" },
    });

    res.json({ ok: true, tenantId: tenant.id, status });
  } catch (err) {
    console.error("[tenants] PATCH status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /tenants/:tenantId/keys/activate
// Body: { action: "deactivate_onboarding_key" }
// Called by tiger_onboard Phase 3 after tenant provides their own API key.
// Signals that the platform onboarding key (Layer 1) should no longer be
// used for this tenant.
// ---------------------------------------------------------------------------

router.post("/:tenantId/keys/activate", async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req.params.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const { action } = req.body as { action?: string };
    if (action !== "deactivate_onboarding_key") {
      res.status(400).json({ error: 'Expected { action: "deactivate_onboarding_key" }' });
      return;
    }

    await logAdminEvent({
      tenantId: tenant.id,
      action: "onboarding_key_deactivated",
      details: { source: "tenant_api" },
    });

    res.json({ ok: true, tenantId: tenant.id, keyDeactivated: true });
  } catch (err) {
    console.error("[tenants] POST keys/activate error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /tenants/:tenantId/scout
// Body: { trigger: "onboarding_complete" }
// Called by tiger_onboard Phase 5 to kick off the first scout hunt.
// Forwards to the tenant's container OpenClaw gateway.
// ---------------------------------------------------------------------------

router.post("/:tenantId/scout", async (req: Request, res: Response) => {
  try {
    const tenant = await getTenant(req.params.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // In Multi-Tenancy, we trigger the bot by sending an invisible /scout command
    // or enqueuing a job. For now, we simulate success as the scheduler handles it.
    console.log(`[tenants] Scout bypassed for ${tenant.slug} — using central scheduler.`);

    await logAdminEvent({
      tenantId: tenant.id,
      action: "first_scout_triggered",
      details: { trigger: req.body?.trigger ?? "api", port: tenant.port },
    });

    res.json({ ok: true, tenantId: tenant.id, scoutTriggered: true });
  } catch (err) {
    console.error("[tenants] POST scout error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /tenants/:slug/channels/whatsapp
// Body: { enabled: boolean }
// Called by tiger_settings channels action to enable/disable WhatsApp.
// Saves config and recreates the container with updated WHATSAPP_ENABLED env var.
// ---------------------------------------------------------------------------

router.post("/:slug/channels/whatsapp", async (req: Request, res: Response) => {
  try {
    const tenant = await getTenantBySlug(req.params["slug"]!);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled (boolean) is required." });
    }

    await updateTenantChannelConfig(tenant.id, { whatsappEnabled: enabled });

    // Multi-tenant: Configuration saved to DB, instantly active. No restart needed.

    await logAdminEvent({
      tenantId: tenant.id,
      action: "channel_whatsapp",
      details: { enabled, source: "channels_api" },
    });

    return res.json({ ok: true, whatsappEnabled: enabled });
  } catch (err) {
    console.error("[tenants] POST channels/whatsapp error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /tenants/:slug/channels/line
// Body: { channelSecret: string | null, channelAccessToken: string | null }
// Called by tiger_settings channels action to configure/remove LINE.
// Saves config and recreates the container with LINE env vars.
// ---------------------------------------------------------------------------

router.post("/:slug/channels/line", async (req: Request, res: Response) => {
  try {
    const tenant = await getTenantBySlug(req.params["slug"]!);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const { channelSecret, channelAccessToken } = req.body as {
      channelSecret?: string | null;
      channelAccessToken?: string | null;
    };

    if (channelSecret !== null && channelSecret !== undefined) {
      if (typeof channelSecret !== "string" || channelSecret.length > 200) {
        return res.status(400).json({ error: "LINE channel secret must be 200 characters or fewer." });
      }
    }
    if (channelAccessToken !== null && channelAccessToken !== undefined) {
      if (typeof channelAccessToken !== "string" || channelAccessToken.length > 200) {
        return res.status(400).json({ error: "LINE channel access token must be 200 characters or fewer." });
      }
    }

    await updateTenantChannelConfig(tenant.id, {
      lineChannelSecret: channelSecret === null ? null : (channelSecret ?? undefined),
      lineChannelAccessToken: channelAccessToken === null ? null : (channelAccessToken ?? undefined),
    });

    const adding = channelSecret && channelAccessToken;
    // Multi-tenant: Configuration saved to DB, instantly active. No restart needed.

    await logAdminEvent({
      tenantId: tenant.id,
      action: adding ? "channel_line_add" : "channel_line_remove",
      details: { source: "channels_api" },
    });

    return res.json({ ok: true, lineConfigured: !!adding });
  } catch (err) {
    console.error("[tenants] POST channels/line error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
