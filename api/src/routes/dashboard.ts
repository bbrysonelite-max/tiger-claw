// Tiger Claw — Customer Dashboard Route
// GAP 9: Customer-facing dashboard endpoint
// GET /dashboard/:slug — returns bot status, usage, subscription info

import { Router, type Request, type Response } from "express";
import {
    getTenantBySlug,
    getTenantBotUsername,
} from "../services/db.js";

const router = Router();

// GET /dashboard/:slug
router.get("/:slug", async (req: Request, res: Response) => {
    const slug = req.params["slug"]!;
    const tenant = await getTenantBySlug(slug);

    if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
    }

    const botUsername = await getTenantBotUsername(tenant.id);

    // Build dashboard data
    const dashboard = {
        tenant: {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            flavor: tenant.flavor,
            region: tenant.region,
            language: tenant.language,
            preferredChannel: tenant.preferredChannel,
            createdAt: tenant.createdAt.toISOString(),
            lastActivityAt: tenant.lastActivityAt?.toISOString() ?? null,
        },
        bot: {
            username: botUsername ? `@${botUsername}` : null,
            telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
            isLive: tenant.status === "active" || tenant.status === "onboarding",
        },
        channels: {
            telegram: {
                enabled: true,
                botUsername: botUsername ?? null,
            },
            whatsapp: {
                enabled: tenant.whatsappEnabled ?? false,
            },
            line: {
                configured: !!(tenant.lineChannelSecret || tenant.lineChannelAccessToken),
            },
        },
        subscription: {
            plan: "byok_basic",
            status: tenant.status === "active" ? "active" : tenant.status,
        },
    };

    return res.json(dashboard);
});

export default router;
