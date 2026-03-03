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
import {
  getTenantBySlug,
  getTenantBotUsername,
  updateTenantChannelConfig,
} from "../services/db.js";

const router = Router();

// ── GET /wizard/:slug ────────────────────────────────────────────────────────

router.get("/:slug", async (req: Request, res: Response) => {
  const slug = req.params["slug"]!;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return res.status(404).send("Tenant not found.");
  }

  const botUsername = await getTenantBotUsername(tenant.id);

  const html = renderWizardPage({
    slug: tenant.slug,
    name: tenant.name,
    botUsername,
    whatsappEnabled: tenant.whatsappEnabled,
    lineToken: tenant.lineToken,
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

  const { whatsappEnabled, lineToken } = req.body as {
    whatsappEnabled?: boolean;
    lineToken?: string;
  };

  // Validate lineToken
  if (lineToken !== undefined && lineToken !== null && lineToken !== "") {
    if (typeof lineToken !== "string" || lineToken.length > 200) {
      return res.status(400).json({ error: "LINE token must be a string of 200 characters or fewer." });
    }
  }

  await updateTenantChannelConfig(tenant.id, {
    whatsappEnabled: whatsappEnabled ?? undefined,
    lineToken: lineToken === "" ? null : lineToken,
  });

  return res.json({ ok: true });
});

// ── HTML renderer ────────────────────────────────────────────────────────────

interface WizardData {
  slug: string;
  name: string;
  botUsername: string | null;
  whatsappEnabled: boolean;
  lineToken?: string;
}

function renderWizardPage(data: WizardData): string {
  const telegramStatus = data.botUsername
    ? `<span class="status active">Active</span> — <a href="https://t.me/${esc(data.botUsername)}" target="_blank">@${esc(data.botUsername)}</a>`
    : `<span class="status pending">Pending</span> — token assignment in progress`;

  const waChecked = data.whatsappEnabled ? "checked" : "";
  const waStatus = data.whatsappEnabled
    ? `<span class="status active">Enabled</span>`
    : `<span class="status off">Disabled</span>`;

  const lineVal = esc(data.lineToken ?? "");

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
    <p>Optional outreach channel. Provide your LINE Messaging API channel token.</p>
    <label for="line-token">Channel Token</label>
    <input type="text" id="line-token" placeholder="Enter your LINE channel token" value="${lineVal}" maxlength="200">
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
      lineToken: document.getElementById("line-token").value.trim()
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
