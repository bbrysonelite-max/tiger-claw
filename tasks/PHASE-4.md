# Phase 4 — WhatsApp + LINE E2E Verification

**Status:** ACTIVE
**Prerequisite:** Phase 3 complete (verified — Channel Wizard, in-chat channel commands, WhatsApp Baileys conditional block, bot token pool, onboarding wizard link)
**Completion signal:** All six tasks below are checked off, all E2E test results documented, and first canary deployment either completed or blocked with a clear reason.

---

## Phase 3 Carry-Forward Notes

1. **SecretRef end-to-end validation still pending.** Implemented in P1-3/P1-4, wired into `openclaw.json` generation in `entrypoint.sh`, and integrated into the P2-5 canary flow — but never tested with a live API key through the full rotation cycle. This is the highest-priority carry-forward item.
2. **WhatsApp Baileys E2E test pending.** Conditional block added to `entrypoint.sh` (P3-3), wizard toggle works (P3-1), in-chat `channels add whatsapp` works (P3-2), but no one has ever run the full flow: onboard → enable WhatsApp → QR scan → send prospect message. Blueprint §9 Q2 (QR display in Telegram) and Q3 (session expiry handling) are still unanswered.
3. **LINE E2E test pending.** Wizard token input (P3-1) and in-chat `channels add line` (P3-2) save to the tenant record, but the actual LINE messaging route has not been tested. Blueprint §9 Q4 (LINE token source — self-serve vs platform-managed) is still unanswered.
4. **Bot token pool needs tokens before any live deployment.** The `bot_pool` table and assignment flow are built (P3-0), but the pool is empty. Tokens must be manually loaded via `ops/botpool/create_bots.ts addTokensFromFile()` or `POST /admin/pool/add` before provisioning any tenant.
5. **Update pipeline is fully built but untested on real infrastructure.** `ops/build.sh`, `ops/update.sh`, admin bot `/update` commands, `deployment_state.json` tracking, and canary fleet orchestration are all in place from Phase 2.

---

### Task P4-0: Create PHASE-4.md (this document)

**Blueprint ref:** N/A — housekeeping

- [x] Create `tasks/PHASE-4.md` with all Phase 4 tasks, carry-forward notes, and definition of done
- [x] Update `CLAUDE.md` to point to Phase 4

---

### Task P4-1: SecretRef E2E validation

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md Risk Register ("SecretRef migration breaks key rotation in production"), ADR-0007
**Carry-forward from:** Phase 1 (P1-3/P1-4), Phase 2 (P2-5 canary flow)

**Context:** SecretRef is wired end-to-end in code but has never been tested with a real API key. A failed rotation in production would silently break every LLM call for the affected tenant. This must be validated before any canary deployment.

**Test procedure (manual, on a dev/staging container):**

1. Provision a test container with a valid Anthropic key as Layer 1 (`ANTHROPIC_API_KEY` env var)
2. Confirm `~/.openclaw/secrets.json` is seeded on startup (P1-4 entrypoint logic)
3. Confirm `openclaw.json` has `secrets.providers.filemain` and `models.providers.anthropic.apiKey` pointing to SecretRef
4. Confirm `/readyz` returns 200 and an LLM call succeeds (test via the gateway)
5. Simulate Layer 2 rotation: write a new valid key to `secrets.json`, trigger `POST /rpc {"method":"secrets.reload"}`, confirm `/readyz` returns 200, confirm LLM call uses new key
6. Simulate failed rotation: write an invalid key to `secrets.json`, trigger `secrets.reload`, confirm gateway enters degraded state but keeps last-known-good key, confirm LLM call still succeeds
7. Simulate recovery: write the valid key back, trigger `secrets.reload`, confirm gateway recovers

Checklist:

- [x] Write the test procedure above as a runnable script or step-by-step checklist in `docs/testing/SECRETREF-E2E-TEST.md`
- [ ] Execute the test on a local Docker container with a real Anthropic API key
- [ ] Document pass/fail for each step in `docs/testing/SECRETREF-E2E-TEST.md`
- [ ] If any step fails, file a bug and fix before proceeding to P4-4

**DECIDED:** Use the operator's dev Anthropic API key for the SecretRef E2E test.

---

### Task P4-2: WhatsApp Baileys E2E test procedure

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §7 item 17, §9 Q2/Q3, Risk Register ("WhatsApp number bans", "Baileys session expiry")
**Depends on:** P4-1 (container must be healthy), P4-5 (pool must have at least one token)

**Context:** The full WhatsApp flow has never been executed end-to-end. Multiple unknowns remain: does `openclaw channels login --channel whatsapp` produce a scannable QR in Telegram? Does session persistence across container restarts actually work? Does prospect outreach via WhatsApp succeed?

**Test procedure (manual, on a dev container):**

1. Provision a test tenant (must have a bot token assigned from pool)
2. Complete the full onboarding flow via Telegram (Phases 1-5 of `tiger_onboard.ts`)
3. Confirm the wizard link is received in the final onboarding message
4. Visit the wizard page, toggle WhatsApp ON, save
5. Confirm container is recreated with `WHATSAPP_ENABLED=true` (check container env)
6. Alternatively: send `channels add whatsapp` in-chat and confirm same result
7. Trigger QR code pairing: run `openclaw channels login --channel whatsapp` from within the container (or via skill layer) — document what output is produced
8. Scan QR code with a test WhatsApp account
9. Confirm session is established (check `/root/.openclaw/whatsapp/` for session files)
10. Send a test prospect message via WhatsApp from the Tiger Claw agent
11. Restart the container (with volume mounted) and confirm session survives
12. Restart the container (without volume) and confirm session is lost — re-scan required

Checklist:

- [x] Write the test procedure as a step-by-step checklist in `docs/testing/WHATSAPP-E2E-TEST.md`
- [ ] Answer Blueprint §9 Q2: does `openclaw channels login --channel whatsapp` display a QR code in Telegram? Document the actual output.
- [ ] Answer Blueprint §9 Q3: what happens when the Baileys session expires? Document the observed behavior and design a re-auth notification flow (or document it as a Phase 5 item).
- [ ] Execute the test on a local Docker container with the operator's personal WhatsApp number (see decision below)
- [ ] Document pass/fail for each step in `docs/testing/WHATSAPP-E2E-TEST.md`
- [ ] If any step fails, file a bug, identify the code gap, and fix or defer with a clear reason

**DECIDED:** Use the operator's personal WhatsApp number for the E2E test. ADR-0005 ToS risk acknowledged — limit testing to functional QR scan + single test message only. Do NOT run the flywheel against this number during testing.

---

### Task P4-3: LINE E2E test procedure

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §7 item 18, §9 Q4
**Depends on:** P4-1 (container must be healthy)

**Context:** LINE channel configuration saves to the tenant record and the wizard renders a token input, but no one has verified that OpenClaw actually routes messages through LINE when the token is set. Blueprint §9 Q4 (LINE token source) is still unanswered.

**Test procedure (manual, on a dev container):**

1. Create a LINE Official Account (free tier) via https://developers.line.biz/
2. Obtain channel secret and channel access token
3. Enter the token via the Channel Wizard (`/wizard/:slug`) and save
4. Alternatively: send `channels add line [token]` in-chat and confirm it saves
5. Confirm the tenant record has `line_token` set
6. Verify `openclaw.json` has the LINE channel config (`channels.line.enabled: true`)
7. Send a test message from a LINE user to the LINE Official Account
8. Confirm the Tiger Claw agent receives the message and responds
9. Remove LINE via `channels remove line` and confirm cleanup

Checklist:

- [x] Write the test procedure as a step-by-step checklist in `docs/testing/LINE-E2E-TEST.md`
- [x] Answer Blueprint §9 Q4: is LINE self-serve (tenant creates their own Official Account) or platform-managed? **DECIDED: Self-serve.** Tenants create and manage their own LINE Official Account at https://developers.line.biz/. Tiger Claw does not manage LINE accounts.
- [ ] Update Channel Wizard LINE section (`api/src/routes/wizard.ts`) to include step-by-step instructions for creating a LINE Official Account (link to LINE Developer Console, explain channel secret vs. channel access token)
- [ ] Execute the test on a local Docker container with a real LINE Official Account
- [ ] Document pass/fail for each step in `docs/testing/LINE-E2E-TEST.md`
- [ ] If any step fails, file a bug, identify the code gap, and fix or defer with a clear reason
- [ ] If LINE integration requires additional `entrypoint.sh` changes (e.g., `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` env var wiring that isn't present), document the gap

---

### Task P4-4: First canary deployment

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §4 (B4.1–B4.5), ADR-0006
**Depends on:** P4-1 (SecretRef validated), P4-5 (pool has tokens), P4-2/P4-3 (channel flows verified or deferred)

**Context:** The full update pipeline (Phase 2) and bot token pool (Phase 3) are built but untested on real infrastructure. This task exercises the complete deployment lifecycle for the first time.

**Pre-flight checklist (must all pass before starting):**

- [ ] Bot token pool has at least 10 tokens loaded (5 for canary + 5 reserve)
- [ ] `deployment_state.json` exists and is initialized (run `ops/build.sh` to create initial entry)
- [ ] GHCR authentication works: `docker login ghcr.io` with `GITHUB_TOKEN`
- [ ] Canary group is set via `/update canary set [operator,debbie-cameron,john-emmeron,toon-pontoon,tiger-test-canary-5]`
- [ ] SecretRef E2E test (P4-1) passed
- [ ] All 5 canary tenants are in "active" status and healthy (`/readyz` 200)

**Deployment procedure:**

1. Build: `/update build` via admin bot (or `ops/build.sh --tc-version v2026.03.04.1 --oc-version 2026.3.2`)
2. Verify: confirm image pushed to GHCR, `deployment_state.json` updated
3. Canary start: `/update canary start` via admin bot
4. Verify: all 5 canary containers updated, `/readyz` 200, no errors in logs
5. Monitor 24h soak window — check container logs, LLM call success, flywheel activity
6. If zero failures after 24h: `/update canary advance` to 10%, then 25%, 50%, 100% at operator discretion
7. If failures: `/update rollback`, document failure cause, fix, rebuild, restart canary

Checklist:

- [ ] Provision `tiger-test-canary-5` dedicated test tenant before starting the canary
- [ ] Pre-flight checklist fully passes
- [ ] Build succeeds and image is in GHCR
- [ ] Canary start succeeds (all 5 containers updated and healthy)
- [ ] 24h soak window passes with zero failures
- [ ] Fleet rollout to 100% completes (or document why it was stopped)
- [ ] Document the full deployment timeline and any issues in `docs/testing/FIRST-CANARY-REPORT.md`

**DECIDED:** Canary group is: operator's own tenant + Debbie Cameron (Spain) + John Emmeron (Thailand) + Toon Pontoon (Los Angeles) + one dedicated test tenant (`tiger-test-canary-5`, to be provisioned before canary start).

---

### Task P4-5: Bot token pool replenishment planning

**Blueprint ref:** TIGERCLAW-BLUEPRINT-v3.md §5 (P3-0 notes), `ops/botpool/create_bots.ts`

**Context:** The MTProto automation stub (`ops/botpool/create_bots.ts`) is shelved — it requires GramJS and separate Telegram account credentials, which is out of scope for Phase 4. For the first canary deployment, tokens must be loaded manually. This task documents the manual process and determines the minimum count.

Checklist:

- [x] Document the manual bot creation process in `docs/operations/BOT-POOL-MANUAL-IMPORT.md`:
  - Step-by-step: open @BotFather → `/newbot` → name → username → copy token
  - How to format the JSON file for `addTokensFromFile()`: `[{ "botToken": "...", "botUsername": "..." }, ...]`
  - How to load: `npx tsx ops/botpool/create_bots.ts --file tokens.json` or `curl -X POST /admin/pool/add`
- [x] Determine minimum token count for first canary: 5 canary tenants + 5 reserve = **10 minimum**
- [x] Determine minimum token count for first fleet rollout: total expected tenants + 20% buffer
- [ ] Create 10 bot tokens manually via @BotFather and load them into the pool for P4-4
- [ ] Verify pool stats via `GET /admin/pool/status` — confirm `unassigned >= 10`
- [x] Document the long-term plan for MTProto automation (target Phase 5 or later)

---

## Definition of Phase 4 Complete

Phase 4 is complete when ALL of the following are true:

- [ ] SecretRef full rotation cycle tested and documented (P4-1)
- [ ] WhatsApp Baileys E2E flow tested or gaps clearly documented (P4-2)
- [ ] LINE E2E flow tested or gaps clearly documented (P4-3)
- [ ] First canary deployment completed successfully (P4-4)
- [ ] Bot token pool has sufficient tokens for fleet rollout (P4-5)
- [ ] All test results documented in `docs/testing/`
- [ ] All changes committed to GitHub
