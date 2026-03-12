// Tiger Claw — Channel Wizard Routes
// TIGERCLAW-BLUEPRINT-v3.md §5, TIGERCLAW-PRD-v3.md FR-CW-2, FR-CW-3
//
// Serves a plain HTML page (no framework) at /wizard/:slug for tenant
// channel configuration (Telegram, WhatsApp, LINE).
//
// Endpoints:
//   GET  /wizard/:slug       — serve wizard HTML page
//   POST /wizard/:slug/save  — save channel config changes

import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import {
  getTenantBySlug,
  getTenantByEmail,
  getTenantBotUsername,
  updateTenantChannelConfig,
  upsertBYOKConfig,
} from "../services/db.js";
import { encryptToken } from "../services/pool.js";

const router = Router();

const stripe = process.env["STRIPE_SECRET_KEY"]
  ? new Stripe(process.env["STRIPE_SECRET_KEY"])
  : null;

// ── GET /wizard/status ───────────────────────────────────────────────────────
// Polled by PostPaymentSuccess after Stripe redirect.
// Returns provisioning status so the UI can show "live" when the bot is ready.

router.get("/status", async (req: Request, res: Response) => {
  const sessionId = req.query["session_id"] as string | undefined;
  if (!sessionId) {
    return res.status(400).json({ error: "session_id is required" });
  }

  // Retrieve session from Stripe to get the customer's email
  if (!stripe) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  let customerEmail: string | null = null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    customerEmail = session.customer_details?.email ?? null;
  } catch (err) {
    console.error("[wizard] Failed to retrieve Stripe session:", err);
    return res.json({ status: "error", error: "Invalid session_id" });
  }

  if (!customerEmail) {
    return res.json({ status: "pending", botUsername: null, telegramLink: null });
  }

  // Look up tenant by email
  const tenant = await getTenantByEmail(customerEmail);
  if (!tenant || tenant.status === "pending") {
    return res.json({ status: "pending", botUsername: null, telegramLink: null });
  }

  const botUsername = await getTenantBotUsername(tenant.id);
  const isLive = tenant.status === "active" || tenant.status === "onboarding";

  return res.json({
    status: isLive ? "live" : "pending",
    botUsername: botUsername ?? null,
    telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
    tenantSlug: tenant.slug,
  });
});

// ── POST /wizard/validate-key ────────────────────────────────────────────────
// GAP 7 — Server-side BYOK key validation
// Accepts: { provider: "google", key: "AIza...", botId: "<uuid>" }
// Makes a minimal test call to the Gemini API (listModels).
// On success: encrypts the key and stores it in bot_ai_config.
// NEVER logs, echoes, or stores the raw key in plaintext.

router.post("/validate-key", async (req: Request, res: Response) => {
  const { provider, key, botId } = req.body as {
    provider?: string;
    key?: string;
    botId?: string;
  };

  // --- Input validation ---
  if (!provider || !key) {
    return res.status(400).json({
      valid: false,
      error: "Both 'provider' and 'key' fields are required.",
    });
  }

  if (provider !== "google") {
    return res.status(400).json({
      valid: false,
      error: `Unsupported provider "${provider}". Currently only "google" is supported.`,
    });
  }

  if (!key.startsWith("AIza") || key.length < 30) {
    return res.status(400).json({
      valid: false,
      error: "Key format looks wrong — Google API keys start with 'AIza' and are ~39 characters. Check you copied the full key.",
    });
  }

  if (!botId) {
    return res.status(400).json({
      valid: false,
      error: "Missing 'botId' — the bot to associate this key with.",
    });
  }

  // --- Test the key against Gemini API ---
  // Minimal call: GET https://generativelanguage.googleapis.com/v1beta/models?key=...
  // This validates the key without consuming any quota.
  try {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(testUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const googleError = (body as any)?.error;

      if (response.status === 400) {
        return res.json({
          valid: false,
          error: "Google rejected the key — it may be malformed. Double-check you copied the entire key from Google AI Studio.",
        });
      }

      if (response.status === 403) {
        return res.json({
          valid: false,
          error: "Key is valid but the Generative Language API is not enabled for this project. Go to Google Cloud Console → APIs & Services → enable 'Generative Language API'.",
        });
      }

      if (response.status === 401) {
        return res.json({
          valid: false,
          error: "Key rejected by Google — it may be revoked or expired. Generate a new key at https://aistudio.google.com/apikey",
        });
      }

      return res.json({
        valid: false,
        error: `Google API returned HTTP ${response.status}: ${googleError?.message ?? "Unknown error"}. Try generating a new key.`,
      });
    }

    // Key is valid — Google returned a list of models
  } catch (err: any) {
    if (err.name === "AbortError") {
      return res.json({
        valid: false,
        error: "Timed out connecting to Google API. Check your network and try again.",
      });
    }
    return res.json({
      valid: false,
      error: `Could not reach Google API: ${err.message ?? "unknown error"}. Try again in a moment.`,
    });
  }

  // --- Key is valid — encrypt and store ---
  try {
    const encrypted = encryptToken(key);
    const preview = `${key.slice(0, 4)}...${key.slice(-4)}`; // "AIza...xY9z"

    await upsertBYOKConfig({
      botId,
      connectionType: "byok",
      provider: "google",
      model: "gemini-2.5-flash",
      encryptedKey: encrypted,
      keyPreview: preview,
    });

    console.log(`[wizard] BYOK key validated and stored for bot ${botId}`);
    return res.json({ valid: true });
  } catch (err: any) {
    console.error(`[wizard] Failed to store BYOK key for bot ${botId}:`, err.message);
    return res.status(500).json({
      valid: false,
      error: "Key is valid but we failed to save it. Please try again.",
    });
  }
});

// ── GET /wizard/:slug ────────────────────────────────────────────────────────

router.get("/:slug", async (req: Request, res: Response) => {
  const slug = req.params["slug"]!;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return res.status(404).send("Tenant not found.");
  }

  const botUsername = await getTenantBotUsername(tenant.id);

  // Never send LINE credentials back to the browser — show configured/not status only
  const html = renderWizardPage({
    slug: tenant.slug,
    name: tenant.name,
    botUsername,
    whatsappEnabled: tenant.whatsappEnabled,
    lineConfigured: !!(tenant.lineChannelSecret && tenant.lineChannelAccessToken),
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

// ── POST /wizard/:slug/save ──────────────────────────────────────────────────

router.post("/:slug/save", async (req: Request, res: Response) => {
  const slug = req.params["slug"]!;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return res.status(404).json({ error: "Tenant not found." });
  }

  const { whatsappEnabled, lineChannelSecret, lineChannelAccessToken } = req.body as {
    whatsappEnabled?: boolean;
    lineChannelSecret?: string;
    lineChannelAccessToken?: string;
  };

  if (lineChannelSecret !== undefined && lineChannelSecret !== "") {
    if (typeof lineChannelSecret !== "string" || lineChannelSecret.length > 200) {
      return res.status(400).json({ error: "LINE channel secret must be 200 characters or fewer." });
    }
  }
  if (lineChannelAccessToken !== undefined && lineChannelAccessToken !== "") {
    if (typeof lineChannelAccessToken !== "string" || lineChannelAccessToken.length > 200) {
      return res.status(400).json({ error: "LINE channel access token must be 200 characters or fewer." });
    }
  }

  // Encrypt LINE credentials before storage (AES-256-GCM — same as BYOK keys)
  // NEVER store plaintext LINE credentials in the database.
  const encryptedSecret = lineChannelSecret
    ? (lineChannelSecret === "" ? null : encryptToken(lineChannelSecret))
    : undefined;
  const encryptedToken = lineChannelAccessToken
    ? (lineChannelAccessToken === "" ? null : encryptToken(lineChannelAccessToken))
    : undefined;

  await updateTenantChannelConfig(tenant.id, {
    whatsappEnabled: whatsappEnabled ?? undefined,
    lineChannelSecret: lineChannelSecret === "" ? null : encryptedSecret,
    lineChannelAccessToken: lineChannelAccessToken === "" ? null : encryptedToken,
  });

  return res.json({ ok: true });
});

// ── HTML renderer ────────────────────────────────────────────────────────────

interface WizardData {
  slug: string;
  name: string;
  botUsername: string | null;
  whatsappEnabled: boolean;
  lineConfigured: boolean; // true if both LINE credentials are stored — never expose the values
}

function renderWizardPage(data: WizardData): string {
  const telegramStatus = data.botUsername
    ? `<span class="status active">Active</span> — <a href="https://t.me/${esc(data.botUsername)}" target="_blank">@${esc(data.botUsername)}</a>`
    : `<span class="status pending">Pending</span> — token assignment in progress`;

  const waChecked = data.whatsappEnabled ? "checked" : "";
  const waStatus = data.whatsappEnabled
    ? `<span class="status active">Enabled</span>`
    : `<span class="status off">Disabled</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Channel Wizard — ${esc(data.name)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.6; padding: 2rem 1rem; }
  .container { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; color: #f0f3f6; }
  .subtitle { color: #8b949e; font-size: 0.9rem; margin-bottom: 2rem; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
  .card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
  .card p { color: #8b949e; font-size: 0.875rem; margin-bottom: 0.75rem; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
  .status.active { background: #0d4429; color: #3fb950; }
  .status.pending { background: #3d2e00; color: #d29922; }
  .status.off { background: #21262d; color: #8b949e; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; color: #c9d1d9; }
  input[type="text"] { width: 100%; padding: 0.5rem 0.75rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; font-size: 0.875rem; }
  input[type="text"]:focus { outline: none; border-color: #58a6ff; box-shadow: 0 0 0 2px rgba(88,166,255,0.15); }
  .toggle-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
  .toggle { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .slider { position: absolute; inset: 0; background: #30363d; border-radius: 12px; cursor: pointer; transition: background 0.2s; }
  .toggle .slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: #c9d1d9; border-radius: 50%; transition: transform 0.2s; }
  .toggle input:checked + .slider { background: #238636; }
  .toggle input:checked + .slider::before { transform: translateX(20px); }
  .details { overflow: hidden; max-height: 0; transition: max-height 0.3s ease; }
  .details.open { max-height: 200px; }
  details summary { list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: "\\25B6 "; font-size: 0.7rem; }
  details[open] summary::before { content: "\\25BC "; }
  .btn { display: inline-block; padding: 0.5rem 1.25rem; background: #238636; color: #fff; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: background 0.15s; }
  .btn:hover { background: #2ea043; }
  .btn:disabled { background: #21262d; color: #484f58; cursor: not-allowed; }
  .msg { margin-top: 1rem; padding: 0.75rem; border-radius: 6px; font-size: 0.875rem; display: none; }
  .msg.ok { display: block; background: #0d4429; color: #3fb950; border: 1px solid #238636; }
  .msg.err { display: block; background: #3d1519; color: #f85149; border: 1px solid #da3633; }
  .icon { font-size: 1.25rem; }
</style>
</head>
<body>
<div class="container">
  <h1>Channel Wizard</h1>
  <p class="subtitle">${esc(data.name)} &middot; ${esc(data.slug)}</p>

  <!-- Telegram -->
  <div class="card">
    <h2><span class="icon">✈️</span> Telegram</h2>
    <p>Your primary channel. Always active.</p>
    <p>${telegramStatus}</p>
  </div>

  <!-- WhatsApp -->
  <div class="card">
    <h2><span class="icon">💬</span> WhatsApp</h2>
    <p>Optional outreach channel via WhatsApp Web. ${waStatus}</p>
    <div class="toggle-row">
      <label class="toggle">
        <input type="checkbox" id="wa-toggle" ${waChecked}>
        <span class="slider"></span>
      </label>
      <span id="wa-label">${data.whatsappEnabled ? "Enabled" : "Disabled"}</span>
    </div>
    <div class="details${data.whatsappEnabled ? " open" : ""}" id="wa-details">
      <p>When enabled, your agent will send a QR code to your Telegram chat. Scan it with WhatsApp to link your account. Session persists across restarts.</p>
    </div>
  </div>

  <!-- LINE -->
  <div class="card">
    <h2><span class="icon">🟢</span> LINE</h2>
    <p>Optional outreach channel. ${data.lineConfigured ? '<span class="status active">Configured</span>' : '<span class="status off">Not configured</span>'}</p>
    <p>LINE requires a free <a href="https://developers.line.biz/" target="_blank">LINE Official Account</a>. You create and manage your own account.</p>
    <details>
      <summary style="cursor:pointer;color:#58a6ff;font-size:0.875rem;margin-bottom:0.75rem;">Setup guide</summary>
      <ol style="color:#8b949e;font-size:0.85rem;padding-left:1.25rem;margin-bottom:0.75rem;line-height:1.8;">
        <li>Go to <a href="https://developers.line.biz/" target="_blank">developers.line.biz</a> and sign in with a LINE account</li>
        <li>Create a new <strong>Provider</strong>, then create a <strong>Messaging API</strong> channel</li>
        <li>Under channel settings &rarr; <strong>Basic settings</strong> tab &rarr; copy the <strong>Channel secret</strong></li>
        <li>Under the <strong>Messaging API</strong> tab &rarr; scroll to <strong>Channel access token</strong> &rarr; issue and copy it</li>
        <li>Paste both values below</li>
      </ol>
    </details>
    <label for="line-secret">Channel Secret</label>
    <input type="text" id="line-secret" placeholder="${data.lineConfigured ? "Leave blank to keep existing secret" : "Paste your LINE channel secret"}" maxlength="200" style="margin-bottom:0.75rem;">
    <label for="line-access-token">Channel Access Token</label>
    <input type="text" id="line-access-token" placeholder="${data.lineConfigured ? "Leave blank to keep existing token" : "Paste your LINE channel access token"}" maxlength="200">
  </div>

  <button class="btn" id="save-btn" onclick="saveConfig()">Save Changes</button>
  <div class="msg" id="msg"></div>
</div>

<script>
  var waToggle = document.getElementById("wa-toggle");
  var waDetails = document.getElementById("wa-details");
  var waLabel = document.getElementById("wa-label");

  waToggle.addEventListener("change", function() {
    waDetails.classList.toggle("open", this.checked);
    waLabel.textContent = this.checked ? "Enabled" : "Disabled";
  });

  function saveConfig() {
    var btn = document.getElementById("save-btn");
    var msg = document.getElementById("msg");
    btn.disabled = true;
    msg.className = "msg";
    msg.style.display = "none";

    var body = {
      whatsappEnabled: waToggle.checked,
      lineChannelSecret: document.getElementById("line-secret").value.trim(),
      lineChannelAccessToken: document.getElementById("line-access-token").value.trim()
    };

    fetch("/wizard/${esc(data.slug)}/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      if (d.ok) {
        msg.className = "msg ok";
        msg.textContent = "Settings saved.";
        msg.style.display = "block";
      } else {
        msg.className = "msg err";
        msg.textContent = d.error || "Save failed.";
        msg.style.display = "block";
      }
    })
    .catch(function(e) {
      btn.disabled = false;
      msg.className = "msg err";
      msg.textContent = "Network error: " + e.message;
      msg.style.display = "block";
    });
  }
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default router;
