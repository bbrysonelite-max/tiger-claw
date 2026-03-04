# WhatsApp Baileys E2E Test

**Phase:** P4-2
**ADR:** 0005-whatsapp-baileys-optional.md
**Blueprint:** TIGERCLAW-BLUEPRINT-v3.md S7 item 17, S9 Q2/Q3
**Prerequisites:**
- P4-1 passed (container is healthy with SecretRef working)
- P4-5 complete (bot token pool has at least 1 token)
- A dedicated WhatsApp test number (NOT a personal number -- see ADR-0005 ToS risk)
- A smartphone with WhatsApp installed on the test number

---

## Step 1 — Provision a test tenant

The test tenant must have a bot token assigned from the pool.

```bash
# Via the provisioner API (adjust URL for your environment)
curl -s -X POST http://localhost:4000/admin/tenants/provision \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-whatsapp","name":"WhatsApp E2E Test Tenant","telegramChatId":"YOUR_TELEGRAM_CHAT_ID"}' \
  | python3 -m json.tool
```

Confirm the tenant is provisioned and the container is running:

```bash
docker ps --filter name=tiger-claw-test-whatsapp
curl -s -o /dev/null -w "%{http_code}" http://localhost:TENANT_PORT/readyz
```

- [ ] **PASS / FAIL:** Test tenant provisioned, container running, /readyz 200

---

## Step 2 — Complete full onboarding via Telegram

Open the bot in Telegram (t.me/BOT_USERNAME) and run through all 5 onboarding phases:

1. Phase 1 -- Identity (6 questions): use test data
2. Phase 2 -- ICP (5 questions + confirm): use test data
3. Phase 3 -- Key Setup: provide a valid Anthropic key (primary + fallback)
4. Phase 4 -- Naming Ceremony: name the bot
5. Phase 5 -- Flywheel Start: confirm activation message

- [ ] **PASS / FAIL:** Full onboarding flow completed via Telegram without errors

---

## Step 3 — Confirm wizard link in final onboarding message

After Phase 5 completes, the bot should send a message containing:

```
Your Tiger Claw is ready on Telegram!

To add WhatsApp or LINE for prospect outreach, complete your channel setup here:
https://app.tigerclaw.io/wizard/test-whatsapp
```

- [ ] **PASS / FAIL:** Wizard link received in final onboarding message

---

## Step 4 — Enable WhatsApp via wizard page

Open the wizard URL in a browser: https://app.tigerclaw.io/wizard/test-whatsapp

1. Confirm the page loads with Telegram, WhatsApp, and LINE sections
2. Toggle WhatsApp ON
3. Click "Save Changes"
4. Confirm success feedback

- [ ] **PASS / FAIL:** Wizard page loads, WhatsApp toggle works, save succeeds

---

## Step 5 — Confirm container recreated with WHATSAPP_ENABLED=true

```bash
docker inspect tiger-claw-test-whatsapp \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep WHATSAPP
```

**Expected:**

```
WHATSAPP_ENABLED=true
```

Also confirm the WhatsApp session directory exists:

```bash
docker exec tiger-claw-test-whatsapp ls -la /root/.openclaw/whatsapp/
```

- [ ] **PASS / FAIL:** Container has WHATSAPP_ENABLED=true, /root/.openclaw/whatsapp/ exists

---

## Step 6 — Alternative: enable via in-chat command

If Step 4 was tested via wizard, optionally also test the in-chat path:

1. In the Telegram chat with the bot, send a message that triggers `channels add whatsapp`
2. Confirm the bot responds with the QR code instructions message

- [ ] **PASS / FAIL:** In-chat channels add whatsapp command works (or skipped)

---

## Step 7 — Trigger QR code pairing

### OBSERVE AND DOCUMENT: QR code output format (Blueprint S9 Q2)

> **Open question:** Does `openclaw channels login --channel whatsapp` display a scannable QR code in Telegram? What format is the output -- ASCII art, image, or text URL?

Run from inside the container:

```bash
docker exec -it tiger-claw-test-whatsapp openclaw channels login --channel whatsapp
```

**Document the exact output here:**

```
(paste output)
```

**Questions to answer:**
- Does it produce a QR code image? [ ] Yes [ ] No
- Does it produce ASCII QR art? [ ] Yes [ ] No
- Does it produce a text URL? [ ] Yes [ ] No
- Can the output be forwarded to the tenant via Telegram? [ ] Yes [ ] No [ ] Needs custom handling

- [ ] **PASS / FAIL:** QR pairing command executed -- output documented above

---

## Step 8 — Scan QR code with test WhatsApp account

Using the smartphone with the dedicated test WhatsApp number:

1. Open WhatsApp -> Settings -> Linked Devices -> Link a Device
2. Scan the QR code from Step 7
3. Confirm the link is established

- [ ] **PASS / FAIL:** WhatsApp QR scan completed, link established

---

## Step 9 — Confirm session is established

```bash
docker exec tiger-claw-test-whatsapp ls -la /root/.openclaw/whatsapp/
```

**Expected:** Session files present (e.g., creds.json, app-state-sync-*, or similar Baileys session artifacts).

- [ ] **PASS / FAIL:** Session files exist in /root/.openclaw/whatsapp/

---

## Step 10 — Send a test prospect message via WhatsApp

Trigger a test outreach message from the Tiger Claw agent to a test prospect phone number via WhatsApp.

Method depends on available tooling -- options:
- Via tiger_contact.ts if outreach flow is built
- Via direct OpenClaw API call:

```bash
curl -s http://localhost:TENANT_PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"channels.send","params":{"channel":"whatsapp","to":"PROSPECT_NUMBER","text":"Test message from Tiger Claw"}}'
```

- Via manual tool invocation inside the container

**Document which method was used and the result:**

```
(paste command and output)
```

- [ ] **PASS / FAIL:** Test prospect message sent via WhatsApp

---

## Step 11 — Session persistence: restart with volume

```bash
# Restart the container (volume should be mounted)
docker restart tiger-claw-test-whatsapp

# Wait for startup
sleep 20

# Confirm readyz
curl -s -o /dev/null -w "%{http_code}" http://localhost:TENANT_PORT/readyz

# Confirm session files still present
docker exec tiger-claw-test-whatsapp ls -la /root/.openclaw/whatsapp/
```

**Expected:** Session survives the restart. No re-scan needed.

Optionally: send another test message to confirm WhatsApp is still linked.

- [ ] **PASS / FAIL:** Session survived container restart (with volume mounted)

---

## Step 12 — Session loss: restart without volume

```bash
# Stop container, remove it, recreate WITHOUT the whatsapp volume mount
docker stop tiger-claw-test-whatsapp
docker rm tiger-claw-test-whatsapp

# Recreate without the volume (simulating missing volume mount)
# Use the same docker run command from provisioner but omit the whatsapp volume
```

After startup, check:

```bash
docker exec tiger-claw-test-whatsapp ls -la /root/.openclaw/whatsapp/
```

**Expected:** Session directory is empty (created by entrypoint but no session files). Tenant would need to re-scan QR code.

- [ ] **PASS / FAIL:** Session lost without volume -- confirms volume mount is required

---

## OBSERVE AND DOCUMENT: Session Expiry Behavior (Blueprint S9 Q3)

> **Open question:** What happens when the Baileys WhatsApp session expires? How long do sessions last? Is there an event or error that Tiger Claw can detect to notify the tenant?

After completing the test steps above, leave the test container running for an extended period (or research Baileys session lifecycle). Document:

- **Observed session lifetime:** _______________
- **Expiry behavior:** (does the container crash? does it log an error? does it silently fail?)
- **Detection method:** (is there a webhook, log event, or health check that indicates session loss?)
- **Proposed re-auth flow:** (how should Tiger Claw notify the tenant to re-scan?)
- **Defer to Phase 5?** [ ] Yes, defer re-auth notification design [ ] No, needs immediate fix

---

## Test Results

| Step | Description | Result | Notes |
|------|-------------|--------|-------|
| 1 | Provision test tenant | | |
| 2 | Full onboarding via Telegram | | |
| 3 | Wizard link in onboarding message | | |
| 4 | Enable WhatsApp via wizard | | |
| 5 | Container recreated with WHATSAPP_ENABLED | | |
| 6 | Enable via in-chat command (optional) | | |
| 7 | QR code pairing command output | | |
| 8 | QR scan with test WhatsApp | | |
| 9 | Session files confirmed | | |
| 10 | Test prospect message sent | | |
| 11 | Session persists after restart (with volume) | | |
| 12 | Session lost after restart (no volume) | | |

**Tested by:** _______________
**Date:** _______________
**Test WhatsApp number:** _______________
**QR output format (S9 Q2 answer):** _______________
**Session expiry behavior (S9 Q3 answer):** _______________
**Overall result:** [ ] ALL PASS  [ ] PARTIAL -- see gaps below  [ ] BLOCKED -- see reason below

**Code gaps identified (if any):**

| Gap | Severity | Fix required before canary? |
|-----|----------|-----------------------------|
| | | |
