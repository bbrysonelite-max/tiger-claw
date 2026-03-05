// Tiger Claw API — POST /webhooks/stripe
// Stripe checkout.session.completed → automated tenant provisioning
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.1 "Trigger: Stripe/Stan Store Webhook"
//
// Required Stripe metadata on the checkout session:
//   metadata.slug              — URL-safe tenant identifier (e.g. "john-doe")
//   metadata.flavor            — bot flavor (e.g. "network-marketer")
//   metadata.region            — region code (e.g. "us-en")
//   metadata.bot_token         — Telegram bot token
//   metadata.timezone          — e.g. "America/Phoenix"
// Customer fields:
//   customer_details.name
//   customer_details.email
//   customer_details.preferred_locales[0] → language

import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { provisionQueue } from "../services/queue.js";
import {
  createBYOKUser,
  createBYOKBot,
  createBYOKConfig,
  createBYOKSubscription
} from "../services/db.js";
import { sendAdminAlert } from "./admin.js";

const router = Router();

const stripe = process.env["STRIPE_SECRET_KEY"]
  ? new Stripe(process.env["STRIPE_SECRET_KEY"])
  : null;

const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";

// ---------------------------------------------------------------------------
// POST /webhooks/stripe
// ---------------------------------------------------------------------------

router.post("/stripe", async (req: Request, res: Response) => {
  // Validate Stripe signature
  if (!stripe || !WEBHOOK_SECRET) {
    console.warn("[webhooks] Stripe not configured — skipping signature check");
    return res.status(503).json({ error: "Stripe not configured" });
  }

  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  try {
    // req.body must be the raw Buffer — see index.ts for rawBody middleware
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[webhooks] Stripe signature verification failed:", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  // We only care about completed checkout sessions
  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata ?? {};
  const customer = session.customer_details;

  // Extract provisioning params from session
  const slug = meta["slug"] ?? slugify(customer?.name ?? "tenant");
  const name = customer?.name ?? meta["name"] ?? slug;
  const email = customer?.email ?? undefined;
  const language = ((customer as any)?.preferred_locales?.[0] ?? meta["language"] ?? "en").split("-")[0] ?? "en";
  const flavor = meta["flavor"] ?? "network-marketer";
  const region = meta["region"] ?? (language === "th" ? "th-th" : "us-en");
  const botToken = meta["bot_token"];
  const timezone = meta["timezone"] ?? "UTC";
  const preferredChannel = meta["channel"] ?? "telegram";

  console.log(`[webhooks] Stripe checkout for ${name} (${slug}) — triggering provisioning`);

  // Respond immediately to Stripe (must be within 5s)
  res.status(200).json({ received: true });

  // Provision async (non-blocking)
  setImmediate(async () => {
    try {
      // 1. Create User
      const userId = await createBYOKUser(email!, name, typeof session.customer === "string" ? session.customer : undefined);

      // 2. Extract BYOK Config / Keys from Stripe Session
      let finalKeyToStore = null;
      let finalKeyPreview = null;
      let finalProvider = meta["aiProvider"];
      let finalModel = meta["aiModel"];

      // If bypassing stripe keys and passing them over direct API (production mode)
      // Usually webhook shouldn't have raw keys, but for MVP validation we'll fall back safely
      if (meta["hasAiKey"] === "true" && meta["rawKey"]) {
        const { encryptToken } = await import("../services/pool.js");
        finalKeyToStore = encryptToken(meta["rawKey"]);
        finalKeyPreview = meta["rawKey"].slice(0, 8) + "...";
      }

      // 3. Create Bot Record
      const botId = await createBYOKBot(userId, meta["botName"] ?? name, flavor, "deploying");

      // 4. Create AI Config
      await createBYOKConfig({
        botId,
        connectionType: meta["connectionType"] ?? "tiger_credits",
        provider: finalProvider,
        model: finalModel,
        encryptedKey: finalKeyToStore ?? undefined,
        keyPreview: finalKeyPreview ?? undefined
      });

      // 5. Create Subscription
      if (session.subscription) {
        await createBYOKSubscription({
          userId,
          botId,
          stripeSubscriptionId: session.subscription as string,
          planTier: meta["connectionType"] === "byok" ? "byok_basic" : "managed_pro"
        });
      }

      // 6. trigger Kubernetes provisioning
      await provisionQueue.add('tenant-provisioning', {
        userId,
        botId,
        slug,
        name,
        email,
        flavor,
        region,
        language,
        preferredChannel,
        botToken,
        timezone,
      });

      console.log(`[webhooks] Pushed provisioning job to BullMQ for ${slug}`);
    } catch (err) {
      console.error("[webhooks] Unexpected provisioning error:", err);
      // Wait to alert
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) + "-" + Date.now().toString(36);
}

export default router;
