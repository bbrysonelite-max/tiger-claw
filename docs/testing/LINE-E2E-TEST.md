# LINE E2E Test

**Phase:** P4-3
**Blueprint:** TIGERCLAW-BLUEPRINT-v3.md §7 item 18, §9 Q4
**Prerequisites:**
- P4-1 passed (container is healthy with SecretRef working)
- A test tenant provisioned and onboarded
- Access to LINE Developers Console (https://developers.line.biz/)

---

## DECISION REQUIRED: LINE Token Source (Blueprint §9 Q4)

> **Does Tiger Claw manage LINE Official Accounts for tenants, or is it self-serve?**

This decision affects onboarding UX, documentation, and whether the wizard needs account creation guidance.

| Option | Description | Implication |
|--------|-------------|-------------|
| **A: Self-serve** | Tenant creates their own LINE Official Account and provides the channel access token via wizard or in-chat command | Simpler for Tiger Claw. Wizard needs clear instructions. Tenant bears LINE account costs. |
| **B: Platform-managed** | Tiger Claw creates and manages LINE Official Accounts on behalf of tenants | Requires LINE Business Partner agreement, API automation, account lifecycle management. Much more complex. |

**Recommendation:** Option A (self-serve) for v3. LINE Official Accounts are free-tier and easy to create. Add platform-managed as a v4 consideration.

**Decision:** [ ] A: Self-serve  [ ] B: Platform-managed

_This decision must be made before executing the test below. The test procedure assumes Option A (self-serve)._

---

## Step 1 — Create a LINE Official Account

1. Go to https://developers.line.biz/
2. Log in (or create a LINE developer account)
3. Create a new Provider (or use an existing one)
4. Create a new **Messaging API Channel**:
   - Channel name: `Tiger Claw Test`
   - Channel description: `E2E test for Tiger Claw LINE integration`
5. Note the following from the channel settings:
   - **Channel secret:** (Basic Settings tab)
   - **Channel access token:** (Messaging API tab → Issue a long-lived channel access token)

```
Channel secret:       _______________
Channel access token: _______________
```

- [ ] **PASS / FAIL:** LINE Official Account created, tokens obtained

---

## Step 2 — Enter token via Channel Wizard

Open the wizard for the test tenant: `https://app.tigerclaw.io/wizard/<test-slug>`

1. Scroll to the LINE section
2. Paste the channel access token into the input field
3. Click "Save Changes"
4. Confirm success feedback

- [ ] **PASS / FAIL:** LINE token saved via wizard

---

## Step 3 — Alternative: enter token via in-chat command

In the Telegram chat with the test bot, send a message that triggers:

```
channels add line <CHANNEL_ACCESS_TOKEN>
```

Confirm the bot responds with "LINE channel configured."

- [ ] **PASS / FAIL:** In-chat `channels add line` command works (or skipped if testing wizard path only)

---

## Step 4 — Confirm tenant record has line_token

```bash
# Query the database directly or use the admin API
curl -s http://localhost:4000/admin/tenants/<test-slug> | python3 -m json.tool
```

**Expected:** `lineToken` field is set to the channel access token.

- [ ] **PASS / FAIL:** Tenant record has line_token set

---

## Step 5 — Verify openclaw.json LINE channel config

```bash
docker exec tiger-claw-<test-slug> cat /root/.openclaw/openclaw.json | python3 -m json.tool
```

**Check for:**

```json
"channels": {
  "line": {
    "enabled": true,
    "channelSecret": "<value>",
    "channelAccessToken": "<value>"
  }
}
```

> **NOTE:** If `openclaw.json` shows `enabled: false` or the LINE token is empty, the `entrypoint.sh` may need additional env var wiring for `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`. Document this gap if found.

- [ ] **PASS / FAIL:** openclaw.json has LINE channel config with correct values
- [ ] **GAP:** If LINE config is missing or incorrect, document what `entrypoint.sh` changes are needed

---

## Step 6 — Configure LINE webhook

In the LINE Developers Console, set the Webhook URL to point to the test container's LINE endpoint:

```
https://<your-public-domain>:<port>/channels/line/webhook
```

> **NOTE:** LINE requires HTTPS with a valid certificate. For local testing, you may need a tunnel (e.g., ngrok). Document the approach used.

Enable the webhook and disable auto-reply messages in the LINE Official Account settings.

- [ ] **PASS / FAIL:** LINE webhook configured and pointing to test container

---

## Step 7 — Send a test message from LINE

1. Add the LINE Official Account as a friend (scan the QR code from the LINE Developers Console)
2. Send a text message: `Hello from LINE`
3. Check container logs for the incoming message:

```bash
docker logs tiger-claw-<test-slug> 2>&1 | grep -i "line\|channel.*message"
```

- [ ] **PASS / FAIL:** Tiger Claw agent received the LINE message

---

## Step 8 — Confirm agent responds via LINE

After receiving the message, the Tiger Claw agent should process it and send a reply back through LINE.

Check:
- Did the LINE user receive a response?
- Is the response content appropriate (agent is in active mode, not onboarding)?

- [ ] **PASS / FAIL:** Tiger Claw agent responded via LINE

---

## Step 9 — Remove LINE and confirm cleanup

Via in-chat command (send a message that triggers):

```
channels remove line
```

Confirm:
- Bot responds with "LINE channel removed."
- Tenant record `lineToken` is null:

```bash
curl -s http://localhost:4000/admin/tenants/<test-slug> | python3 -m json.tool
```

- [ ] **PASS / FAIL:** LINE channel removed, tenant record cleaned up

---

## Test Results

| Step | Description | Result | Notes |
|------|-------------|--------|-------|
| 1 | Create LINE Official Account | | |
| 2 | Enter token via wizard | | |
| 3 | Enter token via in-chat (optional) | | |
| 4 | Tenant record has line_token | | |
| 5 | openclaw.json LINE config | | |
| 6 | LINE webhook configured | | |
| 7 | Receive test message from LINE | | |
| 8 | Agent responds via LINE | | |
| 9 | Remove LINE and cleanup | | |

**Tested by:** _______________
**Date:** _______________
**LINE token source decision (§9 Q4):** [ ] Self-serve  [ ] Platform-managed
**Overall result:** [ ] ALL PASS  [ ] PARTIAL — see gaps below  [ ] BLOCKED — see reason below

**Code gaps identified (if any):**

| Gap | Severity | Fix required before canary? |
|-----|----------|-----------------------------|
| | | |

**entrypoint.sh changes needed (if any):**

| Change | Description |
|--------|-------------|
| | |
