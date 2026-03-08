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
import { provisionQueue, telegramQueue } from "../services/queue.js";
import {
  createBYOKUser,
  createBYOKBot,
  createBYOKConfig,
  createBYOKSubscription,
  getTenant,
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
  // BUG FIX: email can be undefined — never use non-null assertion downstream
  const email = customer?.email ?? `${slug}@noemail.tigerclaw.io`;
  const language = ((customer as any)?.preferred_locales?.[0] ?? meta["language"] ?? "en").split("-")[0] ?? "en";
  const flavor = meta["flavor"] ?? "network-marketer";
  const region = meta["region"] ?? (language === "th" ? "th-th" : "us-en");
  // BUG FIX: bot token is never passed through Stripe metadata — assigned from pool during provisioning
  const timezone = meta["timezone"] ?? "UTC";
  const preferredChannel = meta["channel"] ?? "telegram";

  console.log(`[webhooks] Stripe checkout for ${name} (${slug}) — triggering provisioning`);

  // Respond immediately to Stripe (must be within 5s)
  res.status(200).json({ received: true });

  // Provision async (non-blocking)
  setImmediate(async () => {
    try {
      // 1. Create User
      const userId = await createBYOKUser(email, name, typeof session.customer === "string" ? session.customer : undefined);

      // 2. BYOK key was validated and stored in DB during wizard Step 3 (POST /wizard/validate-key).
      //    It is identified by meta["botId"] if the wizard pre-created the bot record.
      //    LOCKED DECISION: Raw API keys are NEVER passed through Stripe metadata.
      const finalProvider = meta["aiProvider"] ?? "google";
      const finalModel = meta["aiModel"] ?? "gemini-2.5-flash";

      // 3. Create or reuse Bot Record
      // If the wizard pre-registered a bot (POST /subscriptions/register at Step 2 → 3),
      // meta["botId"] contains that UUID — use it so the BYOK key stored at Step 3 stays linked.
      const preBotId = meta["botId"] && meta["botId"] !== "pending" ? meta["botId"] : null;
      const botId = preBotId ?? await createBYOKBot(userId, meta["botName"] ?? name, flavor, "deploying");

      // 4. Create AI Config only if no pre-registration (wizard already stored key via /wizard/validate-key)
      if (!preBotId) {
        await createBYOKConfig({
          botId,
          connectionType: "byok",
          provider: finalProvider,
          model: finalModel,
          encryptedKey: undefined,
          keyPreview: undefined,
        });
      }

      // 5. Create Subscription
      if (session.subscription) {
        await createBYOKSubscription({
          userId,
          botId,
          stripeSubscriptionId: session.subscription as string,
          planTier: meta["connectionType"] === "byok" ? "byok_basic" : "managed_pro"
        });
      }

      // 6. Enqueue provisioning job — bot token assigned from pool inside provisioner
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
        timezone,
      });

      console.log(`[webhooks] Pushed provisioning job to BullMQ for ${slug}`);
    } catch (err) {
      // BUG FIX: was silently logged — now loud with admin alert
      console.error("[webhooks] [ALERT] Provisioning setup failed for session:", session.id, err);
      await sendAdminAlert(
        `❌ Stripe webhook provisioning FAILED\nSession: ${session.id}\nCustomer: ${name} (${email})\nError: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// POST /webhooks/telegram/:tenantId
// Stateless multi-tenancy routing for all Telegram updates
// ---------------------------------------------------------------------------

router.post("/telegram/:tenantId", async (req: Request, res: Response) => {
  const { tenantId } = req.params;

  if (!tenantId) {
    return res.status(400).json({ error: "tenantId missing." });
  }

  // Ensure tenant exists and is active/onboarding
  const tenant = await getTenant(tenantId);
  if (!tenant || (tenant.status !== "active" && tenant.status !== "onboarding")) {
    console.warn(`[webhooks] Telegram update ignored for inactive tenant: ${tenantId}`);
    return res.status(200).send("OK"); // Acknowledge to stop Telegram from retrying
  }

  const payload = req.body;

  try {
    // Push the payload to BullMQ for asynchronous stateless processing
    await telegramQueue.add('telegram-webhook', {
      tenantId,
      botToken: tenant.botToken,
      payload
    }, {
      removeOnComplete: true,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });

    // Respond quickly to Telegram
    res.status(200).send("OK");
  } catch (err) {
    console.error(`[webhooks] Failed to enqueue Telegram message for ${tenantId}:`, err);
    res.status(500).send("Internal Server Error");
  }
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
