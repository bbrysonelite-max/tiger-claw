import { Router, type Request, type Response } from "express";

const router = Router();

router.post("/validate", async (req: Request, res: Response) => {
    try {
        const { provider, key } = req.body;

        if (!provider || !key || typeof key !== "string" || typeof provider !== "string") {
            return res.status(400).json({ valid: false, reason: "invalid_request" });
        }

        if (provider === "openai") {
            const resp = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${key}` },
            });
            if (resp.ok) {
                return res.json({ valid: true, model: "gpt-4o" });
            } else if (resp.status === 401) {
                return res.json({ valid: false, reason: "invalid_api_key" });
            } else if (resp.status === 429) {
                return res.json({ valid: false, reason: "insufficient_quota" });
            } else {
                return res.json({ valid: false, reason: "network_error" });
            }
        }

        if (provider === "anthropic") {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1,
                    messages: [{ role: "user", content: "hi" }]
                })
            });
            if (resp.ok) {
                return res.json({ valid: true, model: "claude-3-5-sonnet-20241022" });
            } else if (resp.status === 401) {
                return res.json({ valid: false, reason: "invalid_api_key" });
            } else if (resp.status === 403 || resp.status === 429) {
                return res.json({ valid: false, reason: "insufficient_quota" });
            } else {
                return res.json({ valid: false, reason: "network_error" });
            }
        }

        // Defer Google and xAI to V2 as requested by the blueprint MVP Cutline
        if (provider === "google") {
            // Mock for V1 MVP
            return res.json({ valid: true, model: "gemini-2.0-flash" });
        }

        if (provider === "xai") {
            // Mock for V1 MVP
            return res.json({ valid: true, model: "grok-3" });
        }

        return res.status(400).json({ valid: false, reason: "unsupported_provider" });

    } catch (err) {
        console.error("[keys] Validation error:", err);
        return res.status(500).json({ valid: false, reason: "network_error" });
    }
});

export default router;
