# Phase 3 — Channel Wizard

**Status:** ACTIVE
**Prerequisite:** Phase 2 complete (verified — update pipeline, canary orchestration, deployment state tracking)
**Completion signal:** All five tasks below are checked off, committed, and verified with a test tenant channel setup.

---

## Phase 2 Carry-Forward Notes

1. **SecretRef end-to-end validation still pending.** Implemented in P1-3/P1-4, wired in P2-5 canary flow, but not yet tested with real API keys. Validate during first live canary deployment.
2. **Update pipeline is fully operational.** `ops/build.sh` (version-tagged images), `ops/update.sh` (container replace with rollback), admin bot `/update` commands, `deployment_state.json` tracking, and canary fleet orchestration are all in place.
3. **Bot token pool is a prerequisite for P3-1.** The Channel Wizard assumes each tenant already has a Telegram bot token assigned. P3-0 must build the pool infrastructure before the wizard can reference it.

---

### Task P3-0: Bot token pool infrastructure (PRE-WORK)

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §5, TIGERCLAW-PRD-v3.md FR-CW-1

**Context:** Each tenant needs a unique Telegram bot token. Currently tokens are manually assigned during provisioning. This task formalizes the pool so the provisioner and Channel Wizard can reference assigned tokens.

- [x] Bot pool table exists (`bot_pool` in PostgreSQL with matching schema — `id`, `bot_token`, `bot_username`, `tenant_id` FK, `assigned_at`, `created_at`). Added indexes on `tenant_id` and `(tenant_id, created_at)`.
- [x] Add pool assignment to provisioner: atomic `assignBotToken()` with `SELECT FOR UPDATE SKIP LOCKED` prevents race conditions under concurrent provisioning
- [x] Low-pool alert: sends admin Telegram alert when unassigned tokens drop below 50 (checked after every assignment)
- [x] Script placeholder: `ops/botpool/create_bots.ts` with working `addTokensFromFile()` and stubbed MTProto automation
- [x] Pool management API: `GET /admin/pool/status` (stats), `POST /admin/pool/add` (simple insert)
- [x] DB helpers: `assignBotToken()`, `getTenantBotToken()`, `getPoolStats()`, `addTokenToPool()`

---

### Task P3-1: Channel Wizard web page

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §5, TIGERCLAW-PRD-v3.md FR-CW-2, FR-CW-3

**Context:** A simple HTML page (no framework) that guides a tenant through setting up their messaging channels. Served by the Tiger Claw API.

- [x] Route file: `api/src/routes/wizard.ts`
- [x] URL: `app.tigerclaw.io/wizard/[slug]` (registered at `/wizard/:slug`)
- [x] Serves a simple HTML page (no React/Vue — plain HTML + inline CSS/JS, dark theme)
- [x] Section: **Telegram** (always shown) — pre-filled with bot username from pool or "Pending", link to `t.me/{username}`
- [x] Section: **WhatsApp** (optional) — toggle switch, collapsed details, setup instructions
- [x] Section: **LINE** (optional) — token input form (max 200 chars)
- [x] POST `/wizard/:slug/save` endpoint saves `whatsapp_enabled` and `line_token` to tenant record
- [x] Input validation: HTML escaping on all outputs, LINE token length validation, empty-string → null coercion
- [x] DB: added `whatsapp_enabled` and `line_token` columns to tenants table, `getTenantBotUsername()`, `updateTenantChannelConfig()` helpers

---

### Task P3-2: In-chat channel commands via tiger_settings.ts

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §5, TIGERCLAW-PRD-v3.md FR-CW-4, FR-CW-5

**Context:** Tenants can manage channels directly from their Telegram chat using the settings tool, without visiting the web wizard.

- [x] Add `channels` sub-action to `skill/tools/tiger_settings.ts` (action: "channels", subAction: list/add/remove, channel: whatsapp/line)
- [x] `channels list` — shows Telegram (always active), WhatsApp (enabled/disabled), LINE (configured/not)
- [x] `channels add whatsapp` — POSTs to API, container recreated with `WHATSAPP_ENABLED=true`, returns QR code instructions
- [x] `channels remove whatsapp` — POSTs to API, container recreated without `WHATSAPP_ENABLED`, returns confirmation
- [x] `channels add line [token]` — validates token (max 200 chars), POSTs to API, saves to tenant record
- [x] `channels remove line` — POSTs to API with `token: null`, removes from tenant record
- [x] API endpoints: `POST /tenants/:slug/channels/whatsapp` and `POST /tenants/:slug/channels/line` in `tenants.ts`
- [x] Container restart via `recreateContainerWithEnv()` in `docker.ts` — preserves all config, updates only changed env vars

---

### Task P3-3: WhatsApp Baileys optional channel

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §5, TIGERCLAW-PRD-v3.md FR-CW-6, FR-CW-7

**Context:** WhatsApp via Baileys is an optional outreach channel. Disabled by default. Tenant must explicitly enable it and complete QR code pairing.

- [ ] Add WhatsApp Baileys conditional block to `docker/customer/entrypoint.sh`
- [ ] Only enabled if `WHATSAPP_ENABLED=true` env var is set
- [ ] Session persistence: mount `/root/.openclaw/whatsapp/` as a Docker volume
- [ ] QR code delivery: first-time setup sends QR code image via Telegram to tenant
- [ ] Session recovery: on container restart, resume existing Baileys session from volume
- [ ] Graceful disable: if `WHATSAPP_ENABLED` is unset or `false`, skip Baileys initialization entirely

---

### Task P3-4: Onboarding wizard link

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §5, TIGERCLAW-PRD-v3.md FR-CW-8

**Context:** After onboarding completes, the tenant receives a link to the Channel Wizard for optional channel setup beyond Telegram.

- [ ] Update `skill/tools/tiger_onboard.ts` Phase 5 to send wizard URL after onboarding completes
- [ ] URL format: `https://app.tigerclaw.io/wizard/[slug]`
- [ ] Message includes brief explanation of what the wizard does (add WhatsApp, LINE)
- [ ] Only send if tenant has not already visited the wizard (check tenant record)

---

## Definition of Phase 3 Complete

Phase 3 is complete when ALL of the following are true:

- [ ] Bot token pool table exists and provisioner assigns tokens automatically (P3-0)
- [ ] Channel Wizard web page serves and saves config for Telegram, WhatsApp, LINE (P3-1)
- [ ] In-chat `/settings channels` commands work for add/remove/list (P3-2)
- [ ] WhatsApp Baileys conditional setup works in entrypoint.sh (P3-3)
- [ ] Onboarding sends wizard link after completion (P3-4)
- [ ] All changes committed to GitHub
