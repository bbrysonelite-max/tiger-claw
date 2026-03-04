# SecretRef E2E Test — Full Rotation Cycle

**Phase:** P4-1
**ADR:** 0007-secretref-key-rotation.md
**Prerequisite:** A valid Anthropic API key (dev key or dedicated test key with spend limits — NOT a production tenant key)

---

## Setup

Start a test container with a valid Anthropic key as Layer 1:

```bash
# Replace <YOUR_TEST_KEY> with a real Anthropic API key
export TEST_KEY="sk-ant-REPLACE_ME"
export CONTAINER="tiger-claw-test-secretref"
export PORT=18789

docker run -d \
  --name "$CONTAINER" \
  -p "$PORT:$PORT" \
  -e ANTHROPIC_API_KEY="$TEST_KEY" \
  -e TENANT_SLUG="test-secretref" \
  -e TIGER_CLAW_TENANT_ID="test-secretref-001" \
  ghcr.io/bbrysonelite-max/tiger-claw:latest
```

Wait 15-30 seconds for the gateway to start, then begin the test steps.

---

## Step 1 — Confirm secrets.json is seeded on startup

The P1-4 entrypoint logic creates ~/.openclaw/secrets.json with the Layer 1 key.

```bash
docker exec "$CONTAINER" cat /root/.openclaw/secrets.json
```

**Expected output:**

```json
{
  "active": {
    "apiKey": "sk-ant-..."
  }
}
```

**Also verify file permissions (must be 600):**

```bash
docker exec "$CONTAINER" stat -c '%a' /root/.openclaw/secrets.json
```

**Expected:** 600

- [ ] **PASS / FAIL:** secrets.json exists with correct key and permissions

---

## Step 2 — Confirm openclaw.json has SecretRef wiring

```bash
docker exec "$CONTAINER" cat /root/.openclaw/openclaw.json | python3 -m json.tool
```

**Check for these two blocks:**

1. secrets.providers.filemain pointing to ~/.openclaw/secrets.json
2. models.providers.anthropic.apiKey with source: "file", provider: "filemain", id: "/active/apiKey"
3. models.providers.openai.apiKey with same SecretRef (added in P1-4 fix)

- [ ] **PASS / FAIL:** openclaw.json has SecretRef configuration for both providers

---

## Step 3 — Confirm /readyz returns 200 and LLM call succeeds

```bash
# Readiness check
curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/readyz
```

**Expected:** 200

```bash
# Minimal LLM call through the gateway
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"chat.complete","params":{"model":"anthropic/claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5}}' \
  | python3 -m json.tool
```

**Expected:** A valid response with model output (any non-error response confirms the key works).

- [ ] **PASS / FAIL:** /readyz 200 and LLM call succeeds with Layer 1 key

---

## Step 4 — Simulate Layer 2 rotation (valid key)

Write a new valid key to secrets.json and trigger reload.

```bash
# Replace with a SECOND valid Anthropic key (can be the same key if you only have one)
export NEW_KEY="sk-ant-REPLACE_ME_LAYER2"

# Write new key to secrets.json
docker exec "$CONTAINER" sh -c "echo '{\"active\":{\"apiKey\":\"'$NEW_KEY'\"}}' > /root/.openclaw/secrets.json"
```

Trigger secrets reload via RPC:

```bash
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"secrets.reload"}' \
  | python3 -m json.tool
```

**Expected:** Success response (no error).

Confirm readiness and LLM call:

```bash
# Readyz
curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/readyz

# LLM call (should use new key)
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"chat.complete","params":{"model":"anthropic/claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5}}' \
  | python3 -m json.tool
```

**Expected:** /readyz 200, LLM call succeeds with new key.

- [ ] **PASS / FAIL:** Layer 2 rotation succeeded — secrets.reload accepted, /readyz 200, LLM call works

---

## Step 5 — Simulate failed rotation (invalid key)

Write an obviously invalid key to secrets.json and trigger reload.

```bash
# Write invalid key
docker exec "$CONTAINER" sh -c 'echo '"'"'{"active":{"apiKey":"sk-ant-INVALID-KEY-000000000000"}}'"'"' > /root/.openclaw/secrets.json'

# Trigger reload
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"secrets.reload"}' \
  | python3 -m json.tool
```

Per ADR-0007, the gateway should:
- Keep the **last-known-good snapshot** (the valid key from Step 4)
- Enter **degraded secrets state** and emit SECRETS_RELOADER_DEGRADED
- NOT crash

Verify:

```bash
# Readyz — should still return 200 (last-known-good key is active)
curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/readyz

# LLM call — should still succeed (using last-known-good key)
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"chat.complete","params":{"model":"anthropic/claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5}}' \
  | python3 -m json.tool
```

**Check container logs for degraded state event:**

```bash
docker logs "$CONTAINER" 2>&1 | grep -i "degraded\|SECRETS_RELOADER"
```

- [ ] **PASS / FAIL:** Failed rotation kept last-known-good key, /readyz 200, LLM still works
- [ ] **PASS / FAIL:** Container logs show degraded state event (or document actual behavior)

---

## Step 6 — Simulate recovery (restore valid key)

Write the valid key back and trigger reload.

```bash
# Restore valid key
docker exec "$CONTAINER" sh -c "echo '{\"active\":{\"apiKey\":\"'$NEW_KEY'\"}}' > /root/.openclaw/secrets.json"

# Trigger reload
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"secrets.reload"}' \
  | python3 -m json.tool
```

Verify recovery:

```bash
# Readyz
curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/readyz

# LLM call
curl -s http://localhost:$PORT/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"chat.complete","params":{"model":"anthropic/claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5}}' \
  | python3 -m json.tool
```

**Check container logs for recovery event:**

```bash
docker logs "$CONTAINER" 2>&1 | grep -i "recovered\|SECRETS_RELOADER"
```

- [ ] **PASS / FAIL:** Recovery succeeded — /readyz 200, LLM works, logs show recovery event

---

## Step 7 — Migration path test (key_state.json exists, secrets.json missing)

This tests the one-time migration in entrypoint.sh: if key_state.json exists but secrets.json does not, the entrypoint resolves the active layer and seeds secrets.json.

```bash
# Stop and remove the test container
docker stop "$CONTAINER" && docker rm "$CONTAINER"

# Create a temp directory with a key_state.json but NO secrets.json
mkdir -p /tmp/secretref-migration-test
```

Write a key_state.json to the temp directory:

```bash
cat > /tmp/secretref-migration-test/key_state.json << 'EOF'
{
  "activeLayer": 2,
  "layer2Key": "sk-ant-REPLACE_WITH_VALID_KEY",
  "layer3Key": "sk-ant-REPLACE_WITH_FALLBACK_KEY",
  "lastUpdated": "2026-03-03T00:00:00Z"
}
EOF
```

Start container mounting this directory (simulating pre-SecretRef tenant):

```bash
docker run -d \
  --name "$CONTAINER" \
  -p "$PORT:$PORT" \
  -e ANTHROPIC_API_KEY="$TEST_KEY" \
  -e TENANT_SLUG="test-secretref" \
  -e TIGER_CLAW_TENANT_ID="test-secretref-001" \
  -v /tmp/secretref-migration-test:/app/data \
  ghcr.io/bbrysonelite-max/tiger-claw:latest
```

Wait 15-30 seconds, then verify:

```bash
# secrets.json should have been created with the Layer 2 key from key_state.json
docker exec "$CONTAINER" cat /root/.openclaw/secrets.json

# Readyz should pass
curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/readyz
```

**Expected:** secrets.json contains the Layer 2 key, /readyz 200.

- [ ] **PASS / FAIL:** Migration path works — secrets.json created from key_state.json active layer

---

## Cleanup

```bash
docker stop "$CONTAINER" && docker rm "$CONTAINER"
rm -rf /tmp/secretref-migration-test
```

---

## Test Results

| Step | Description | Result | Notes |
|------|-------------|--------|-------|
| 1 | secrets.json seeded on startup | | |
| 2 | openclaw.json has SecretRef wiring | | |
| 3 | /readyz 200 + LLM call succeeds | | |
| 4 | Layer 2 rotation (valid key) | | |
| 5 | Failed rotation (invalid key) | | |
| 6 | Recovery (restore valid key) | | |
| 7 | Migration path (key_state.json to secrets.json) | | |

**Tested by:** _______________
**Date:** _______________
**Anthropic key type used:** [ ] Operator dev key  [ ] Dedicated test key with spend limits
**Overall result:** [ ] ALL PASS — proceed to P4-4  [ ] FAILURES — see notes above
