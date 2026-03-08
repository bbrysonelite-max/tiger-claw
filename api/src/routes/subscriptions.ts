import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { createBYOKUser, findOrCreateBYOKBot } from "../services/db.js";

const router = Router();
const stripe = process.env["STRIPE_SECRET_KEY"] ? new Stripe(process.env["STRIPE_SECRET_KEY"], { apiVersion: "2023-10-16" }) : null;

// POST /register
// Called at Step 2 → Step 3 transition in the web wizard.
// Creates a user + bot record early so we have a valid botId before key storage.
// The wizard must call this before POST /wizard/validate-key.
router.post("/register", async (req: Request, res: Response) => {
    try {
        const { email, name, niche, botName } = req.body as {
            email?: string;
            name?: string;
            niche?: string;
            botName?: string;
        };

        if (!email || !name || !niche) {
            return res.status(400).json({ error: "email, name, and niche are required" });
        }

        const userId = await createBYOKUser(email, name);
        const botId = await findOrCreateBYOKBot(userId, botName ?? name, niche);

        console.log(`[subscriptions] Pre-registered user ${userId} / bot ${botId} for ${email}`);
        return res.json({ userId, botId });
    } catch (err) {
        console.error("[subscriptions] Register error:", err);
        return res.status(500).json({ error: "failed_to_register" });
    }
});

// POST /checkout
// GAP 4: Wire Stripe into Web Wizard
// Key is stored server-side in Step 3 (via /wizard/validate-key, GAP 7).
// Only the botId is passed in Stripe metadata — NEVER the raw API key.
router.post("/checkout", async (req: Request, res: Response) => {
    try {
        const { email, name, niche, botName, aiProvider, aiModel, botId } = req.body as {
            email?: string;
            name?: string;
            niche?: string;
            botName?: string;
            aiProvider?: string;
            aiModel?: string;
            botId?: string;
        };

        // Validate required fields
        if (!email || !name || !niche) {
            return res.status(400).json({ error: "email, name, and niche are required" });
        }
        if (!botId) {
            return res.status(400).json({ error: "botId is required — complete Step 3 (AI Connection) first" });
        }

        if (!stripe) {
            // Mock mode for local dev without a real Stripe Key
            console.warn("[subscriptions] No STRIPE_SECRET_KEY provided. Returning mock checkout URL.");
            return res.json({ url: "http://localhost:3000/success?session_id=mock_session" });
        }

        // BYOK only — connectionType is ALWAYS "byok" (Locked Decision: no Tiger Credits)
        const priceId = process.env["STRIPE_PRICE_BYOK"];

        if (!priceId) {
            console.warn("[subscriptions] Missing STRIPE_PRICE_BYOK env var. Returning mock success.");
            return res.json({ url: "http://localhost:3000/success?session_id=mock_session" });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",
            customer_email: email,
            metadata: {
                name,
                niche,
                // BUG FIX: webhook reads meta["flavor"] for provisioning — must match niche selected by user.
                // Without this, all tenants get provisioned as "network-marketer" regardless of choice.
                flavor: niche,
                botName: botName ?? name,
                connectionType: "byok",         // LOCKED — never accept from client
                aiProvider: aiProvider ?? "google",
                aiModel: aiModel ?? "gemini-2.5-flash",
                // Pass only the botId — key was already encrypted and stored
                // in Step 3 via POST /wizard/validate-key (GAP 7).
                // Raw API key is NEVER passed through Stripe metadata.
                botId,
            },
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: (process.env["FRONTEND_URL"] ?? "http://localhost:3000") + "/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: (process.env["FRONTEND_URL"] ?? "http://localhost:3000") + "/cancel",
        });

        return res.json({ url: session.url });

    } catch (err) {
        console.error("[subscriptions] Checkout error:", err);
        return res.status(500).json({ error: "failed_to_create_checkout" });
    }
});

export default router;
