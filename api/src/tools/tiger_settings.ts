// Tiger Claw — tiger_settings Tool
// Tenant settings management — TIGERCLAW-MASTER-SPEC-v2.md
//
// Manages settings.json in the tenant workdir.
// Other tools read this file directly (e.g. tiger_contact reads manualApproval).
//
// Settings:
//   manualApproval       bool    — first contact queued for tenant approval before sending (default: false)
//   hiveOptIn            bool    — allow submitting patterns to the cross-tenant Hive (default: false)
//   preferredChannel     string  — where briefings/alerts are sent: telegram|whatsapp|line (default: telegram)
//   timezone             string  — IANA timezone (e.g. "America/Phoenix") for cron scheduling (default: "UTC")
//   dailyBriefingEnabled bool    — send daily morning briefing (default: true)
//   scoutEnabled         bool    — run daily prospect scout (default: true)
//   maxDailyContacts     number  — cap on first-contact messages sent per day (default: 10)
//   contactWindowStart   number  — earliest hour to send contacts (0-23, default: 9)
//   contactWindowEnd     number  — latest hour to send contacts (0-23, default: 20)
//   slowDripEnabled      bool    — continue slow drip for exited leads (default: true)
//   aftercareEnabled     bool    — run aftercare sequences (default: true)
//   language             string  — override language for bot communications (default: from env PREFERRED_LANGUAGE)
//   botName              string  — override bot display name (default: from onboard_state)
//   notifyOnConversion   bool    — send briefing alert when a lead converts (default: true)
//   notifyOnNewQualified bool    — send briefing alert when new leads cross 80-point threshold (default: true)
//
// Actions: get | set | reset

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TenantSettings {
  // Workflow controls
  manualApproval: boolean;
  hiveOptIn: boolean;
  slowDripEnabled: boolean;
  aftercareEnabled: boolean;
  scoutEnabled: boolean;
  dailyBriefingEnabled: boolean;

  // Contact timing
  maxDailyContacts: number;
  contactWindowStart: number;   // 0-23
  contactWindowEnd: number;     // 0-23

  // Notifications
  notifyOnConversion: boolean;
  notifyOnNewQualified: boolean;

  // Locale & channel
  preferredChannel: "telegram" | "whatsapp" | "line" | "sms";
  timezone: string;
  language: string;

  // Overrides (optional — fall back to onboard_state if absent)
  botName?: string;

  // Metadata
  lastUpdatedAt: string;
  updatedFields: string[];      // Which fields have been manually changed
  [key: string]: unknown;
}

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

  storage: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void>; };
}

interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultSettings(): TenantSettings {
  return {
    manualApproval: false,
    hiveOptIn: false,
    slowDripEnabled: true,
    aftercareEnabled: true,
    scoutEnabled: true,
    dailyBriefingEnabled: true,
    maxDailyContacts: 10,
    contactWindowStart: 9,
    contactWindowEnd: 20,
    notifyOnConversion: true,
    notifyOnNewQualified: true,
    preferredChannel: "telegram",
    timezone: process.env["TZ"] ?? "UTC",
    language: process.env["PREFERRED_LANGUAGE"] ?? "en",
    lastUpdatedAt: new Date().toISOString(),
    updatedFields: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function loadSettings(context: ToolContext): Promise<TenantSettings> {
  const data = await context.storage.get("settings.json");
  return data ?? (defaultSettings());
}

async function saveSettings(context: ToolContext, settings: TenantSettings): Promise<void> {
  await context.storage.set("settings.json", settings);
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

type SettingKey = keyof Omit<TenantSettings, "lastUpdatedAt" | "updatedFields">;

interface SettingMeta {
  type: "boolean" | "number" | "string" | "channel";
  min?: number;
  max?: number;
  allowed?: string[];
  description: string;
}

const SETTING_META: Record<SettingKey, SettingMeta> = {
  manualApproval: {
    type: "boolean",
    description: "Require tenant approval before sending first-contact messages",
  },
  hiveOptIn: {
    type: "boolean",
    description: "Allow contributing anonymized patterns to the cross-tenant Hive",
  },
  slowDripEnabled: {
    type: "boolean",
    description: "Continue sending 1/month slow-drip messages to exited leads",
  },
  aftercareEnabled: {
    type: "boolean",
    description: "Run aftercare sequences for converted leads",
  },
  scoutEnabled: {
    type: "boolean",
    description: "Run daily 5 AM prospect discovery scan",
  },
  dailyBriefingEnabled: {
    type: "boolean",
    description: "Send daily 7 AM briefing to preferred channel",
  },
  maxDailyContacts: {
    type: "number",
    min: 1,
    max: 50,
    description: "Maximum first-contact messages sent per day (1-50)",
  },
  contactWindowStart: {
    type: "number",
    min: 0,
    max: 23,
    description: "Earliest hour to send contacts in prospect's local timezone (0-23)",
  },
  contactWindowEnd: {
    type: "number",
    min: 0,
    max: 23,
    description: "Latest hour to send contacts in prospect's local timezone (0-23)",
  },
  notifyOnConversion: {
    type: "boolean",
    description: "Send immediate briefing alert when a lead converts",
  },
  notifyOnNewQualified: {
    type: "boolean",
    description: "Send immediate briefing alert when leads cross the 80-point threshold",
  },
  preferredChannel: {
    type: "channel",
    allowed: ["telegram", "whatsapp", "line", "sms"],
    description: "Channel for briefings and alerts (telegram | whatsapp | line | sms)",
  },
  timezone: {
    type: "string",
    description: "IANA timezone string (e.g. America/Phoenix, Asia/Bangkok)",
  },
  language: {
    type: "string",
    allowed: ["en", "th", "zh", "ja", "ko", "es", "pt", "de", "fr"],
    description: "Bot communication language code (en | th | zh | ja | ko | es | pt | de | fr)",
  },
  botName: {
    type: "string",
    description: "Override the bot's display name (falls back to name set during onboarding)",
  },
};

function validateValue(key: SettingKey, value: unknown): { ok: boolean; error?: string; coerced?: unknown } {
  const meta = SETTING_META[key];
  if (!meta) return { ok: false, error: `Unknown setting: ${key}` };

  switch (meta.type) {
    case "boolean": {
      if (typeof value === "boolean") return { ok: true };
      if (value === "true" || value === "1") return { ok: true, coerced: true };
      if (value === "false" || value === "0") return { ok: true, coerced: false };
      return { ok: false, error: `${key} must be true or false` };
    }

    case "number": {
      const n = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(n)) return { ok: false, error: `${key} must be a number` };
      if (meta.min !== undefined && n < meta.min) return { ok: false, error: `${key} minimum is ${meta.min}` };
      if (meta.max !== undefined && n > meta.max) return { ok: false, error: `${key} maximum is ${meta.max}` };
      return { ok: true, coerced: Math.round(n) };
    }

    case "channel":
    case "string": {
      if (typeof value !== "string") return { ok: false, error: `${key} must be a string` };
      if (meta.allowed && !meta.allowed.includes(value)) {
        return { ok: false, error: `${key} must be one of: ${meta.allowed.join(", ")}` };
      }
      if (value.trim() === "") return { ok: false, error: `${key} cannot be empty` };
      return { ok: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Action: get
// ---------------------------------------------------------------------------

async function handleGet(context: ToolContext): Promise<ToolResult> {
  const settings = await loadSettings(context);

  const lines = [
    `Current settings:`,
    ``,
    `  WORKFLOW`,
    `  manualApproval       ${settings.manualApproval}  — first contacts require your approval before sending`,
    `  scoutEnabled         ${settings.scoutEnabled}  — daily 5 AM prospect discovery`,
    `  dailyBriefingEnabled ${settings.dailyBriefingEnabled}  — daily 7 AM briefing`,
    `  slowDripEnabled      ${settings.slowDripEnabled}  — monthly slow drip for exited leads`,
    `  aftercareEnabled     ${settings.aftercareEnabled}  — aftercare sequences for converted leads`,
    `  hiveOptIn            ${settings.hiveOptIn}  — share anonymized patterns with the Hive`,
    ``,
    `  CONTACT TIMING`,
    `  maxDailyContacts     ${settings.maxDailyContacts}  — max first-contact messages per day`,
    `  contactWindowStart   ${settings.contactWindowStart}:00  — earliest hour to send`,
    `  contactWindowEnd     ${settings.contactWindowEnd}:00  — latest hour to send`,
    ``,
    `  NOTIFICATIONS`,
    `  notifyOnConversion   ${settings.notifyOnConversion}  — alert when a lead converts`,
    `  notifyOnNewQualified ${settings.notifyOnNewQualified}  — alert when leads hit 80+ score`,
    ``,
    `  LOCALE`,
    `  preferredChannel     ${settings.preferredChannel}`,
    `  timezone             ${settings.timezone}`,
    `  language             ${settings.language}`,
    ...(settings.botName ? [`  botName              ${settings.botName}`] : []),
    ``,
    settings.updatedFields.length > 0
      ? `Manually customized: ${settings.updatedFields.join(", ")}`
      : `All settings at defaults.`,
    ``,
    `To change a setting: tiger_settings set key:<name> value:<value>`,
  ];

  return {
    ok: true,
    output: lines.join("\n"),
    data: settings,
  };
}

// ---------------------------------------------------------------------------
// Action: set
// ---------------------------------------------------------------------------

interface SetParams {
  action: "set";
  key: string;
  value: unknown;
}

async function handleSet(
  params: SetParams,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const key = params.key as SettingKey;
  if (!SETTING_META[key]) {
    const validKeys = Object.keys(SETTING_META).join(", ");
    return { ok: false, error: `Unknown setting: "${key}".\nValid settings: ${validKeys}` };
  }

  const validation = validateValue(key, params.value);
  if (!validation.ok) return { ok: false, error: validation.error };

  const settings = await loadSettings(context);
  const oldValue = settings[key];
  const newValue = validation.coerced !== undefined ? validation.coerced : params.value;

  (settings as Record<string, unknown>)[key] = newValue;
  settings.lastUpdatedAt = new Date().toISOString();

  if (!settings.updatedFields.includes(key as string)) {
    settings.updatedFields.push(key as string);
  }

  await saveSettings(context, settings);

  logger.info("tiger_settings: set", { key, oldValue, newValue });

  const meta = SETTING_META[key];
  const impact = settingImpactNote(key, newValue);

  return {
    ok: true,
    output: [
      `${key} updated: ${String(oldValue)} → ${String(newValue)}`,
      meta.description,
      ...(impact ? [``, `Note: ${impact}`] : []),
    ].join("\n"),
    data: { key, oldValue, newValue },
  };
}

function settingImpactNote(key: SettingKey, value: unknown): string | null {
  switch (key) {
    case "manualApproval":
      return value === true
        ? "First-contact messages will queue as 'pending_approval'. Run tiger_contact list to review and approve them."
        : "First-contact messages will be scheduled automatically. No approval needed.";
    case "hiveOptIn":
      return value === true
        ? "tiger_hive generate with autoSubmit:true will now submit patterns to the platform Hive."
        : null;
    case "scoutEnabled":
      return value === false ? "Daily 5 AM scout is disabled. Run tiger_scout hunt manually when needed." : null;
    case "dailyBriefingEnabled":
      return value === false ? "Daily briefing disabled. Run tiger_briefing generate manually." : null;
    case "contactWindowStart":
    case "contactWindowEnd":
      return "This affects when the bot schedules first-contact messages relative to the prospect's timezone.";
    case "preferredChannel":
      return `Briefings and alerts will now be sent via ${value}. Ensure the channel is connected in Tiger Claw.`;
    case "timezone":
      return "Affects cron scheduling for scout (5 AM), briefing (7 AM), and contact timing windows.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Action: reset
// ---------------------------------------------------------------------------

interface ResetParams {
  action: "reset";
  key?: string;   // Reset one key, or all if omitted
}

async function handleReset(
  params: ResetParams,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const settings = await loadSettings(context);
  const defaults = defaultSettings();

  if (params.key) {
    const key = params.key as SettingKey;
    if (!SETTING_META[key]) {
      return { ok: false, error: `Unknown setting: "${key}"` };
    }
    const defaultVal = defaults[key];
    (settings as Record<string, unknown>)[key] = defaultVal;
    settings.updatedFields = settings.updatedFields.filter((f) => f !== key);
    settings.lastUpdatedAt = new Date().toISOString();
    await saveSettings(context, settings);
    logger.info("tiger_settings: reset one", { key, defaultVal });
    return {
      ok: true,
      output: `${key} reset to default: ${String(defaultVal)}`,
      data: { key, value: defaultVal },
    };
  }

  // Reset all
  const fresh = defaultSettings();
  await saveSettings(context, fresh);
  logger.info("tiger_settings: reset all");

  return {
    ok: true,
    output: `All settings reset to defaults.`,
    data: fresh,
  };
}

// ---------------------------------------------------------------------------
// Action: channels
// ---------------------------------------------------------------------------

type ChannelSubAction = "list" | "add" | "remove";
type ChannelName = "whatsapp" | "line";

interface ChannelsParams {
  action: "channels";
  subAction: ChannelSubAction;
  channel?: ChannelName;
  lineChannelSecret?: string;
  lineChannelAccessToken?: string;
}

async function handleChannels(
  params: ChannelsParams,
  context: ToolContext,
  logger: ToolContext["logger"],
): Promise<ToolResult> {
  // BUG FIX: In multi-tenant single-process architecture, TENANT_SLUG env var is never set.
  // Slug comes from context.config (populated by buildToolContext in ai.ts).
  const slug = (context.config["TIGER_CLAW_TENANT_SLUG"] as string) ?? process.env["TENANT_SLUG"] ?? "";
  // INTERNAL_API_URL for self-calls — TIGER_CLAW_API_URL is the external/public URL
  const apiBase = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";

  if (!slug) {
    return { ok: false, error: "TENANT_SLUG env var is not set — cannot manage channels." };
  }

  switch (params.subAction) {
    case "list": {
      // BUG FIX: old code read per-tenant env vars that don't exist in multi-tenant architecture.
      // Channel credentials are stored encrypted in PostgreSQL — query the API for real status.
      let waEnabled = false;
      let lineConfigured = false;
      try {
        const resp = await fetch(`${apiBase}/tenants/${slug}/channels`);
        if (resp.ok) {
          const data = await resp.json() as { telegram?: boolean; whatsapp?: boolean; line?: boolean };
          waEnabled = !!data.whatsapp;
          lineConfigured = !!data.line;
        }
      } catch {
        // If API is unreachable, fall through with defaults (false)
      }
      const lines = [
        "Channel status:",
        "",
        "  Telegram   ACTIVE         (primary — always on)",
        `  WhatsApp   ${waEnabled ? "ENABLED" : "DISABLED"}`,
        `  LINE       ${lineConfigured ? "CONFIGURED" : "NOT CONFIGURED"}`,
        "",
        "To add/remove: channels add whatsapp, channels add line [secret] [token], channels remove line, etc.",
      ];
      return { ok: true, output: lines.join("\n") };
    }

    case "add": {
      if (!params.channel) {
        return { ok: false, error: "channel is required for add. Valid: whatsapp | line" };
      }

      if (params.channel === "whatsapp") {
        const resp = await apiPost(`${apiBase}/tenants/${slug}/channels/whatsapp`, { enabled: true });
        if (!resp.ok) return { ok: false, error: resp.error ?? "Failed to enable WhatsApp." };
        logger.info("tiger_settings: channels add whatsapp");
        return {
          ok: true,
          output: "WhatsApp enabled. Your agent will send a QR code to this chat shortly. Scan it with WhatsApp to link your account.",
        };
      }

      if (params.channel === "line") {
        if (!params.lineChannelSecret || !params.lineChannelAccessToken) {
          return { ok: false, error: "Both lineChannelSecret and lineChannelAccessToken are required. Usage: channels add line [secret] [token]" };
        }
        if (params.lineChannelSecret.length > 200 || params.lineChannelAccessToken.length > 200) {
          return { ok: false, error: "LINE credentials must be 200 characters or fewer each." };
        }
        const resp = await apiPost(`${apiBase}/tenants/${slug}/channels/line`, {
          channelSecret: params.lineChannelSecret,
          channelAccessToken: params.lineChannelAccessToken,
        });
        if (!resp.ok) return { ok: false, error: resp.error ?? "Failed to configure LINE." };
        logger.info("tiger_settings: channels add line");
        return { ok: true, output: "LINE channel configured." };
      }

      return { ok: false, error: `Unknown channel: "${params.channel}". Valid: whatsapp | line` };
    }

    case "remove": {
      if (!params.channel) {
        return { ok: false, error: "channel is required for remove. Valid: whatsapp | line" };
      }

      if (params.channel === "whatsapp") {
        const resp = await apiPost(`${apiBase}/tenants/${slug}/channels/whatsapp`, { enabled: false });
        if (!resp.ok) return { ok: false, error: resp.error ?? "Failed to disable WhatsApp." };
        logger.info("tiger_settings: channels remove whatsapp");
        return { ok: true, output: "WhatsApp disabled." };
      }

      if (params.channel === "line") {
        const resp = await apiPost(`${apiBase}/tenants/${slug}/channels/line`, {
          channelSecret: null,
          channelAccessToken: null,
        });
        if (!resp.ok) return { ok: false, error: resp.error ?? "Failed to remove LINE." };
        logger.info("tiger_settings: channels remove line");
        return { ok: true, output: "LINE channel removed." };
      }

      return { ok: false, error: `Unknown channel: "${params.channel}". Valid: whatsapp | line` };
    }

    default:
      return { ok: false, error: `Unknown subAction: "${params.subAction}". Valid: list | add | remove` };
  }
}

async function apiPost(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (resp.ok) return { ok: true };
    const data = await resp.json().catch(() => ({}));
    return { ok: false, error: (data as Record<string, string>).error ?? `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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

  logger.info("tiger_settings called", { action });

  try {
    switch (action) {
      case "get":
        return await handleGet(context);

      case "set":
        return await handleSet(params as unknown as SetParams, context, logger);

      case "reset":
        return await handleReset(params as unknown as ResetParams, context, logger);

      case "channels":
        return await handleChannels(params as unknown as ChannelsParams, context, logger);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: get | set | reset | channels`,
        };
    }
  } catch (err) {
    logger.error("tiger_settings error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_settings error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export const tiger_settings = {
  name: "tiger_settings",
  description:
    "Tenant settings and channel management. Actions: get/set/reset for settings.json, channels for managing messaging channels (Telegram, WhatsApp, LINE). Settings: manualApproval, hiveOptIn, preferredChannel, timezone, language, dailyBriefingEnabled, scoutEnabled, maxDailyContacts, contactWindowStart/End, slowDripEnabled, aftercareEnabled, notifyOnConversion, notifyOnNewQualified, botName. Channel commands: channels list (show status), channels add whatsapp/line, channels remove whatsapp/line.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["get", "set", "reset", "channels"],
        description:
          "get: show all current settings. set: update one setting. reset: reset to defaults. channels: manage messaging channels (requires subAction).",
      },
      key: {
        type: "string",
        description: "Setting name. Required for set and reset (single-key reset).",
      },
      value: {
        description: "New value for the setting. Required for set.",
      },
      subAction: {
        type: "string",
        enum: ["list", "add", "remove"],
        description: "Channel sub-action. Required when action is 'channels'.",
      },
      channel: {
        type: "string",
        enum: ["whatsapp", "line"],
        description: "Channel to add or remove. Required for channels add/remove.",
      },
      lineChannelSecret: {
        type: "string",
        description: "LINE channel secret. Required for channels add line.",
      },
      lineChannelAccessToken: {
        type: "string",
        description: "LINE channel access token. Required for channels add line.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_settings;
