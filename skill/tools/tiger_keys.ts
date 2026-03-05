// Tiger Claw — tiger_keys Tool
// Four-layer API key management — Block 1.7 + Block 4 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Four layers (LOCKED):
//   Layer 1 — Platform Onboarding Key (TC's): 50 msg total, 72h expiry. Deactivated after onboarding.
//   Layer 2 — Tenant Primary Key (theirs):    no TC limit. Powers the daily flywheel.
//   Layer 3 — Tenant Fallback Key (theirs):   20 msg/day. Activates if Layer 2 fails.
//   Layer 4 — Platform Emergency Key (TC's):  5 msg total. Last resort. 24h then auto-pause.
//
// Error classification (LOCKED, Block 4.1):
//   401 → rotate immediately
//   402 → rotate + notify tenant
//   403 → rotate + notify tenant
//   429 → wait Retry-After, do NOT rotate
//   5xx → retry 3x with exponential backoff + ±10% jitter, then rotate
//   Timeout → retry 2x, then rotate
//   Degraded → log warning, do NOT rotate
//
// All rotations, recoveries, and limit warnings logged in key_state.json.

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

// ---------------------------------------------------------------------------
// Constants — LOCKED per spec
// ---------------------------------------------------------------------------

const LAYER_LIMITS = {
  1: { dailyMessages: 50, burstMaxMessages: 5, BurstWindowMs: 60000 }, // 5 msgs per minute burst, 50 daily
  2: { totalMessages: Infinity, expiryHours: Infinity },
  3: { dailyMessages: 20 },
  4: { totalMessages: 5, pauseAfterHours: 24 },
} as const;

// Retry policy per error type
const RETRY_POLICY = {
  "5xx": { maxRetries: 3 },
  timeout: { maxRetries: 2 },
} as const;

// Exponential backoff: 1s → 2s → 4s → 8s → max 60s
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60000;
const BACKOFF_JITTER = 0.1; // ±10%

// Max events kept in state file
const MAX_EVENTS = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LayerNumber = 1 | 2 | 3 | 4;

type ApiErrorType =
  | "invalid_key"    // 401
  | "billing"        // 402
  | "forbidden"      // 403
  | "rate_limited"   // 429
  | "server_error"   // 5xx
  | "timeout"        // 30s no response
  | "degraded";      // slow but working

type RotationDecision =
  | "rotate"         // Switch to next layer now
  | "retry"          // Retry after backoff delay
  | "wait"           // Respect Retry-After, don't rotate
  | "log_warning"    // Log only, keep current layer
  | "no_action";     // Already paused or no action needed

type KeyEventType =
  | "rotation"
  | "recovery"
  | "limit_warning"
  | "limit_exceeded"
  | "pause"
  | "error"
  | "retry_recommended"
  | "layer4_activated"
  | "layer4_exhausted";

interface KeyEvent {
  type: KeyEventType;
  timestamp: string;
  fromLayer?: LayerNumber;
  toLayer?: LayerNumber;
  httpStatus?: number;
  errorType?: ApiErrorType;
  retryAttempt?: number;
  retryDelayMs?: number;
  message: string;
}

interface RetryTracker {
  errorType: "5xx" | "timeout";
  attempts: number;
  lastAttemptAt: string;
}

interface KeyState {
  activeLayer: LayerNumber;

  // Layer 1 tracking (Platform Key)
  layer1MessageCountToday: number;
  layer1CountDate: string; // YYYY-MM-DD
  layer1BurstCount: number;
  layer1BurstWindowStart: string; // ISO String

  // Layer 3 tracking (daily limit)
  layer3MessageCountToday: number;
  layer3CountDate: string;        // YYYY-MM-DD

  // Layer 4 tracking (total limit + 24h pause timer)
  layer4TotalMessages: number;
  layer4ActivatedAt?: string;

  // Retry state (cleared on successful call or rotation)
  currentRetry?: RetryTracker;

  // Tenant paused
  tenantPaused: boolean;
  tenantPausedAt?: string;

  // Persisted tenant key values (written by restore_key so container restarts
  // can resolve the correct active key without requiring env var re-injection).
  // Keys are stored in plaintext here (data dir is inside the container volume,
  // protected by container + host OS isolation). The ENCRYPTION_KEY env var is
  // available if a future iteration adds at-rest encryption.
  layer2Key?: string;   // Tenant primary key
  layer3Key?: string;   // Tenant fallback key

  // SecretRef reload tracking
  secretsReloadedAt?: string;

  // Event log (last MAX_EVENTS)
  events: KeyEvent[];

  lastUpdated: string;
}

// Tool parameter types
interface ReportErrorParams {
  action: "report_error";
  httpStatus: number;
  retryAfterSeconds?: number;   // From Retry-After header (429 responses)
  isTimeout?: boolean;          // True if the call timed out (no HTTP status)
}

interface RestoreKeyParams {
  action: "restore_key";
  layer: LayerNumber;            // Which layer to restore (2 or 3)
  apiKey: string;                // The new key to validate
}

interface RecordMessageParams {
  action: "record_message";
}

interface RotateParams {
  action: "rotate";
  reason?: string;
}

interface StatusParams {
  action: "status";
}

type KeysParams =
  | ReportErrorParams
  | RestoreKeyParams
  | RecordMessageParams
  | RotateParams
  | StatusParams;

interface ToolContext {
  sessionKey: string;
  agentId: string;
  workdir: string;
  config: Record<string, unknown>;
  abortSignal: AbortSignal;
  logger: {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function stateFilePath(workdir: string): string {
  return path.join(workdir, "key_state.json");
}

function loadKeyState(workdir: string): KeyState {
  const p = stateFilePath(workdir);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as KeyState;
    }
  } catch {
    // Fall through to default
  }
  // Default: start at Layer 1 (onboarding defaults to Platform Key)
  return {
    activeLayer: 1,
    layer1MessageCountToday: 0,
    layer1CountDate: "",
    layer1BurstCount: 0,
    layer1BurstWindowStart: new Date().toISOString(),
    layer3MessageCountToday: 0,
    layer3CountDate: "",
    layer4TotalMessages: 0,
    tenantPaused: false,
    events: [],
    lastUpdated: new Date().toISOString(),
  };
}

function saveKeyState(workdir: string, state: KeyState): void {
  fs.mkdirSync(workdir, { recursive: true });
  state.lastUpdated = new Date().toISOString();
  // Keep only the last MAX_EVENTS events
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  fs.writeFileSync(stateFilePath(workdir), JSON.stringify(state, null, 2), "utf8");
}

function appendEvent(state: KeyState, event: KeyEvent): void {
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
}

// ---------------------------------------------------------------------------
// Error classification (LOCKED per Block 4.1)
// ---------------------------------------------------------------------------

function classifyError(
  httpStatus: number | undefined,
  isTimeout: boolean
): ApiErrorType {
  if (isTimeout) return "timeout";
  if (!httpStatus) return "timeout";
  if (httpStatus === 401) return "invalid_key";
  if (httpStatus === 402) return "billing";
  if (httpStatus === 403) return "forbidden";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500 && httpStatus < 600) return "server_error";
  return "degraded";
}

/**
 * Determine the rotation decision for a given error type and current retry state.
 * Implements the full decision tree from Block 4.1.
 */
function decideAction(
  errorType: ApiErrorType,
  currentRetry: RetryTracker | undefined,
  state: KeyState
): RotationDecision {
  if (state.tenantPaused) return "no_action";

  switch (errorType) {
    case "invalid_key":
    case "billing":
    case "forbidden":
      return "rotate"; // Immediate rotation, no retries

    case "rate_limited":
      return "wait"; // Respect Retry-After, do NOT rotate

    case "server_error": {
      const maxRetries = RETRY_POLICY["5xx"].maxRetries;
      const attempts = currentRetry?.errorType === "5xx" ? currentRetry.attempts : 0;
      if (attempts < maxRetries) return "retry";
      return "rotate"; // Exhausted retries
    }

    case "timeout": {
      const maxRetries = RETRY_POLICY["timeout"].maxRetries;
      const attempts = currentRetry?.errorType === "timeout" ? currentRetry.attempts : 0;
      if (attempts < maxRetries) return "retry";
      return "rotate"; // Exhausted retries
    }

    case "degraded":
      return "log_warning"; // Log only, keep current layer
  }
}

// ---------------------------------------------------------------------------
// Backoff calculation with ±10% jitter (LOCKED per Block 4.1)
// ---------------------------------------------------------------------------

function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  const jitterRange = base * BACKOFF_JITTER;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // ±10%
  return Math.round(base + jitter);
}

// ---------------------------------------------------------------------------
// Next layer in cascade
// ---------------------------------------------------------------------------

function nextLayer(current: LayerNumber): LayerNumber | null {
  const cascade: Record<LayerNumber, LayerNumber | null> = {
    1: 2,
    2: 3,
    3: 4,
    4: null, // After Layer 4 → pause (not another layer)
  };
  return cascade[current];
}

function layerName(layer: LayerNumber): string {
  const names: Record<LayerNumber, string> = {
    1: "Platform Onboarding Key",
    2: "Primary Key",
    3: "Fallback Key",
    4: "Emergency Keep-Alive",
  };
  return names[layer];
}

// ---------------------------------------------------------------------------
// Admin alert via Tiger Claw API
// ---------------------------------------------------------------------------

function notifyAdmin(tenantId: string, message: string): void {
  const apiUrl = process.env.TIGER_CLAW_API_URL ?? "http://localhost:4000";

  try {
    const url = new URL(`/admin/alerts`, apiUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const body = JSON.stringify({ tenantId, message, severity: "high" });

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      () => { /* fire and forget */ }
    );
    req.on("error", () => { /* non-fatal */ });
    req.setTimeout(10000, () => req.destroy());
    req.write(body);
    req.end();
  } catch {
    // Non-fatal — admin alert failure must not crash the tool
  }
}

// ---------------------------------------------------------------------------
// Key validation (mirrors tiger_onboard.ts — same logic, self-contained)
// ---------------------------------------------------------------------------

function detectProvider(key: string): "anthropic" | "openai" | "unknown" {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  return "unknown";
}

function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    const rawModel = process.env["PLATFORM_CHEAP_MODEL"] ?? "claude-haiku-4-5-20251001";
    const model = rawModel.includes("/") ? rawModel.split("/").pop()! : rawModel;
    const body = JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({ valid: true });
          } else if (res.statusCode === 401) {
            resolve({ valid: false, error: "Key is invalid or revoked." });
          } else if (res.statusCode === 402) {
            resolve({ valid: false, error: "Key has a billing issue — add credits." });
          } else {
            resolve({ valid: false, error: `Provider returned status ${res.statusCode}.` });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ valid: false, error: err.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ valid: false, error: "Validation timed out." }); });
    req.write(body);
    req.end();
  });
}

function validateOpenAIKey(key: string): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201 || res.statusCode === 429) {
            resolve({ valid: true }); // 429 = rate limited but key is valid
          } else if (res.statusCode === 401) {
            resolve({ valid: false, error: "Key is invalid or revoked." });
          } else {
            resolve({ valid: false, error: `Provider returned status ${res.statusCode}.` });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ valid: false, error: err.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ valid: false, error: "Validation timed out." }); });
    req.write(body);
    req.end();
  });
}

async function validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  const provider = detectProvider(key);
  if (provider === "unknown") {
    return { valid: false, error: "Unrecognized key format. Anthropic keys start with 'sk-ant-', OpenAI with 'sk-'." };
  }
  try {
    return provider === "anthropic"
      ? await validateAnthropicKey(key)
      : await validateOpenAIKey(key);
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// SecretRef key rotation (ADR-0007)
//
// Writes the active key to ~/.openclaw/secrets.json and triggers
// OpenClaw's secrets.reload RPC. The gateway atomically swaps to the
// new in-memory snapshot. On failure, the gateway keeps the last-known-good
// snapshot — no crash, no data loss.
//
// Layer rules:
//   Layer 1/4 (env-var-sourced): write to secrets.json only (best-effort).
//   Layer 2/3 (tenant keys):     write → reload → poll /readyz.
// ---------------------------------------------------------------------------

const SECRETS_FILE_PATH = "/root/.openclaw/secrets.json";
const OPENCLAW_GATEWAY_PORT = parseInt(process.env["OPENCLAW_PORT"] ?? "18789", 10);
const SECRETS_RELOAD_TIMEOUT_MS = 10_000;

function resolveKeyForLayer(layer: LayerNumber, state: KeyState): string {
  switch (layer) {
    case 1: return process.env["PLATFORM_ONBOARDING_KEY"] ?? "";
    case 2: return state.layer2Key ?? process.env["TENANT_PRIMARY_KEY"] ?? "";
    case 3: return state.layer3Key ?? process.env["TENANT_FALLBACK_KEY"] ?? "";
    case 4: return process.env["PLATFORM_EMERGENCY_KEY"] ?? "";
  }
}

function writeSecretsFile(key: string): void {
  const dir = path.dirname(SECRETS_FILE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    SECRETS_FILE_PATH,
    JSON.stringify({ active: { apiKey: key } }, null, 2),
    "utf8"
  );
}

function triggerSecretsReload(): Promise<boolean> {
  return new Promise((resolve) => {
    const token = process.env["OPENCLAW_GATEWAY_TOKEN"] ?? "";
    const body = JSON.stringify({ method: "secrets.reload" });
    const req = http.request(
      {
        hostname: "localhost",
        port: OPENCLAW_GATEWAY_PORT,
        path: "/rpc",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        timeout: 5000,
      },
      (res) => { resolve(res.statusCode === 200); }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

function checkReadyz(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "localhost", port: OPENCLAW_GATEWAY_PORT, path: "/readyz", timeout: 5000 },
      (res) => { resolve(res.statusCode === 200); }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function pollReadyz(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkReadyz()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function rotateViaSecretRef(
  layer: LayerNumber,
  state: KeyState,
  logger: ToolContext["logger"]
): Promise<void> {
  const key = resolveKeyForLayer(layer, state);
  if (!key) {
    logger.warn("tiger_keys: no key available for SecretRef write", { layer });
    return;
  }

  try {
    writeSecretsFile(key);
  } catch (err) {
    logger.error("tiger_keys: failed to write secrets.json", { err: String(err) });
    return;
  }

  // Layer 1: never rotated at runtime — write-only best-effort
  if (layer === 1) return;

  // Layer 2/3/4: full reload + readyz confirmation
  const reloaded = await triggerSecretsReload();
  if (!reloaded) {
    logger.error("tiger_keys: secrets.reload RPC failed — gateway keeps last-known-good key");
    return;
  }

  const ready = await pollReadyz(SECRETS_RELOAD_TIMEOUT_MS);
  if (ready) {
    state.secretsReloadedAt = new Date().toISOString();
    logger.info("tiger_keys: SecretRef reload confirmed, /readyz passed");
  } else {
    logger.error("tiger_keys: /readyz did not pass within 10s after secrets.reload");
  }
}

// ---------------------------------------------------------------------------
// Rotation — perform a layer switch
// ---------------------------------------------------------------------------

async function performRotation(
  state: KeyState,
  fromLayer: LayerNumber,
  reason: string,
  workdir: string,
  tenantId: string,
  logger: ToolContext["logger"]
): Promise<{ toLayer: LayerNumber | null; tenantMessage: string; adminAlert: boolean }> {
  const toLayer = nextLayer(fromLayer);

  if (toLayer === null) {
    // Layer 4 → Pause
    state.tenantPaused = true;
    state.tenantPausedAt = new Date().toISOString();

    appendEvent(state, {
      type: "pause",
      timestamp: new Date().toISOString(),
      fromLayer,
      message: `Tenant auto-paused. ${reason}`,
    });

    saveKeyState(workdir, state);
    // No key rewrite on pause — OpenClaw will reject calls via the skill's
    // record_message check (tenantPaused: true). The key in openclaw.json
    // is irrelevant at this point since the agent won't proceed past that check.
    notifyAdmin(tenantId, `🔴 Tenant ${tenantId} auto-paused — Emergency key exhausted. Reason: ${reason}`);

    return {
      toLayer: null,
      tenantMessage: [
        `⚠️ Your bot has been paused.`,
        ``,
        `Both your API keys failed and my emergency backup has run out of messages.`,
        ``,
        `To resume: restore your API keys and message me "restore key" with your new key.`,
        `Your leads, sequences, and data are all preserved.`,
      ].join("\n"),
      adminAlert: true,
    };
  }

  // Normal rotation
  state.activeLayer = toLayer;
  state.currentRetry = undefined; // Clear retry tracker on rotation

  if (toLayer === 4) {
    state.layer4ActivatedAt = new Date().toISOString();
  }

  appendEvent(state, {
    type: toLayer === 4 ? "layer4_activated" : "rotation",
    timestamp: new Date().toISOString(),
    fromLayer,
    toLayer,
    message: reason,
  });

  saveKeyState(workdir, state);

  // Write key to secrets.json and trigger SecretRef reload (ADR-0007).
  await rotateViaSecretRef(toLayer, state, logger);

  const requiresAdminAlert = toLayer === 3 || toLayer === 4;
  if (requiresAdminAlert) {
    const severity = toLayer === 4 ? "🔴 CRITICAL" : "🟡 WARNING";
    notifyAdmin(
      tenantId,
      `${severity} Tenant ${tenantId} rotated to ${layerName(toLayer)}. Reason: ${reason}`
    );
  }

  // Tenant message varies by destination layer
  const tenantMessages: Record<number, string> = {
    2: `Your key has been restored and your primary brain is back online.`,
    3: [
      `Your primary API key stopped working. I've switched to your backup key.`,
      ``,
      `You can keep using me, but your backup key has a limit of 20 messages per day.`,
      ``,
      `To fix this: restore your primary API key and message me "restore key [your-new-key]".`,
    ].join("\n"),
    4: [
      `⚠️ Both your API keys are down. I've switched to emergency mode.`,
      ``,
      `I have 5 messages remaining before I have to pause. After 24 hours without a fix, I'll pause automatically.`,
      ``,
      `To fix this: restore either of your API keys and message me "restore key [your-new-key]".`,
    ].join("\n"),
  };

  return {
    toLayer,
    tenantMessage: tenantMessages[toLayer] ?? `Rotated to ${layerName(toLayer)}.`,
    adminAlert: requiresAdminAlert,
  };
}

// ---------------------------------------------------------------------------
// Action: report_error
// ---------------------------------------------------------------------------

async function handleReportError(
  params: ReportErrorParams,
  state: KeyState,
  workdir: string,
  tenantId: string,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  if (state.tenantPaused) {
    return {
      ok: true,
      output: "Bot is currently paused. Restore API keys to resume.",
      data: { decision: "no_action", tenantPaused: true },
    };
  }

  const errorType = classifyError(params.httpStatus, params.isTimeout ?? false);
  const decision = decideAction(errorType, state.currentRetry, state);

  logger.info("tiger_keys: error reported", {
    httpStatus: params.httpStatus,
    errorType,
    decision,
    activeLayer: state.activeLayer,
  });

  appendEvent(state, {
    type: "error",
    timestamp: new Date().toISOString(),
    httpStatus: params.httpStatus,
    errorType,
    message: `HTTP ${params.httpStatus ?? "timeout"} on Layer ${state.activeLayer} — decision: ${decision}`,
  });

  switch (decision) {
    case "rotate": {
      const result = await performRotation(
        state,
        state.activeLayer,
        `HTTP ${params.httpStatus ?? "timeout"} — ${errorType}`,
        workdir,
        tenantId,
        logger
      );

      return {
        ok: true,
        output: result.tenantMessage,
        data: {
          decision: "rotate",
          fromLayer: state.activeLayer,
          toLayer: result.toLayer,
          errorType,
          tenantPaused: state.tenantPaused,
          adminAlerted: result.adminAlert,
        },
      };
    }

    case "retry": {
      const retryErrorType = errorType === "server_error" ? "5xx" : "timeout";
      const currentAttempts = state.currentRetry?.errorType === retryErrorType
        ? state.currentRetry.attempts
        : 0;
      const nextAttempt = currentAttempts + 1;
      const delay = backoffMs(currentAttempts);

      state.currentRetry = {
        errorType: retryErrorType,
        attempts: nextAttempt,
        lastAttemptAt: new Date().toISOString(),
      };

      appendEvent(state, {
        type: "retry_recommended",
        timestamp: new Date().toISOString(),
        retryAttempt: nextAttempt,
        retryDelayMs: delay,
        errorType,
        message: `Retry ${nextAttempt} recommended after ${delay}ms`,
      });

      saveKeyState(workdir, state);

      return {
        ok: true,
        output: `Provider error (${params.httpStatus ?? "timeout"}). Retrying in ${delay}ms (attempt ${nextAttempt}).`,
        data: {
          decision: "retry",
          retryAttempt: nextAttempt,
          retryDelayMs: delay,
          errorType,
        },
      };
    }

    case "wait": {
      const waitSeconds = params.retryAfterSeconds ?? 60;
      saveKeyState(workdir, state);

      return {
        ok: true,
        output: `Rate limited (429). Waiting ${waitSeconds}s before retrying. Key is fine — do NOT rotate.`,
        data: {
          decision: "wait",
          retryAfterSeconds: waitSeconds,
          errorType: "rate_limited",
        },
      };
    }

    case "log_warning": {
      saveKeyState(workdir, state);
      logger.warn("tiger_keys: degraded performance on current layer", {
        layer: state.activeLayer,
      });

      return {
        ok: true,
        output: `API is responding slowly but not failing. Staying on current key. Logged for monitoring.`,
        data: { decision: "log_warning", errorType: "degraded" },
      };
    }

    default:
      saveKeyState(workdir, state);
      return { ok: true, output: "No action needed.", data: { decision: "no_action" } };
  }
}

// ---------------------------------------------------------------------------
// Action: restore_key
// ---------------------------------------------------------------------------

async function handleRestoreKey(
  params: RestoreKeyParams,
  state: KeyState,
  workdir: string,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  if (![2, 3].includes(params.layer)) {
    return { ok: false, error: "Only Layer 2 (primary) or Layer 3 (fallback) can be restored by the tenant." };
  }

  logger.info("tiger_keys: validating restored key", { layer: params.layer });

  const validation = await validateApiKey(params.apiKey);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Key validation failed: ${validation.error} Please check the key and try again.`,
    };
  }

  const restoredLayer = params.layer as LayerNumber;
  const previousLayer = state.activeLayer;

  // Persist the validated key value so container restarts can resolve it
  // (entrypoint reads layer2Key / layer3Key from key_state.json at startup)
  if (restoredLayer === 2) state.layer2Key = params.apiKey;
  if (restoredLayer === 3) state.layer3Key = params.apiKey;

  // Switch to restored layer if it's better than current active
  // (e.g., primary restored while on fallback or emergency)
  const shouldSwitch =
    !state.tenantPaused
      ? restoredLayer < state.activeLayer // Restore to a better layer
      : restoredLayer <= 3; // If paused, any valid key resumes

  if (shouldSwitch) {
    state.activeLayer = restoredLayer;
    state.currentRetry = undefined;
    if (state.tenantPaused) {
      state.tenantPaused = false;
      state.tenantPausedAt = undefined;
    }
  }

  appendEvent(state, {
    type: "recovery",
    timestamp: new Date().toISOString(),
    fromLayer: previousLayer,
    toLayer: restoredLayer,
    message: `Layer ${restoredLayer} (${layerName(restoredLayer)}) restored and validated.`,
  });

  saveKeyState(workdir, state);

  // Write key to secrets.json and trigger SecretRef reload (ADR-0007).
  if (shouldSwitch) {
    await rotateViaSecretRef(state.activeLayer, state, logger);
  }

  logger.info("tiger_keys: key restored", {
    restoredLayer,
    previousLayer,
    newActiveLayer: state.activeLayer,
  });

  const wasResumed = previousLayer !== restoredLayer && shouldSwitch;
  const wasPaused = state.tenantPaused === false && previousLayer > restoredLayer;

  const output = [
    `✅ ${layerName(restoredLayer)} validated and restored.`,
    wasResumed ? `Switched from ${layerName(previousLayer)} back to ${layerName(restoredLayer)}.` : "",
    wasPaused || state.tenantPaused === false
      ? `Your bot is fully operational. Flywheel is running.`
      : "",
  ].filter(Boolean).join("\n");

  return {
    ok: true,
    output,
    data: {
      restoredLayer,
      previousLayer,
      newActiveLayer: state.activeLayer,
      tenantPaused: state.tenantPaused,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: record_message
// ---------------------------------------------------------------------------

async function handleRecordMessage(
  state: KeyState,
  workdir: string,
  tenantId: string,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const today = new Date().toISOString().slice(0, 10);
  const layer = state.activeLayer;

  // Layer 1: Strict Platform Key rate limits (Daily + Burst)
  if (layer === 1) {
    if (state.layer1CountDate !== today) {
      state.layer1MessageCountToday = 0;
      state.layer1CountDate = today;
    }

    // Check Burst Limits (e.g. max 5 messages per minute)
    const now = Date.now();
    const burstStart = new Date(state.layer1BurstWindowStart).getTime();
    if (now - burstStart > LAYER_LIMITS[1].BurstWindowMs) {
      // Reset burst window
      state.layer1BurstCount = 0;
      state.layer1BurstWindowStart = new Date(now).toISOString();
    }

    state.layer1BurstCount++;
    state.layer1MessageCountToday++;

    if (state.layer1BurstCount > LAYER_LIMITS[1].burstMaxMessages) {
      appendEvent(state, {
        type: "limit_exceeded",
        timestamp: new Date().toISOString(),
        message: `Layer 1 Burst limit exceeded (${LAYER_LIMITS[1].burstMaxMessages} msgs / ${LAYER_LIMITS[1].BurstWindowMs}ms). Loop suspected.`,
      });
      const rotation = await performRotation(state, 1, "Platform Key Burst Limit Exceeded (Loop Prevention)", workdir, tenantId, logger);
      saveKeyState(workdir, state);
      return {
        ok: true,
        output: rotation.tenantMessage,
        data: { layer, burstExceeded: true, rotatedTo: rotation.toLayer },
      };
    }

    const remaining = LAYER_LIMITS[1].dailyMessages - state.layer1MessageCountToday;

    if (state.layer1MessageCountToday > LAYER_LIMITS[1].dailyMessages) {
      appendEvent(state, {
        type: "limit_exceeded",
        timestamp: new Date().toISOString(),
        message: `Layer 1 daily limit reached (${LAYER_LIMITS[1].dailyMessages} messages).`,
      });
      const rotation = await performRotation(state, 1, "Platform Key Daily Limit Reached", workdir, tenantId, logger);
      saveKeyState(workdir, state);
      return {
        ok: true,
        output: rotation.tenantMessage,
        data: { layer, limitExceeded: true, rotatedTo: rotation.toLayer },
      };
    }

    if (remaining <= 10) {
      appendEvent(state, {
        type: "limit_warning",
        timestamp: new Date().toISOString(),
        message: `Layer 1: ${remaining} messages remaining today.`,
      });
    }
    saveKeyState(workdir, state);
    return { ok: true, output: "", data: { layer, remaining } };
  }

  // Layer 3: daily limit
  if (layer === 3) {
    if (state.layer3CountDate !== today) {
      state.layer3MessageCountToday = 0;
      state.layer3CountDate = today;
    }
    state.layer3MessageCountToday++;
    const remaining = LAYER_LIMITS[3].dailyMessages - state.layer3MessageCountToday;

    if (state.layer3MessageCountToday >= LAYER_LIMITS[3].dailyMessages) {
      appendEvent(state, {
        type: "limit_exceeded",
        timestamp: new Date().toISOString(),
        message: `Layer 3 daily limit reached (${LAYER_LIMITS[3].dailyMessages} messages).`,
      });

      const rotation = await performRotation(state, 3, "Layer 3 daily message limit reached", workdir, tenantId, logger);
      saveKeyState(workdir, state);

      return {
        ok: true,
        output: rotation.tenantMessage,
        data: { layer, limitExceeded: true, rotatedTo: rotation.toLayer },
      };
    }

    if (remaining <= 5) {
      appendEvent(state, {
        type: "limit_warning",
        timestamp: new Date().toISOString(),
        message: `Layer 3: ${remaining} messages remaining today.`,
      });
      saveKeyState(workdir, state);

      logger.warn("tiger_keys: Layer 3 approaching daily limit", { remaining });
      return {
        ok: true,
        output: `⚠️ Backup key running low: ${remaining} messages left today. Please restore your primary key.`,
        data: { layer, remaining, warning: true },
      };
    }

    saveKeyState(workdir, state);
    return { ok: true, output: "", data: { layer, remaining } };
  }

  // Layer 4: total message count
  if (layer === 4) {
    state.layer4TotalMessages++;
    const remaining = LAYER_LIMITS[4].totalMessages - state.layer4TotalMessages;

    // Check 24h auto-pause timer
    if (state.layer4ActivatedAt) {
      const hoursSinceActivation =
        (Date.now() - new Date(state.layer4ActivatedAt).getTime()) / 3600000;
      if (hoursSinceActivation >= LAYER_LIMITS[4].pauseAfterHours) {
        const rotation = await performRotation(state, 4, "Layer 4 active for 24 hours — auto-pause", workdir, tenantId, logger);
        saveKeyState(workdir, state);
        return {
          ok: true,
          output: rotation.tenantMessage,
          data: { layer, tenantPaused: true, reason: "24h_timeout" },
        };
      }
    }

    // Check total message limit
    if (state.layer4TotalMessages >= LAYER_LIMITS[4].totalMessages) {
      appendEvent(state, {
        type: "layer4_exhausted",
        timestamp: new Date().toISOString(),
        message: `Layer 4 exhausted (${LAYER_LIMITS[4].totalMessages} messages used).`,
      });

      const rotation = await performRotation(state, 4, "Layer 4 message limit exhausted", workdir, tenantId, logger);
      saveKeyState(workdir, state);

      return {
        ok: true,
        output: rotation.tenantMessage,
        data: { layer, limitExceeded: true, tenantPaused: true },
      };
    }

    if (remaining <= 2) {
      appendEvent(state, {
        type: "limit_warning",
        timestamp: new Date().toISOString(),
        message: `Layer 4: ${remaining} emergency messages remaining.`,
      });
    }

    saveKeyState(workdir, state);

    // Always warn on Layer 4 — every message counts
    return {
      ok: true,
      output: `⚠️ Emergency mode: ${remaining} messages remaining. Restore your API keys immediately.`,
      data: { layer, remaining, emergency: true },
    };
  }

  // Layer 2: no TC limits — just track for logging
  saveKeyState(workdir, state);
  return { ok: true, output: "", data: { layer, unlimited: true } };
}

// ---------------------------------------------------------------------------
// Action: rotate (manual override)
// ---------------------------------------------------------------------------

async function handleRotate(
  params: RotateParams,
  state: KeyState,
  workdir: string,
  tenantId: string,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  if (state.tenantPaused) {
    return {
      ok: true,
      output: "Bot is already paused. Restore API keys first.",
      data: { decision: "no_action", tenantPaused: true },
    };
  }

  const reason = params.reason ?? "Manual rotation requested";
  logger.info("tiger_keys: manual rotation", { fromLayer: state.activeLayer, reason });

  const result = await performRotation(state, state.activeLayer, reason, workdir, tenantId, logger);

  return {
    ok: true,
    output: result.tenantMessage,
    data: {
      fromLayer: state.activeLayer,
      toLayer: result.toLayer,
      tenantPaused: state.tenantPaused,
      adminAlerted: result.adminAlert,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: status
// ---------------------------------------------------------------------------

function handleStatus(state: KeyState): ToolResult {
  const today = new Date().toISOString().slice(0, 10);

  const lines = [
    `Key Management Status`,
    `Active layer: ${state.activeLayer} — ${layerName(state.activeLayer)}`,
    `Bot paused: ${state.tenantPaused ? `Yes (since ${state.tenantPausedAt})` : "No"}`,
    ``,
    `Layer limits:`,
  ];

  // Layer 1
  lines.push(`  Layer 1 (Onboarding): ${state.layer1MessageCountToday}/${LAYER_LIMITS[1].dailyMessages} messages used today`);

  // Layer 2
  lines.push(`  Layer 2 (Primary): No Tiger Claw limit`);

  // Layer 3
  const layer3Today = state.layer3CountDate === today ? state.layer3MessageCountToday : 0;
  lines.push(`  Layer 3 (Fallback): ${layer3Today}/${LAYER_LIMITS[3].dailyMessages} messages today`);

  // Layer 4
  lines.push(`  Layer 4 (Emergency): ${state.layer4TotalMessages}/${LAYER_LIMITS[4].totalMessages} messages total`);
  if (state.layer4ActivatedAt) {
    const hoursActive = Math.round(
      (Date.now() - new Date(state.layer4ActivatedAt).getTime()) / 3600000
    );
    const hoursRemaining = Math.max(0, LAYER_LIMITS[4].pauseAfterHours - hoursActive);
    lines.push(`  Layer 4 activated ${hoursActive}h ago — ${hoursRemaining}h until auto-pause`);
  }

  // Recent events
  const recentEvents = state.events.slice(-5);
  if (recentEvents.length > 0) {
    lines.push(``);
    lines.push(`Recent events:`);
    for (const event of recentEvents) {
      const ts = new Date(event.timestamp).toLocaleString();
      lines.push(`  ${ts} — ${event.type}: ${event.message}`);
    }
  }

  if (state.currentRetry) {
    lines.push(``);
    lines.push(`Active retry: ${state.currentRetry.attempts} attempts (${state.currentRetry.errorType})`);
  }

  return {
    ok: true,
    output: lines.join("\n"),
    data: {
      activeLayer: state.activeLayer,
      tenantPaused: state.tenantPaused,
      layer1MessageCount: state.layer1MessageCountToday,
      layer3MessageCountToday: layer3Today,
      layer3DailyLimit: LAYER_LIMITS[3].dailyMessages,
      layer4TotalMessages: state.layer4TotalMessages,
      layer4TotalLimit: LAYER_LIMITS[4].totalMessages,
      layer4ActivatedAt: state.layer4ActivatedAt ?? null,
      currentRetry: state.currentRetry ?? null,
      recentEvents: recentEvents,
    },
  };
}

// ---------------------------------------------------------------------------
// Main execute dispatcher
// ---------------------------------------------------------------------------

async function execute(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { workdir, logger } = context;
  const action = params.action as string;
  const tenantId = process.env.TIGER_CLAW_TENANT_ID ?? "unknown";

  logger.info("tiger_keys called", { action });

  const state = loadKeyState(workdir);

  try {
    switch (action) {
      case "report_error":
        return await handleReportError(params as unknown as ReportErrorParams, state, workdir, tenantId, logger);

      case "restore_key":
        return await handleRestoreKey(params as unknown as RestoreKeyParams, state, workdir, logger);

      case "record_message":
        return await handleRecordMessage(state, workdir, tenantId, logger);

      case "rotate":
        return await handleRotate(params as unknown as RotateParams, state, workdir, tenantId, logger);

      case "status":
        return handleStatus(state);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: report_error | restore_key | record_message | rotate | status`,
        };
    }
  } catch (err) {
    logger.error("tiger_keys error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_keys error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_keys = {
  name: "tiger_keys",
  description:
    "Four-layer API key management. Tracks which key layer is active, enforces message limits (Layer 3: 20/day, Layer 4: 5 total), manages the rotation cascade (Layer 2→3→4→Pause), handles exponential backoff with jitter, and validates restored keys before accepting. Call record_message before every LLM call to enforce limits. Call report_error with the HTTP status after any LLM API failure to get the rotation decision. Call restore_key when tenant provides a new key.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["report_error", "restore_key", "record_message", "rotate", "status"],
        description:
          "report_error: classify an API error and get rotation decision. restore_key: validate and restore a tenant key. record_message: increment counter for current layer (call before every LLM message). rotate: manual layer rotation. status: show active layer and limits.",
      },
      httpStatus: {
        type: "number",
        description: "HTTP status code from the failed API call (for report_error).",
      },
      isTimeout: {
        type: "boolean",
        description: "True if the call timed out with no HTTP response (for report_error).",
      },
      retryAfterSeconds: {
        type: "number",
        description: "Value from Retry-After header on 429 responses (for report_error).",
      },
      layer: {
        type: "number",
        enum: [2, 3],
        description: "Which layer to restore — 2 (primary) or 3 (fallback). For restore_key only.",
      },
      apiKey: {
        type: "string",
        description: "The new API key to validate and restore. For restore_key only.",
      },
      reason: {
        type: "string",
        description: "Reason for manual rotation (for rotate action, optional).",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_keys;
