import { Router, type Request, type Response } from "express";
import Stripe from "stripe";

const router = Router();
const stripe = process.env["STRIPE_SECRET_KEY"] ? new Stripe(process.env["STRIPE_SECRET_KEY"], { apiVersion: "2023-10-16" }) : null;

// POST /checkout
// GAP 4: Wire Stripe into Web Wizard
// Key is stored server-side in Step 3 (via /wizard/validate-key, GAP 7).
// Only the botId is passed in Stripe metadata — NEVER the raw API key.
router.post("/checkout", async (req: Request, res: Response) => {
    try {
        const { email, name, niche, botName, connectionType, aiProvider, aiModel, botId } = req.body;

        if (!stripe) {
            // Mock mode for local dev without a real Stripe Key
            console.warn("[subscriptions] No STRIPE_SECRET_KEY provided. Returning mock checkout URL.");
            return res.json({ url: "http://localhost:3000/success?session_id=mock_session" });
        }

        // BYOK only — connectionType is always "byok" (Locked Decision #12: no Tiger Credits)
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
                botName,
                connectionType: connectionType ?? "byok",
                aiProvider: aiProvider ?? "google",
                aiModel: aiModel ?? "gemini-2.5-flash",
                // Pass only the botId — key was already encrypted and stored
                // in Step 3 via POST /wizard/validate-key (GAP 7).
                // Raw API key is NEVER passed through Stripe metadata.
                botId: botId ?? "",
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
