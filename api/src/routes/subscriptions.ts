import { Router, type Request, type Response } from "express";
import Stripe from "stripe";

const router = Router();
const stripe = process.env["STRIPE_SECRET_KEY"] ? new Stripe(process.env["STRIPE_SECRET_KEY"], { apiVersion: "2023-10-16" }) : null;

// POST /checkout
router.post("/checkout", async (req: Request, res: Response) => {
    try {
        const { email, name, niche, botName, connectionType, aiProvider, aiModel, apiKey } = req.body;

        if (!stripe) {
            // Mock mode for local dev without a real Stripe Key
            console.warn("[subscriptions] No STRIPE_SECRET_KEY provided. Returning mock checkout URL.");
            return res.json({ url: "http://localhost:3000/success?mock=true" });
        }

        // Determine price id (dummy pricing for BYOK blueprint)
        // TIGERCLAW-BLUEPRINT states $97/mo for Tiger Credits, $47/mo for BYOK. 
        // In production we would map these to real Stripe Price IDs.
        const priceId = connectionType === "tiger_credits"
            ? process.env["STRIPE_PRICE_TIGER"]
            : process.env["STRIPE_PRICE_BYOK"];

        if (!priceId) {
            console.warn("[subscriptions] Missing STRIPE_PRICE_ env vars. Returning mock success.");
            return res.json({ url: "http://localhost:3000/success?mock=true" });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",
            customer_email: email,
            metadata: {
                name,
                niche,
                botName,
                connectionType,
                aiProvider,
                aiModel,
                // We should never pass plain-text API keys in Stripe metadata. 
                // In production we'd encrypt it and save to DB before checkout, then 
                // pass the bot DB ID here to activate on success webhook.
                // For MVP we avoid sending apiKey to stripe.
                hasAiKey: apiKey ? "true" : "false"
            },
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: process.env["FRONTEND_URL"] ?? "http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: process.env["FRONTEND_URL"] ?? "http://localhost:3000/cancel",
        });

        return res.json({ url: session.url });

    } catch (err) {
        console.error("[subscriptions] Checkout error:", err);
        return res.status(500).json({ error: "failed_to_create_checkout" });
    }
});

export default router;
