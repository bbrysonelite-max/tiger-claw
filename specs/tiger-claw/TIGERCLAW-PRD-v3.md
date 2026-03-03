# Tiger Claw — Product Requirements Document v3

**Status:** CANONICAL
**Date:** 2026-03-03
**Author:** Brent "Pebo" Bryson + Claude Sonnet 4
**Companion document:** TIGERCLAW-BLUEPRINT-v3.md

---

## 1. Product Vision

Tiger Claw v3 ships a hardened, upgradeable, multi-channel AI sales engine. The three outcomes:

1. **It stays current.** OpenClaw ships updates weekly. Tiger Claw v3 can incorporate them without manual work or tenant downtime, through an admin-controlled canary pipeline.
2. **It reaches prospects where they are.** Telegram is the operational backbone. WhatsApp and LINE are optional outreach channels tenants can add without leaving Telegram.
3. **It doesn't break when the platform underneath it changes.** The OpenClaw integration is hardened against version drift, streaming behavior changes, and key rotation failures.

---

## 2. Personas

**Platform Admin (Brent):** Operates the Tiger Claw fleet via Telegram admin bot. Monitors health, manages deployments, provisions tenants, controls canary rollouts.

**Tenant:** A network marketer, real estate agent, or health & wellness professional who has paid for Tiger Claw. Uses Telegram daily for briefings and Q&A. May optionally enable WhatsApp or LINE for prospect outreach.

**Prospect:** A potential customer or distributor found by Tiger Claw's Scout. Receives outreach messages on whatever channel Tiger Claw found them on (Telegram, WhatsApp, Facebook, etc.). Never knows they're talking to an AI agent for the first contact or nurture sequence.

---

## 3. Problems Being Solved

### Problem 1: OpenClaw updates break Tiger Claw silently

OpenClaw released 6 updates in 7 days (Feb 24 – Mar 3, 2026). Three of those contained breaking changes. Currently, Tiger Claw has no process to:
- Know when OpenClaw releases a new version
- Test the new version against Tiger Claw's tools before deploying
- Roll out updates to tenant containers safely
- Roll back if something breaks

Result: The platform will fall behind OpenClaw versions, miss security patches, and eventually break when accumulated breaking changes make the pinned version incompatible with the host environment.

### Problem 2: Key rotation is fragile

`tiger_keys.ts` rotates API keys by hot-writing `openclaw.json` while the OpenClaw gateway is running. This creates a race condition on every key rotation event. OpenClaw v2026.3.2 added a native secret management system (SecretRef) that handles this correctly. Tiger Claw must migrate to it.

### Problem 3: Streaming and thinking defaults changed

OpenClaw v2026.3.2 changed `channels.telegram.streaming` to default `partial` and v2026.3.1 set Claude 4.6 `think` to `adaptive`. Neither of these is appropriate for Tiger Claw's automated sales sequences. Without explicit overrides in the generated config, containers built on new OpenClaw versions will exhibit different behavior from containers built on old versions.

### Problem 4: WhatsApp is listed as a supported channel but isn't wired up

`skill/config/regions/us-en.ts` lists `primaryChannels: ['telegram', 'whatsapp']` but `entrypoint.sh` only configures Telegram. WhatsApp is never actually enabled. There is no path for a tenant to add WhatsApp.

### Problem 5: No channel wizard exists

After onboarding, tenants are given a fully functional Tiger Claw on Telegram. If they want to enable WhatsApp or LINE for outreach, there is no guided path. The `tiger_settings.ts` tool has no channel management capability.

---

## 4. Scope

### In Scope (v3)

- OpenClaw health endpoint update (`/readyz` for provisioning)
- SecretRef migration for API key rotation
- Explicit `streaming: "off"` and `think: "low"` in generated configs
- Docker image dual-versioning (TC + OC versions in tag)
- `ops/build.sh` — parameterized image build
- `ops/update.sh` — single-tenant container replace
- Admin bot update commands (`/update status/build/canary/fleet/rollback`)
- `deployment_state.json` dual-version tracking
- WhatsApp (Baileys) as optional outreach channel
- Channel Wizard web page (served by Tiger Claw API)
- Channel Wizard in-chat commands (`tiger_settings.ts` channels sub-actions)
- `tiger_onboard.ts` Phase 5 — wizard link delivery
- `entrypoint.sh` — WhatsApp conditional config block

### Out of Scope (v3)

- Meta WhatsApp Business API / WABA
- WhatsApp as the tenant admin interface (Telegram stays primary for briefings and Q&A)
- Discord, Slack, or any channel not currently in OpenClaw's supported list
- Multi-tenant WhatsApp number pool (tenants bring their own numbers)
- Automated OpenClaw version detection (admin manually specifies version in `/update build`)
- Kubernetes migration (still Docker Compose at current scale)

---

## 5. Functional Requirements

### 5.1 OpenClaw Update Pipeline

**FR-UP-1:** The system maintains a `deployment_state.json` file on the server that records:
- Current Tiger Claw version
- Current OpenClaw version baked into the running image
- Current Docker image tag
- Canary group (5 tenant slugs)
- Current rollout stage and percentage
- Previous image tag (for rollback)

**FR-UP-2:** The Docker image tag format is `tiger-claw:{TC_VERSION}-oc{OC_VERSION}`. Both versions are resolvable from the tag alone.

**FR-UP-3:** `ops/build.sh` accepts `--tc-version` and `--oc-version` arguments, builds the image with those versions embedded, and pushes to the configured registry.

**FR-UP-4:** `ops/update.sh` accepts a tenant slug and an image tag. It executes the update sequence for that tenant:
1. Pause flywheel (set `flywheel_paused: true` in settings.json via container exec)
2. Pull new image
3. Stop container
4. Recreate container with new image (same volumes, same env)
5. Wait for `/readyz` to return 200 (max 60 seconds)
6. If health check fails: restore previous image, resume flywheel, report failure
7. Resume flywheel
8. Log update event to admin_events table

**FR-UP-5:** The admin Telegram bot handles these commands:

`/update status` — Returns:
```
Tiger Claw: v2026.03.03.1
OpenClaw:   2026.3.2
Image:      tiger-claw:v2026.03.03.1-oc2026.3.2
Canary:     [slug-a, slug-b, slug-c, slug-d, slug-e]
Stage:      none (100% on current image)
```

`/update build oc2026.3.3` — Triggers `ops/build.sh` on server, sends confirmation when image is ready.

`/update canary start` — Deploys new image to canary group. Sends per-tenant status as each completes. Reports summary.

`/update canary advance` — Advances rollout: none → 10% → 25% → 50% → 100%. Requires confirmation reply. Reports completion.

`/update fleet` — Advances directly to 100%. Requires explicit confirmation: "Reply YES to deploy to all tenants."

`/update rollback` — Rolls back to the previous image tag. Applies to all tenants currently on the new image. Requires confirmation.

**FR-UP-6:** Automatic rollback triggers if 3 consecutive tenants fail health check during any rollout stage. Admin is notified immediately with failure details and rollback confirmation.

**FR-UP-7:** All update operations write events to the `admin_events` table with: timestamp, operation type, tenant slug (if applicable), image tag, success/failure, and error details.

### 5.2 OpenClaw Integration Hardening

**FR-IH-1:** `provisioner.ts` uses `/readyz` (not `/health`) to confirm container readiness during provisioning. Polling interval: 2 seconds. Max wait: 60 seconds. Container marked as failed if `/readyz` does not return 200 within the window.

**FR-IH-2:** All generated `openclaw.json` files include explicit `channels.telegram.streaming: "off"` regardless of OpenClaw version defaults.

**FR-IH-3:** All generated `openclaw.json` files include explicit `agents.defaults.think: "low"` regardless of OpenClaw version defaults.

**FR-IH-4:** `tiger_keys.ts` stores Layer 2, 3, and 4 API keys using OpenClaw SecretRef format. Key rotation writes the new value to the secrets store and triggers `openclaw secrets reload` instead of rewriting `openclaw.json`.

**FR-IH-5:** Layer 1 (Platform Onboarding key) continues to be written directly to `openclaw.json` at container startup. It is not a SecretRef.

**FR-IH-6:** `docker/customer/Dockerfile` installs a verified, pinned OpenClaw version using the correct npm install command. The version is parameterized (not hardcoded) so `ops/build.sh` can specify it at build time.

### 5.3 Channel Wizard — Web

**FR-CW-1:** The Tiger Claw API serves a Channel Wizard page at `GET /wizard/:slug?token=:token`. The token is a one-time token generated during Phase 5 of onboarding, stored in the tenant record, and valid for 24 hours.

**FR-CW-2:** The wizard page is a server-rendered HTML page (no React/SPA). It works on mobile Safari and Chrome. No external dependencies (no CDN, no Google Fonts).

**FR-CW-3:** The wizard page shows the tenant's current channel status (Telegram: connected ✓).

**FR-CW-4:** The wizard page offers WhatsApp setup as an optional step. Clicking "Connect WhatsApp" initiates the Baileys QR pairing flow:
- Server generates QR code via `openclaw channels login --channel whatsapp` (invoked inside the tenant container via Docker exec)
- QR code image is displayed on the wizard page
- Page polls for pairing confirmation every 3 seconds
- On success: wizard advances, WhatsApp shown as connected ✓
- On timeout (120 seconds): shows retry option

**FR-CW-5:** The wizard page offers LINE setup as an optional step. Clicking "Connect LINE" shows a text input for the LINE channel token. Submitting validates the token by invoking the LINE config update inside the tenant container. On success: LINE shown as connected ✓.

**FR-CW-6:** At the end of the wizard, the page shows a summary and sends a confirmation message to the tenant's Telegram.

**FR-CW-7:** The wizard page includes a WhatsApp ToS disclosure before the QR scan step:
> "Tiger Claw uses WhatsApp Web to send messages. This is not the official WhatsApp Business API. WhatsApp's terms of service prohibit automated outreach. Use a dedicated phone number, not your personal number. Your number may be restricted if WhatsApp detects unusual activity."

The tenant must check an acknowledgment box before the QR code is displayed.

### 5.4 Channel Wizard — In-Chat

**FR-IC-1:** `tiger_settings.ts` adds a `channels` action group with these sub-actions:
- `list` — shows all configured channels and their status (connected / not configured)
- `add whatsapp` — initiates WhatsApp QR pairing flow, sends QR image in Telegram
- `add line` — prompts for LINE channel token, validates, stores
- `remove whatsapp` — disconnects WhatsApp, removes channel config
- `remove line` — removes LINE channel config

**FR-IC-2:** The in-chat `add whatsapp` flow sends a QR code image to the tenant's Telegram chat. Pairing confirmation is detected within 120 seconds. If the tenant has already scanned but something went wrong, it retries from the beginning.

**FR-IC-3:** Channel add/remove operations write to both the container's `openclaw.json` and the tenant record in PostgreSQL (so fleet health monitoring knows what channels each tenant has).

### 5.5 Onboarding Update

**FR-OB-1:** At the end of Phase 5 (Flywheel Start), `tiger_onboard.ts` generates a one-time Channel Wizard token, stores it in the tenant record with a 24-hour expiry, and sends the wizard URL to the tenant in Telegram before the completion message.

**FR-OB-2:** The Channel Wizard link message reads:
> "One more step — your Tiger Claw is running on Telegram. To add WhatsApp or LINE for reaching prospects, visit: [URL]. This link expires in 24 hours. You can also add channels later by saying 'add channel'."

**FR-OB-3:** If the tenant does not complete the Channel Wizard within 24 hours, they receive a single follow-up reminder in Telegram at the 23-hour mark.

---

## 6. Non-Functional Requirements

**NFR-1: Update pipeline rollout does not drop messages.** Each container's flywheel is paused before the container is stopped. Any pending outreach messages that were queued but not sent are preserved in the data volume and resume after restart.

**NFR-2: Channel Wizard page loads in under 2 seconds on a 4G mobile connection.** No external fonts, no heavy JavaScript, no CDN dependencies.

**NFR-3: WhatsApp QR code display in the wizard is available within 10 seconds** of the tenant clicking "Connect WhatsApp."

**NFR-4: SecretRef key rotation completes in under 3 seconds** from the time `tiger_keys.ts` writes the new key value to the time the OpenClaw gateway is using it.

**NFR-5: Container replacement during update takes no more than 90 seconds** from pause signal to flywheel resume (excluding image pull time, which is pre-cached).

**NFR-6: Admin update commands respond within 5 seconds** with a status acknowledgment even if the underlying operation takes longer (operations run async, admin gets progress messages).

---

## 7. User Stories

### Update Pipeline

**US-UP-1:** As the platform admin, when OpenClaw ships a new version, I can build a new Docker image with that version in a single command and see confirmation when it's ready.

**US-UP-2:** As the platform admin, I can deploy the new image to 5 canary tenants and monitor for 24 hours before touching the rest of the fleet.

**US-UP-3:** As the platform admin, if the canary tenants are all healthy after 24 hours, I can advance the rollout in stages (10% → 25% → 50% → 100%) with a single command per stage.

**US-UP-4:** As the platform admin, if any stage of the rollout causes 3 consecutive failures, the system automatically rolls back and alerts me with the failure details.

**US-UP-5:** As the platform admin, I can roll back to the previous image at any time with a single command.

**US-UP-6:** As the platform admin, I always know what OpenClaw version and Tiger Claw version each container is running by checking `/update status`.

### Channel Wizard

**US-CW-1:** As a new tenant, after completing my Telegram onboarding interview, I receive a link to set up additional channels. I can click it on my phone and it takes me to a simple page.

**US-CW-2:** As a new tenant, I can skip the Channel Wizard and still have a fully functional Tiger Claw on Telegram.

**US-CW-3:** As a new tenant, if I want WhatsApp for prospect outreach, I click "Connect WhatsApp," see a QR code, scan it with my phone, and receive a confirmation in Telegram when it's done.

**US-CW-4:** As an existing tenant, I can add WhatsApp at any time by messaging Tiger Claw: "add channel whatsapp" — I receive a QR code in Telegram to scan.

**US-CW-5:** As a tenant in the Thailand market, I can connect my LINE bot during the wizard or later via chat.

**US-CW-6:** As a tenant, I can see which channels I have connected at any time by asking "list channels."

### OpenClaw Hardening

**US-IH-1:** As the platform admin, when I deploy a container built on a new OpenClaw version, the container's behavior (streaming, thinking level) is identical to the previous version because Tiger Claw explicitly overrides defaults.

**US-IH-2:** As the platform admin, when Tiger Claw rotates a tenant's API key due to a 401 error, the rotation completes without corrupting the tenant's config file.

**US-IH-3:** As the platform admin, when I provision a new tenant, the provisioning step confirms the container is fully ready before marking it as "onboarding" — not just that the process started.

---

## 8. Acceptance Criteria

### AC-UP-1: Image Build
- `ops/build.sh --tc-version v2026.03.03.1 --oc-version 2026.3.2` completes without error
- Built image is tagged `tiger-claw:v2026.03.03.1-oc2026.3.2`
- `docker inspect` of the image confirms the OpenClaw version installed matches `2026.3.2`
- `deployment_state.json` is updated with the new image tag

### AC-UP-2: Canary Rollout
- `/update canary start` updates all 5 canary containers to the new image
- Each canary container passes `/readyz` before being marked as updated
- Admin receives per-tenant confirmation in Telegram as each completes
- No prospects receive duplicate messages due to the pause/resume cycle

### AC-UP-3: Automatic Rollback
- Simulate 3 consecutive container failures during a rollout
- System automatically rolls back all updated containers to the previous image
- Admin receives alert with specific failure details within 30 seconds of rollback trigger

### AC-CW-1: Web Wizard — WhatsApp
- Visiting `/wizard/:slug?token=:token` shows the wizard page
- Page loads on mobile Safari in under 2 seconds
- WhatsApp ToS disclosure is shown and requires acknowledgment before QR display
- QR code appears within 10 seconds of clicking Connect
- After QR scan, Telegram confirmation message arrives within 15 seconds

### AC-CW-2: In-Chat WhatsApp
- Tenant sends "add channel whatsapp" in Telegram
- Tiger Claw responds with a QR code image in Telegram
- After scan, Tiger Claw confirms WhatsApp is connected
- `tiger_settings.ts` `list channels` shows WhatsApp as connected

### AC-IH-1: Streaming Override
- New container built on OpenClaw v2026.3.2 has `channels.telegram.streaming: "off"` in `openclaw.json`
- Tiger Claw briefing messages are delivered as complete messages, not streaming partials

### AC-IH-2: SecretRef Key Rotation
- Simulate a 401 error from tenant primary key
- `tiger_keys.ts` writes new Layer 3 key to secrets store and triggers `openclaw secrets reload`
- `openclaw.json` is NOT modified during the rotation
- Next API call uses Layer 3 key successfully

### AC-IH-3: Readiness Check
- During provisioning, `provisioner.ts` polls `/readyz` (not `/health`)
- Container is not marked as "onboarding" until `/readyz` returns 200
- If `/readyz` does not return 200 within 60 seconds, provisioning fails and admin is alerted

---

## 9. Open Questions

These must be answered before starting Phase 3 (Channel Wizard):

**OQ-1:** What is the platform domain for Tiger Claw? The wizard URL needs a real public domain with SSL. Is `tigerclaw.com` registered? Is a subdomain appropriate (e.g., `app.tigerclaw.com`)?

**OQ-2:** `openclaw channels login --channel whatsapp` generates a QR code in the terminal. How is this surfaced as an image in a web page? Does OpenClaw's API have a way to get the QR as a PNG/base64? Or does Tiger Claw need to use a QR generation library and wire into the Baileys pairing event?

**OQ-3:** What happens to a tenant's WhatsApp session when the container is restarted for an update? Does Baileys re-authenticate automatically from the stored session data (in the volume), or does the tenant need to re-scan? This determines whether WhatsApp is viable for the automatic update pipeline.

**OQ-4:** For the Thailand market — does the tenant create their own LINE Official Account and provide the channel access token, or does Tiger Claw manage LINE Official Accounts? This is the difference between self-serve LINE and platform-managed LINE.

**OQ-5:** Should the wizard token be tied to a specific tenant IP (for security), or just a one-time URL? One-time URL is simpler. IP-binding adds friction on mobile (IP can change between WiFi and LTE).

---

## 10. Risk Register

| ID | Risk | Impact | Likelihood | Owner | Mitigation |
|----|------|--------|------------|-------|------------|
| R1 | OpenClaw npm package name/version is wrong — container builds fail | Critical | High | Brent | Verify install method before all other work. Phase 0. |
| R2 | Baileys WhatsApp session expires after container update — tenant must re-scan | High | High | Platform | Test update cycle with WhatsApp connected. If sessions don't persist, document re-scan flow and notify tenants proactively. |
| R3 | WhatsApp number banned for outreach activity | High | Medium | Tenant | Mandatory ToS disclosure in wizard. Rate limits in tiger_contact.ts enforced. Guidance to use dedicated numbers. |
| R4 | ACP dispatch breaking change causes Tiger Claw tools to spawn unintended subagents | Medium | Unknown | Cursor dev | Test all 13 tools against OpenClaw v2026.3.2 before fleet rollout. Explicit `acp.enabled: false` if needed. |
| R5 | SecretRef migration breaks key rotation in production | High | Low | Cursor dev | Test full rotation cycle (L2→L3→L4→pause) in staging. Rollback plan: revert to direct config write. |
| R6 | Wizard QR code display doesn't work on mobile | Medium | Medium | Cursor dev | Test on iOS Safari + Android Chrome during dev. Fallback: in-chat QR code path already required. |
| R7 | Rolling update causes duplicate messages to prospects during pause/resume | High | Low | Cursor dev | Verify message delivery deduplication in OpenClaw's cron isolated delivery. Test with active nurture sequence. |
| R8 | OpenClaw ships another breaking change before v3 ships | Medium | High | Platform | Monitor OpenClaw releases weekly. Run `gh api repos/openclaw/openclaw/releases` check in the admin briefing. |

---

## 11. Definition of Done

Tiger Claw v3 is complete when:

1. A container built with the correct OpenClaw v2026.3.2 starts, completes a 5-phase onboarding, runs a scout, sends a first contact message, and delivers a daily briefing — all without errors.
2. The admin can trigger a fleet update from Telegram, including canary phase, with automatic rollback on failure.
3. A tenant can complete WhatsApp setup via the web wizard on a mobile phone in under 5 minutes.
4. A tenant can add or remove channels in-chat without touching any config files.
5. Key rotation under a simulated 401 error uses SecretRef — `openclaw.json` is not modified at runtime.
6. `deployment_state.json` correctly reflects the running TC and OC versions after a canary rollout.
