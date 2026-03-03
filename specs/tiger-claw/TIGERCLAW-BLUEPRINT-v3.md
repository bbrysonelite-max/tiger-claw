# Tiger Claw — Blueprint v3

**Status:** CANONICAL — supersedes sections of TIGERCLAW-MASTER-SPEC-v2.md where conflicts exist
**Date:** 2026-03-03
**Author:** Brent "Pebo" Bryson + Claude Sonnet 4
**Trigger:** OpenClaw updates v2026.2.24 through v2026.3.2 + Channel strategy pivot

---

## 1. What This Document Covers

This Blueprint documents three categories of change:

1. **OpenClaw Integration Hardening** — Updates required by OpenClaw v2026.3.2 breaking changes and new features
2. **OpenClaw Update Pipeline** — New capability to manage OpenClaw version upgrades across the tenant fleet without manual container work
3. **Channel Architecture Pivot** — Telegram remains primary (onboarding + admin interface); WhatsApp (Baileys) added as optional outreach channel; LINE formalized as optional add-on; post-onboarding web + in-chat Channel Wizard

Decisions from TIGERCLAW-MASTER-SPEC-v2.md that are NOT referenced here remain in force unchanged.

---

## 2. Critical Unresolved Blocker — OpenClaw Package

**Before any container build will work, this must be resolved.**

`docker/customer/Dockerfile` currently installs:
```
npm install -g @openclaw/openclaw@0.1.0
```

There is no `@openclaw/openclaw@0.1.0` on npm. The current release is `v2026.3.2`. The package name, npm registry path, and installation method must be confirmed by checking OpenClaw's own deployment docs before any Dockerfile changes are made.

**Action required:** Verify the correct `npm install` command for OpenClaw production installs by reading `https://github.com/openclaw/openclaw` installation documentation. Update `docker/customer/Dockerfile` with the verified command and the specific pinned version (currently `2026.3.2`). Do not proceed with Docker image builds until this is resolved.

---

## 3. OpenClaw v2026.3.x Integration Changes

### 3.1 Health Endpoint Alignment (OpenClaw v2026.3.1)

**What changed:** OpenClaw now ships native health endpoints on every container: `/health`, `/healthz`, `/ready`, `/readyz`.

**Impact on Tiger Claw:**

`api/src/services/docker.ts` already calls `container:18789/health` for health checks. This is now the OpenClaw native endpoint — no change needed there.

Two clarifications required:

- **Use `/readyz` for provisioning.** During container startup, `provisioner.ts` waits 30 seconds for the container to become healthy. Switch to polling `/readyz` (not `/health`) — `/readyz` only returns 200 when the gateway is fully initialized and ready to accept messages. `/health` returns 200 as soon as the process is alive. This removes false-positive "healthy" reads during cold start.

- **Tiger Claw API `/health` (port 4000) reports fleet health, not container health.** These are different things. The naming is correct and should not be changed. Document this distinction clearly in the admin runbook.

**LOCKED DECISION B3.1:** Container readiness checks use `/readyz`. Container liveness checks use `/healthz`. Fleet health endpoint at Tiger Claw API port 4000 remains `/health` (unchanged).

### 3.2 SecretRef Migration for Key Management (OpenClaw v2026.2.26 + v2026.3.2)

**What changed:** OpenClaw now has a native external secrets system (`openclaw secrets audit/configure/apply/reload`) supporting 64 credential targets including model API keys.

**Current Tiger Claw approach:** `tiger_keys.ts` manages Layer 2 (tenant primary), Layer 3 (fallback), and Layer 4 (emergency) keys by hot-rewriting `openclaw.json` in place when rotating. This is fragile — a file write mid-read by the OpenClaw gateway can corrupt config.

**New approach:** Migrate Layer 2, 3, and 4 keys to SecretRef storage.

Architecture:
- Keys stored in `~/.openclaw/.secrets/` as files managed by `openclaw secrets`
- `openclaw.json` references them as `{ "$secret": "layer2-key" }` (SecretRef syntax)
- When `tiger_keys.ts` rotates a key, it writes the new value to the secrets file and calls `openclaw secrets reload` via the local gateway API
- No more hot-rewriting the main config file

Layer 1 (Platform Onboarding key) continues to be written directly to `openclaw.json` — it is short-lived and set once at container startup, not rotated in flight.

**LOCKED DECISION B3.2:** Layers 2, 3, and 4 API keys are stored as OpenClaw SecretRef entries. `tiger_keys.ts` writes new key values to the secrets store and triggers `openclaw secrets reload`. Direct `openclaw.json` mutation is removed from the key rotation path.

### 3.3 Telegram Streaming Explicit Configuration (OpenClaw v2026.3.2)

**What changed:** `channels.telegram.streaming` now defaults to `partial` (was `off`). New containers get live streaming preview in Telegram by default.

**Impact:** `entrypoint.sh` generates `openclaw.json` dynamically. If streaming is not explicitly set, new containers after this OpenClaw version will stream partial messages to prospects during nurture and contact sequences. Streaming partial sales messages mid-sentence is not appropriate.

**Required change:** `entrypoint.sh` must set `channels.telegram.streaming: "off"` explicitly in the generated Telegram channel config. Tiger Claw controls its own message delivery — streaming is not desired for sales outreach (briefings to the tenant are acceptable, but outreach to prospects is not).

**Exception:** The tenant's own Telegram interface (briefings, Q&A) can optionally use `partial` streaming as a UX improvement. This can be configured per-account if Tiger Claw ever supports multi-account Telegram config (one for tenant, one for prospects). For now: `streaming: "off"` across the board until multi-account is implemented.

**LOCKED DECISION B3.3:** `channels.telegram.streaming` is explicitly set to `"off"` in all generated `openclaw.json` files. This is not the default — it is an explicit override.

### 3.4 Thinking Level Explicit Configuration (OpenClaw v2026.3.1)

**What changed:** Anthropic Claude 4.6 models now default to `adaptive` thinking level (was `low`). Adaptive thinking uses extended reasoning on complex queries and costs significantly more per call.

**Impact:** Tiger Claw's flywheel tools run frequently (scout daily, briefing daily, nurture touches every 3-5 days per lead, aftercare). `adaptive` thinking on all of these calls would increase costs unpredictably.

**Required change:** Set explicit thinking level in agent config. Recommended: `low` for all automated flywheel tools. The tenant can optionally enable `adaptive` for manual Q&A sessions.

```json
{
  "agents": {
    "defaults": {
      "think": "low"
    }
  }
}
```

**LOCKED DECISION B3.4:** `agents.defaults.think` is explicitly set to `"low"` in generated `openclaw.json`. This is not the default — it is a cost control override.

### 3.5 ACP Dispatch Breaking Change (OpenClaw v2026.3.2)

**What changed:** ACP dispatch now defaults to `enabled` unless explicitly disabled.

**Required assessment:** Tiger Claw's skill tools use OpenClaw's tool execution system. ACP (Agent Communication Protocol) enables inter-agent communication. With ACP enabled by default, tools may now try to spawn subagents in ways that weren't intended.

**Required action:** Test Tiger Claw flywheel tools against OpenClaw v2026.3.2. If ACP spawning causes unexpected behavior in any Tiger Claw tool, add explicit `acp: { enabled: false }` to the container's agent config. This is a test-before-ship item, not a spec decision.

### 3.6 Tool Output Truncation (OpenClaw v2026.3.2)

**What changed:** Tool output truncation now uses head+tail strategy (preserves both start and end of long output, not just the head). This is beneficial — Tiger Claw's `tiger_scout.ts` returns large lead lists. With head+tail, both the newest and oldest leads in a large response stay visible.

**No config change required.** This is a runtime improvement.

---

## 4. Feature: OpenClaw Update Pipeline

### 4.1 Problem

OpenClaw ships updates frequently (multiple per week). There is currently no mechanism to update OpenClaw in running tenant containers. The only path is to rebuild the Docker image and manually recreate containers. This does not scale to 1,000 tenants.

### 4.2 Design Decisions

**LOCKED DECISION B4.1:** OpenClaw version updates use a rebuild-and-rolling-replace model. Containers are not updated in-place. A new Docker image is built with the new OpenClaw version baked in, then rolled out to containers via the canary pipeline.

**Rationale:** In-container `npm update` is unreliable and untestable. Immutable images are easier to roll back, easier to test, and consistent with the existing canary deployment architecture.

**LOCKED DECISION B4.2:** Docker image tags embed both Tiger Claw version and OpenClaw version.

Format: `tiger-claw:{TC_VERSION}-oc{OC_VERSION}`
Example: `tiger-claw:v2026.03.03.1-oc2026.3.2`

**LOCKED DECISION B4.3:** `deployment_state.json` tracks both versions as separate fields.

```json
{
  "tigerClaw": {
    "current": "v2026.03.03.1",
    "previous": "v2026.02.27.1"
  },
  "openClaw": {
    "current": "2026.3.2",
    "previous": "2026.3.1"
  },
  "imageTag": "tiger-claw:v2026.03.03.1-oc2026.3.2",
  "canary": {
    "group": ["slug-a", "slug-b", "slug-c", "slug-d", "slug-e"],
    "startedAt": null,
    "stage": "none"
  },
  "rollout": {
    "stage": "none",
    "percentage": 0,
    "startedAt": null
  }
}
```

### 4.3 Admin Telegram Commands (Update Pipeline)

These commands are added to the admin bot:

| Command | Description |
|---------|-------------|
| `/update status` | Show current TC version, OC version, image tag, canary status, rollout stage |
| `/update build [oc-version]` | Build new Docker image with specified OpenClaw version. Runs `ops/build.sh` on server. |
| `/update canary start` | Deploy new image to canary group (5 tenants). Starts 24h monitoring window. |
| `/update canary advance` | Manually advance canary to next rollout stage (10% → 25% → 50% → 100%) |
| `/update fleet` | Advance rollout to 100% immediately (skip stages). Requires confirmation. |
| `/update rollback` | Roll back to previous image tag. Applies to all containers at last-deployed stage. |
| `/update canary set [slug,slug,slug,slug,slug]` | Set the 5 tenants in the canary group. |

### 4.4 Update Flow

```
Admin: /update build oc2026.3.2
  → ops/build.sh builds tiger-claw:v2026.03.03.1-oc2026.3.2
  → Image pushed to registry
  → deployment_state.json updated

Admin: /update canary start
  → 5 canary tenants: pause flywheel → pull new image → recreate container → health check → resume flywheel
  → 24h monitoring window begins
  → Admin notified of any failures

(24 hours pass, no failures)

Admin: /update canary advance
  → Confirms with admin: "Canary healthy after 24h. Start 10% rollout? (y/n)"
  → 10% of fleet: same pause → pull → recreate → health check → resume pattern
  → 6h soak

Admin: /update canary advance (×3 more)
  → 25% → 50% → 100%

(If failures > 3 consecutive at any stage)
  → Auto-rollback to previous image
  → Admin alerted immediately
```

### 4.5 Container Data Preservation During Updates

All tenant data lives in Docker volumes mounted at container runtime. The container image is stateless — data volumes are separate.

Data that persists across container replacement:
- `~/.openclaw/openclaw.json` (config)
- `~/.openclaw/.secrets/` (SecretRef keys — after B3.2 migration)
- `~/.openclaw/data/` (SQLite, leads.json, nurture state, onboard_state.json, key_state.json, settings.json)
- `~/.openclaw/logs/`

The `ops/provision-customer.sh` volume mount parameters carry over to the update flow. No data is lost during updates.

### 4.6 New Files Required

- `ops/build.sh` — Builds and pushes new Docker image. Accepts `--tc-version` and `--oc-version` args.
- `ops/update.sh` — Executes the container replace flow for a single tenant or group.
- `ops/admin-bot/commands/update.ts` — Admin bot command handler for all `/update` subcommands.

---

## 5. Feature: Channel Architecture Pivot

### 5.1 Channel Roles (Updated)

| Channel | Role | Status |
|---------|------|--------|
| Telegram | Primary: onboarding interview, daily briefing, Q&A, admin interface, flywheel controls | Built (v2) |
| WhatsApp (Baileys) | Optional: prospect outreach only. Tenant's own number. | New (v3) |
| LINE | Optional: prospect outreach (Thailand market primarily) | Partial (v2 entrypoint.sh has scaffold) |
| Reddit | Prospect discovery source (US) | Built |
| Facebook Groups | Prospect discovery source (US + Thailand) | Built |
| Telegram (outreach) | Prospect discovery + outreach source | Built |

**Telegram is not going away.** It handles all tenant-facing interactions. The pivot is about adding WhatsApp as a second outreach channel for reaching prospects, not replacing the tenant interface.

### 5.2 WhatsApp (Baileys) — Design

**LOCKED DECISION B5.1:** WhatsApp channel uses OpenClaw's Baileys-based WhatsApp integration (`@openclaw/whatsapp` extension). Meta WhatsApp Business API is out of scope for v3.

**LOCKED DECISION B5.2:** WhatsApp is opt-in. Tenant enables it via the Channel Wizard. Disabled by default.

**LOCKED DECISION B5.3:** Tenant provides their own WhatsApp number (personal or dedicated). Tiger Claw does not maintain a WhatsApp number pool.

**WhatsApp ToS Risk (Non-negotiable disclosure):** Baileys is an unofficial WhatsApp Web automation library. WhatsApp prohibits bulk messaging and automated outreach using personal accounts. Tenants using WhatsApp for prospect outreach accept the risk that their number may be restricted or banned by WhatsApp. Tiger Claw must include a clear disclosure during WhatsApp setup. Recommended: provide tenants with guidance to use a dedicated SIM card or dedicated number rather than their personal number.

**Container config when WhatsApp enabled:**

```json5
{
  "channels": {
    "whatsapp": {
      "dmPolicy": "allowlist",
      "allowFrom": ["{TENANT_WHATSAPP_NUMBER}"],
      "streaming": "off"
    }
  }
}
```

**How outreach works:** `tiger_contact.ts`, `tiger_nurture.ts`, and `tiger_convert.ts` currently send messages to prospects via whatever channel the prospect was found on. When WhatsApp is enabled, these tools gain the ability to send to WhatsApp numbers that were discovered via WhatsApp-adjacent sources (Facebook Groups, LINE contact handoffs). The prospect's preferred channel is stored in the lead record.

### 5.3 LINE — Formalization

LINE is already partially scaffolded in `entrypoint.sh` (conditional on `LINE_CHANNEL_TOKEN` env var). Formalize it as a first-class optional channel in v3.

No architecture changes needed — just formalize the existing scaffold and wire it into the Channel Wizard.

### 5.4 Channel Wizard

The Channel Wizard solves: "How does a tenant add WhatsApp or LINE after their Telegram onboarding interview completes?"

**Two access points:**

**A. Web Wizard (initial setup)**
Triggered at the end of Phase 5 (Flywheel Start) in `tiger_onboard.ts`. Instead of immediately declaring "setup complete," the onboarding flow sends:

```
Your Tiger Claw is ready on Telegram! 🎉

To add WhatsApp or LINE for prospect outreach, complete setup here:
https://[PLATFORM_DOMAIN]/wizard/[TENANT_SLUG]?token=[SECURE_ONE_TIME_TOKEN]

This link expires in 24 hours. You can also add channels later by messaging me.
```

The web wizard is a simple HTML page served by the Tiger Claw API at `GET /wizard/:slug`. Steps:
1. Welcome screen (Telegram confirmed ✓)
2. WhatsApp (optional): "Connect your WhatsApp → [Connect]"
   → Shows QR code via `openclaw channels login --channel whatsapp` output
   → Polls for QR scan confirmation
   → On success: stores `WHATSAPP_ENABLED=true` and `WHATSAPP_NUMBER` in container env, updates `openclaw.json`
3. LINE (optional): "Connect LINE → [Enter token]"
   → Input field for LINE channel token
   → Validates token
   → Stores `LINE_CHANNEL_TOKEN` in container env, updates `openclaw.json`
4. Confirm: "You're all set. Tiger Claw will start your first scout in a few minutes."

**B. In-Chat (add channels later)**

Via `tiger_settings.ts`:
```
@tigerclaw add channel whatsapp
@tigerclaw add channel line
@tigerclaw remove channel whatsapp
@tigerclaw list channels
```

The `tiger_settings.ts` tool needs new `channels` sub-actions. For WhatsApp: it sends back a QR code image (OpenClaw's Telegram media output) and confirms when pairing succeeds. For LINE: prompts for the bot token.

### 5.5 Entrypoint Changes

`docker/customer/entrypoint.sh` currently hardcodes Telegram setup. Updates required:

1. Telegram section: add explicit `streaming: "off"` and explicit thinking `low`
2. New conditional WhatsApp section: if `WHATSAPP_ENABLED=true`, add WhatsApp channel config
3. New conditional LINE section: already exists, formalize with validation
4. Add SecretRef entries for Layer 2/3/4 keys (B3.2)
5. Set OpenClaw version in startup log for admin visibility

---

## 6. Feature: Onboarding Flow Updates

The 5-phase onboarding interview in `tiger_onboard.ts` requires one addition:

**Phase 5 (Flywheel Start) — Add Channel Wizard Link**

After activating the tenant and triggering the first scout, send the Channel Wizard link before the confirmation message. This is the bridge between the Telegram onboarding interview and the optional WhatsApp/LINE setup.

No changes to Phases 1-4.

---

## 7. What Is NOT Changing (Stays from v2)

These v2 decisions remain fully locked:

- Per-tenant SQLite for prospect data
- Four-layer key management (B3.2 migrates the mechanism; the architecture stays)
- Scoring threshold: 80
- Fallback key required to complete onboarding
- Blue-green deployment with auto-rollback (3 consecutive failures)
- 30-second health check interval
- All flywheel logic as OpenClaw skills (no modifications to OpenClaw core)
- Admin dashboard via Telegram (not web UI at launch)
- One Docker process per tenant (no sidecars)

---

## 8. Implementation Priority Order

Work should proceed in this order. Each item is a prerequisite for the next.

### Phase 0: Unblock the Build (Must do first)
1. Verify OpenClaw npm package name and correct install command
2. Update `docker/customer/Dockerfile` with verified OpenClaw install
3. Build and test a basic container — confirm OpenClaw gateway starts

### Phase 1: OpenClaw Integration Hardening
4. `entrypoint.sh` — set `streaming: "off"`, `think: "low"` explicitly
5. `provisioner.ts` — switch from `/health` to `/readyz` for startup readiness check
6. `tiger_keys.ts` — migrate Layer 2/3/4 key rotation to SecretRef
7. `entrypoint.sh` — add SecretRef setup for keys
8. Assess ACP dispatch impact on Tiger Claw tools (test suite)

### Phase 2: Update Pipeline
9. `ops/build.sh` — parameterized build with dual versioning
10. `deployment_state.json` — dual version tracking
11. `ops/update.sh` — single-tenant container replace flow
12. `ops/admin-bot/commands/update.ts` — admin bot update commands

### Phase 3: Channel Wizard
13. `tiger_settings.ts` — add `channels` sub-actions (list/add/remove)
14. `api/src/routes/wizard.ts` — web wizard route and HTML
15. `entrypoint.sh` — WhatsApp conditional block
16. `tiger_onboard.ts` — Phase 5 wizard link

### Phase 4: WhatsApp + LINE
17. End-to-end WhatsApp (Baileys) outreach test with real Telegram onboarding → wizard → WhatsApp scan → prospect message
18. Verify LINE channel formalization

---

## 9. Questions That Must Be Answered Before Phase 3

Before building the Channel Wizard, answer:

1. **Platform domain:** What is the domain for the Tiger Claw platform? The wizard URL needs a real domain (e.g., `https://tigerclaw.com/wizard/slug`). Is this hosted on the existing DigitalOcean server? Does it need a domain and SSL cert?

2. **QR code display in Telegram:** Can OpenClaw display a QR code image in Telegram? If the tenant is on mobile and the wizard link doesn't work, they need a fallback. Test `openclaw channels login --channel whatsapp` to see what output it produces.

3. **WhatsApp session persistence:** When a tenant's WhatsApp QR session expires (Baileys sessions expire periodically), who is responsible for re-authentication? The tenant would need to re-scan. This is a support burden at scale. Need a plan for session expiry notifications and re-auth flow.

4. **LINE token source:** Does the tenant create a LINE Official Account themselves to get the channel token? Or does Tiger Claw manage LINE Official Accounts for tenants? This determines whether LINE is truly self-serve.

---

## 10. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| OpenClaw npm package doesn't install cleanly | Critical | High | Verify install method before any other work |
| WhatsApp number bans for prospect outreach | High | Medium | Disclosure to tenant; guidance to use dedicated number; enforce rate limits in tiger_contact.ts |
| Baileys WhatsApp session expiry breaks outreach mid-sequence | High | Medium | Session health check in fleet monitor; re-auth notification to tenant via Telegram |
| ACP dispatch breaking change affects Tiger Claw tools | Medium | Unknown | Test against v2026.3.2 before fleet rollout |
| SecretRef migration breaks key rotation in production | High | Low | Test migration path in staging with full key rotation cycle before deploying |
| QR code scan UX fails on mobile (wizard page) | Medium | Medium | Test wizard on mobile; provide fallback in-chat QR code option |
| OpenClaw releases a breaking change mid-rollout | Medium | Medium | Canary pipeline catches this before fleet exposure |
