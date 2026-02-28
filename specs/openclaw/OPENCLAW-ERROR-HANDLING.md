# OpenClaw Error Handling Specification

**For Pre-Dev Planning**  
**Version:** 1.0  
**Date:** February 26, 2026

---

## 1. ERROR TAXONOMY

### 1.1 Error Categories

| Category | Code Range | Recoverable | User-Visible | Example |
|----------|------------|-------------|--------------|---------|
| **Transient** | 1xxx | Yes (auto-retry) | No | Network timeout, rate limit |
| **Client** | 2xxx | Yes (user action) | Yes | Invalid input, auth failure |
| **Server** | 3xxx | Maybe | Yes (generic) | Internal error, resource exhausted |
| **Fatal** | 4xxx | No | Yes | Corrupted state, unrecoverable |
| **External** | 5xxx | Maybe (retry) | Yes | Provider down, API changed |

### 1.2 Error Codes

#### Transient Errors (1xxx) — Auto-Retry

| Code | Name | Description | Retry Strategy |
|------|------|-------------|----------------|
| 1001 | NETWORK_TIMEOUT | Request timed out | 3x, exp backoff 1s→2s→4s |
| 1002 | CONNECTION_RESET | Connection dropped | 3x, exp backoff 500ms→1s→2s |
| 1003 | RATE_LIMITED | Provider rate limit | Wait for Retry-After header, max 60s |
| 1004 | SERVICE_UNAVAILABLE | Temporary outage | 5x, exp backoff 2s→4s→8s→16s→32s |
| 1005 | RESOURCE_BUSY | Lock contention | 3x, linear backoff 100ms |
| 1006 | QUEUE_FULL | Processing backlog | 3x, exp backoff 1s→2s→4s |

#### Client Errors (2xxx) — User Must Fix

| Code | Name | Description | User Message |
|------|------|-------------|--------------|
| 2001 | INVALID_INPUT | Malformed request | "Invalid input: {details}" |
| 2002 | AUTH_REQUIRED | No credentials | "Authentication required" |
| 2003 | AUTH_INVALID | Bad credentials | "Invalid credentials" |
| 2004 | AUTH_EXPIRED | Token expired | "Session expired, please reconnect" |
| 2005 | FORBIDDEN | Not authorized | "You don't have permission for this" |
| 2006 | NOT_FOUND | Resource missing | "Not found: {resource}" |
| 2007 | CONFLICT | State conflict | "Conflict: {details}" |
| 2008 | PAYLOAD_TOO_LARGE | Input too big | "Input exceeds maximum size" |
| 2009 | UNSUPPORTED_MEDIA | Bad file type | "Unsupported file type: {type}" |
| 2010 | PAIRING_REQUIRED | Not paired | "Please complete pairing first" |

#### Server Errors (3xxx) — Internal Problems

| Code | Name | Description | Log Level | Alert |
|------|------|-------------|-----------|-------|
| 3001 | INTERNAL_ERROR | Unexpected exception | ERROR | Yes |
| 3002 | CONFIG_INVALID | Bad configuration | ERROR | Yes |
| 3003 | RESOURCE_EXHAUSTED | Memory/disk full | CRITICAL | Yes |
| 3004 | DEPENDENCY_FAILED | Internal service down | ERROR | Yes |
| 3005 | STATE_CORRUPTED | Data inconsistency | CRITICAL | Yes |
| 3006 | TIMEOUT_INTERNAL | Internal timeout | WARN | No |
| 3007 | SCHEMA_MISMATCH | Protocol mismatch | ERROR | Yes |

#### Fatal Errors (4xxx) — Cannot Continue

| Code | Name | Description | Action |
|------|------|-------------|--------|
| 4001 | UNRECOVERABLE_STATE | Corrupted beyond repair | Shutdown, alert, manual intervention |
| 4002 | SECURITY_BREACH | Detected attack | Shutdown, alert, quarantine |
| 4003 | LICENSE_INVALID | Invalid license | Shutdown gracefully |
| 4004 | INCOMPATIBLE_VERSION | Breaking protocol change | Shutdown, require upgrade |

#### External Errors (5xxx) — Third-Party Problems

| Code | Name | Description | Retry | Fallback |
|------|------|-------------|-------|----------|
| 5001 | PROVIDER_DOWN | LLM API unavailable | Yes | Use fallback model |
| 5002 | PROVIDER_ERROR | LLM returned error | Maybe | Use fallback model |
| 5003 | PROVIDER_RATE_LIMIT | LLM rate limited | Yes | Use fallback model or queue |
| 5004 | CHANNEL_DISCONNECTED | Messaging platform down | Yes | Queue messages |
| 5005 | CHANNEL_BANNED | Account banned | No | Alert, manual intervention |
| 5006 | CHANNEL_AUTH_REVOKED | Auth invalidated | No | Re-authentication required |
| 5007 | WEBHOOK_FAILED | Outbound webhook error | Yes | Queue, alert after 3 failures |
| 5008 | BROWSER_CRASHED | CDP connection lost | Yes | Restart browser |

---

## 2. RETRY POLICIES

### 2.1 Default Retry Configuration

```yaml
retry:
  default:
    maxAttempts: 3
    initialDelayMs: 1000
    maxDelayMs: 30000
    backoffMultiplier: 2.0
    jitter: 0.1  # ±10%
    
  aggressive:  # For critical operations
    maxAttempts: 5
    initialDelayMs: 500
    maxDelayMs: 60000
    backoffMultiplier: 2.0
    jitter: 0.15
    
  conservative:  # For rate-limited resources
    maxAttempts: 3
    initialDelayMs: 5000
    maxDelayMs: 120000
    backoffMultiplier: 3.0
    jitter: 0.2
```

### 2.2 Retry Decision Matrix

| Error Code | Retry? | Policy | Max Wait | Notes |
|------------|--------|--------|----------|-------|
| 1001-1006 | Yes | default | 30s total | Transient, should recover |
| 2xxx | No | - | - | User must fix |
| 3001-3004 | Maybe | conservative | 60s | Internal, may need cooldown |
| 3005-3007 | No | - | - | Requires intervention |
| 4xxx | No | - | - | Fatal, stop immediately |
| 5001-5003 | Yes | aggressive | 60s | Provider issues, try hard |
| 5004 | Yes | aggressive | 120s | Channel reconnect |
| 5005-5006 | No | - | - | Manual intervention |
| 5007 | Yes | default | 30s | Webhook delivery |
| 5008 | Yes | default | 10s | Browser restart |

### 2.3 Retry Implementation Rules

1. **Idempotency Required**: Never retry non-idempotent operations without idempotency key
2. **Deadline Propagation**: Retry attempts must respect original request deadline
3. **Circuit Breaker**: After 5 consecutive failures to same endpoint, open circuit for 30s
4. **Jitter Mandatory**: Always add jitter to prevent thundering herd
5. **Logging**: Log every retry attempt with attempt number and delay

---

## 3. CIRCUIT BREAKER SPECIFICATION

### 3.1 Circuit States

```
CLOSED (normal) ──[failure threshold]──> OPEN (blocking)
                                              │
                                         [timeout]
                                              │
                                              ▼
                                        HALF-OPEN (testing)
                                              │
                            ┌─────────────────┴─────────────────┐
                       [success]                           [failure]
                            │                                   │
                            ▼                                   ▼
                         CLOSED                              OPEN
```

### 3.2 Circuit Configuration

| Circuit | Failure Threshold | Timeout | Success to Close |
|---------|-------------------|---------|------------------|
| LLM Provider (per provider) | 5 failures in 60s | 30s | 2 consecutive |
| Channel (per channel) | 3 failures in 30s | 60s | 1 success |
| Browser | 3 failures in 30s | 10s | 1 success |
| Webhook (per URL) | 3 failures in 60s | 120s | 1 success |
| Database | 2 failures in 10s | 5s | 1 success |

### 3.3 Circuit Breaker Behavior

**When OPEN:**
- Fail fast with error code 3004 (DEPENDENCY_FAILED)
- Log circuit state change
- Emit metric `circuit.open{service=$SERVICE}`
- Start timeout timer

**When HALF-OPEN:**
- Allow single probe request
- If success → CLOSED
- If failure → OPEN (reset timeout)

---

## 4. GRACEFUL DEGRADATION

### 4.1 Degradation Hierarchy

| Failure | Degradation Level 1 | Degradation Level 2 | Degradation Level 3 |
|---------|---------------------|---------------------|---------------------|
| Primary model down | Use fallback model | Use smaller/faster model | Return "temporarily unavailable" |
| Browser unavailable | Use web_fetch only | Return cached content | Skip browser-dependent tools |
| Memory search down | Skip memory recall | Use file-based search | Proceed without memory |
| Channel disconnected | Queue messages | Store for later delivery | Alert user via other channel |
| Exec sandbox down | Run in restricted mode | Deny exec requests | Return capability unavailable |

### 4.2 Feature Flags for Degradation

```yaml
degradation:
  llm:
    allowFallback: true
    fallbackChain: ["anthropic/claude-sonnet", "openai/gpt-4o-mini"]
    maxFallbackLatencyMs: 30000
    
  browser:
    allowWebFetchFallback: true
    allowCachedContent: true
    cacheMaxAgeMs: 3600000  # 1 hour
    
  tools:
    allowPartialExecution: true  # Continue if non-critical tool fails
    criticalTools: ["exec", "write", "message"]  # These block on failure
```

---

## 5. ERROR PROPAGATION RULES

### 5.1 Layer Boundaries

```
┌─────────────────────────────────────────────────────────┐
│  CHANNEL LAYER                                          │
│  - Catch: Channel-specific errors                       │
│  - Transform: To user-friendly messages                 │
│  - Log: Full context for debugging                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  GATEWAY LAYER                                          │
│  - Catch: Protocol errors, routing errors               │
│  - Transform: To standardized error frames              │
│  - Log: Request context, timing                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  AGENT LAYER                                            │
│  - Catch: Model errors, tool errors                     │
│  - Transform: To recoverable/fatal classification       │
│  - Log: Session context, tool inputs/outputs            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  TOOL LAYER                                             │
│  - Catch: Execution errors, timeout errors              │
│  - Transform: To tool result with error field           │
│  - Log: Command, args, output, timing                   │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Error Transformation Rules

| From Layer | To Layer | Transformation |
|------------|----------|----------------|
| Tool → Agent | Wrap in ToolResult with ok=false, include error message |
| Agent → Gateway | Include session context, classify recoverable/fatal |
| Gateway → Channel | Map to user-friendly message, hide internal details |
| Any → Logging | Include full stack, request ID, timing, context |

### 5.3 Sensitive Data in Errors

**NEVER include in error messages or logs:**
- API keys or tokens
- Full message content (truncate to 100 chars)
- File paths outside workspace
- Internal IP addresses
- Stack traces in user-facing messages

**ALWAYS include:**
- Request/correlation ID
- Timestamp
- Error code
- Component name
- Sanitized context

---

## 6. TIMEOUT HIERARCHY

### 6.1 Timeout Nesting

```
Request Timeout (outermost)
└── Session Timeout
    └── Agent Turn Timeout
        └── Tool Execution Timeout
            └── External Call Timeout (innermost)
```

### 6.2 Timeout Values

| Timeout | Default | Min | Max | Configurable |
|---------|---------|-----|-----|--------------|
| WebSocket idle | 120s | 30s | 600s | Yes |
| Request | 300s | 30s | 900s | Yes |
| Agent turn | 180s | 30s | 600s | Yes |
| Tool execution | 30s | 5s | 300s | Per-tool |
| Exec command | 30s | 1s | 1800s | Per-call |
| Browser action | 30s | 5s | 120s | Yes |
| LLM API call | 120s | 30s | 300s | Yes |
| Web fetch | 30s | 5s | 60s | Yes |
| Channel send | 30s | 5s | 60s | Yes |

### 6.3 Timeout Propagation

```
Given: Request timeout = 60s
       Tool timeout = 30s
       
Scenario: Tool starts at T+45s
Result: Tool gets min(30s, 60s-45s) = 15s
        Tool must complete by T+60s
```

**Rule**: Inner timeouts are capped by remaining outer timeout

---

## 7. ERROR LOGGING SPECIFICATION

### 7.1 Log Entry Structure

```json
{
  "timestamp": "2026-02-26T13:00:00.000Z",
  "level": "ERROR",
  "requestId": "req_abc123",
  "sessionKey": "main:telegram:12345",
  "component": "agent.tool.exec",
  "error": {
    "code": 1001,
    "name": "NETWORK_TIMEOUT",
    "message": "Request timed out after 30000ms",
    "recoverable": true,
    "retryable": true
  },
  "context": {
    "tool": "exec",
    "command": "[REDACTED]",
    "attempt": 2,
    "elapsedMs": 30150
  },
  "stack": "Error: Request timed out\n    at ..."
}
```

### 7.2 Log Levels by Error Category

| Error Category | Log Level | Include Stack | Alert |
|----------------|-----------|---------------|-------|
| Transient (1xxx) | WARN | No | After 3 retries |
| Client (2xxx) | INFO | No | No |
| Server (3xxx) | ERROR | Yes | Yes |
| Fatal (4xxx) | CRITICAL | Yes | Immediate |
| External (5xxx) | WARN/ERROR | Conditional | After circuit opens |

---

## 8. USER-FACING ERROR MESSAGES

### 8.1 Message Templates

| Code | Technical | User-Facing |
|------|-----------|-------------|
| 1001 | NETWORK_TIMEOUT | "Taking longer than expected. Please wait..." |
| 1003 | RATE_LIMITED | "Too many requests. Please wait a moment." |
| 2001 | INVALID_INPUT | "I couldn't understand that. Could you rephrase?" |
| 2005 | FORBIDDEN | "Sorry, I can't do that." |
| 3001 | INTERNAL_ERROR | "Something went wrong on my end. Please try again." |
| 5001 | PROVIDER_DOWN | "I'm having trouble thinking right now. Please try again in a minute." |
| 5005 | CHANNEL_BANNED | "There's an issue with this channel. Please contact support." |

### 8.2 Error Response Rules

1. **Never expose internal details** to users
2. **Always provide actionable guidance** when possible
3. **Include request ID** for support escalation
4. **Localize messages** based on user locale
5. **Use appropriate tone** (apologetic, not robotic)

---

## 9. POISON MESSAGE HANDLING

### 9.1 Definition

A **poison message** is one that causes repeated failures when processed.

### 9.2 Detection

```yaml
poisonDetection:
  windowMs: 300000  # 5 minutes
  failureThreshold: 3  # Same message fails 3 times
  identityFields: ["chatId", "messageId", "contentHash"]
```

### 9.3 Quarantine Process

1. **Detect**: Same message fails 3 times in 5 minutes
2. **Quarantine**: Move to dead-letter queue
3. **Alert**: Notify operator
4. **Log**: Full message context (sanitized)
5. **Respond**: "I'm having trouble with this message. It's been logged for review."

### 9.4 Dead-Letter Queue

- Location: `~/.openclaw/dead-letter/`
- Format: JSONL with timestamp, message, error history
- Retention: 7 days
- Review: Manual via `openclaw dlq list|inspect|retry|purge`

---

## 10. HEALTH CHECK ERRORS

### 10.1 Health Check Components

| Component | Check | Healthy | Degraded | Unhealthy |
|-----------|-------|---------|----------|-----------|
| Gateway | WS accepts connections | < 100ms | < 500ms | > 500ms or fail |
| Database | SELECT 1 | < 50ms | < 200ms | > 200ms or fail |
| LLM Provider | /health or probe | < 2s | < 10s | > 10s or fail |
| Channel | Connection status | Connected | Reconnecting | Disconnected > 60s |
| Browser | CDP ping | < 100ms | < 500ms | > 500ms or fail |
| Disk | Free space | > 20% | > 10% | < 10% |
| Memory | Available | > 30% | > 15% | < 15% |

### 10.2 Aggregate Health

```
HEALTHY:    All components healthy
DEGRADED:   Any component degraded, none unhealthy
UNHEALTHY:  Any component unhealthy
```

---

*This error handling specification ensures consistent, predictable behavior across all failure modes.*
