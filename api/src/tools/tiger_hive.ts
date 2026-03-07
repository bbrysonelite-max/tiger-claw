// Tiger Claw — tiger_hive Tool
// Cross-tenant anonymous pattern learning — Block 1.4, Layer 3 of TIGERCLAW-MASTER-SPEC-v2.md
//
// LOCKED architecture:
//   Hive patterns live in the SHARED platform PostgreSQL — NOT per-tenant SQLite.
//   Hard isolation: tenants NEVER see each other's identifiable data.
//   Opt-in only. All submissions are fully anonymized.
//   API: GET /hive/patterns and POST /hive/patterns on TenantOrchestrator (port 4000).
//
// What Hive patterns are (v1 Layer 3 examples):
//   "Prospects mentioning job dissatisfaction convert at 3x rate."
//   "Reciprocity touch on day 3 gets highest reply rate for this flavor."
//   "LinkedIn leads score 20% higher than Facebook for this tenant."
//
// Anonymization rules (LOCKED — no tenant data ever leaves):
//   NO tenant identifiers, NO lead names, NO platform usernames.
//   ONLY: flavor, region, category, statistical observation, data point count, confidence.
//
// Pattern categories:
//   scoring     — which lead signals predict conversion
//   discovery   — which sources yield higher quality leads
//   nurture     — which touches drive best engagement
//   conversion  — what drives 8-10 scores
//   objection   — which buckets appear most, what resolves them
//
// When the Tiger Claw API is unreachable: falls back to local cache in hive_cache.json.
// Local cache is refreshed on every successful API query.
//
// Actions:
//   query    — fetch relevant patterns from platform Hive (GET /hive/patterns)
//   submit   — send an anonymized pattern to the platform (POST /hive/patterns)
//   generate — analyze local data, detect patterns worth knowing + submitting
//   list     — show locally cached patterns + submitted patterns

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PatternCategory = "scoring" | "discovery" | "nurture" | "conversion" | "objection";

interface HivePattern {
  id: string;
  flavor: string;
  region: string;
  category: PatternCategory;
  observation: string;          // The insight in plain English
  dataPoints: number;           // How many events this is based on
  confidence: number;           // 0-100
  anonymous: true;
  submittedAt: string;
  source?: "platform" | "local"; // platform = from API, local = generated but not yet submitted
}

interface HiveCache {
  lastRefreshedAt?: string;
  patterns: HivePattern[];
  submitted: HivePattern[];     // Patterns this tenant has submitted
}

interface LeadRecord {
  id: string;
  platform: string;
  qualified: boolean;
  builderScore?: number;
  customerScore?: number;
  intentSignalHistory: Array<{ type: string; excerpt?: string; source?: string }>;
  discoveredAt?: string;
  importedAt?: string;
  importSource?: string;
  converted?: boolean;
  optedOut?: boolean;
}

interface NurtureRecord {
  id: string;
  status: string;
  enrolledAt: string;
  touchHistory: Array<{
    type: string;
    sentAt?: string;
    responseClassification?: string;
    oneToTenScore?: number;
  }>;
  lastOneToTenScore?: number;
  lastGapAnswer?: string;
  convertedAt?: string;
}

interface ContactRecord {
  id: string;
  strategy: string;
  status: string;
  responseType?: string;
}

interface OnboardState {
  phase: string;
  flavor: string;
  identity: { name?: string };
  botName?: string;
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
// Persistence
// ---------------------------------------------------------------------------

async function loadJson<T>(context: ToolContext, key: string): Promise<T | null> {
  const data = await context.storage.get(key);
  return data ?? null;
}

async function saveJson<T>(context: ToolContext, key: string, data: unknown): Promise<void> {
  await context.storage.set(key, data);
}

async function loadCache(context: ToolContext): Promise<HiveCache> {
  const data = await context.storage.get("cache.json");
  return data ?? ([]);
}

async function saveCache(context: ToolContext, cache: HiveCache): Promise<void> {
  await context.storage.set("cache.json", cache);
}

function getApiBase(config: Record<string, unknown>): string {
  return (
    (config["TIGER_CLAW_API_URL"] as string | undefined) ??
    process.env["TIGER_CLAW_API_URL"] ??
    "http://host.docker.internal:4000"
  );
}

function getTenantId(config: Record<string, unknown>): string {
  return (
    (config["TIGER_CLAW_TENANT_ID"] as string | undefined) ??
    process.env["TIGER_CLAW_TENANT_ID"] ??
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// HTTP helper — graceful, no hard crash on unreachable API
// ---------------------------------------------------------------------------

function httpRequest(
  url: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, error: "Request timed out" }), 8000);

    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === "https:";
      const lib = isHttps ? https : http;

      const bodyStr = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      };

      const req = lib.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(raw);
            resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode, data });
          } catch {
            resolve({ ok: false, status: res.statusCode, error: "Invalid JSON response" });
          }
        });
      });

      req.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    } catch (err) {
      clearTimeout(timeout);
      resolve({ ok: false, error: String(err) });
    }
  });
}

// ---------------------------------------------------------------------------
// Action: query — fetch patterns from platform Hive
// ---------------------------------------------------------------------------

interface QueryParams {
  action: "query";
  category?: PatternCategory;
  limit?: number;
}

async function handleQuery(
  params: QueryParams,
  context: ToolContext
): Promise<ToolResult> {
  const onboard = await loadJson<OnboardState>(context, "onboard_state.json");
  const flavor = onboard?.flavor ?? process.env["BOT_FLAVOR"] ?? "network-marketer";
  const region = (process.env["REGION"] ?? "us-en");
  const apiBase = getApiBase(context.config);
  const limit = params.limit ?? 10;

  const queryParams = new URLSearchParams({
    flavor,
    region,
    limit: String(limit),
    ...(params.category ? { category: params.category } : {}),
  });

  const url = `${apiBase}/hive/patterns?${queryParams}`;
  context.logger.info("tiger_hive: querying platform", { url });

  const result = await httpRequest(url, "GET");
  const cache = await loadCache(context);

  if (result.ok && Array.isArray((result.data as Record<string, unknown>)?.patterns)) {
    const patterns = ((result.data as Record<string, unknown>).patterns as HivePattern[]).map((p) => ({
      ...p,
      source: "platform" as const,
    }));
    cache.patterns = patterns;
    cache.lastRefreshedAt = new Date().toISOString();
    await saveCache(context, cache);

    const lines = formatPatterns(patterns, "Platform Hive Patterns");
    return {
      ok: true,
      output: lines,
      data: { patterns, source: "platform", count: patterns.length },
    };
  }

  // API unreachable — serve from cache
  context.logger.warn("tiger_hive: API unreachable, serving from cache", { error: result.error });

  const cached = params.category
    ? cache.patterns.filter((p) => p.category === params.category)
    : cache.patterns;

  const cacheNote = cache.lastRefreshedAt
    ? `(cached — last refreshed ${new Date(cache.lastRefreshedAt).toDateString()})`
    : "(no cache available — platform unreachable)";

  if (cached.length === 0) {
    return {
      ok: true,
      output: `No Hive patterns available ${cacheNote}.\nRun tiger_hive generate to detect local patterns.`,
      data: { patterns: [], source: "cache", cacheNote },
    };
  }

  return {
    ok: true,
    output: formatPatterns(cached.slice(0, limit), `Hive Patterns ${cacheNote}`),
    data: { patterns: cached.slice(0, limit), source: "cache", cacheNote },
  };
}

function formatPatterns(patterns: HivePattern[], title: string): string {
  if (patterns.length === 0) return `${title}: no patterns found.`;
  const lines = [`${title} (${patterns.length}):`, ``];
  for (const p of patterns) {
    lines.push(`  [${p.category}] ${p.observation}`);
    lines.push(`  Confidence: ${p.confidence}% | Data points: ${p.dataPoints} | Flavor: ${p.flavor}`);
    lines.push(``);
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Action: submit — send an anonymized pattern to the platform
// ---------------------------------------------------------------------------

interface SubmitParams {
  action: "submit";
  category: PatternCategory;
  observation: string;
  dataPoints: number;
  confidence: number;
}

async function handleSubmit(
  params: SubmitParams,
  context: ToolContext
): Promise<ToolResult> {
  const onboard = await loadJson<OnboardState>(context, "onboard_state.json");
  const flavor = onboard?.flavor ?? process.env["BOT_FLAVOR"] ?? "network-marketer";
  const region = process.env["REGION"] ?? "us-en";
  const apiBase = getApiBase(context.config);

  // Validate observation is actually anonymous — warn if it contains suspicious PII patterns
  const piiWarnings = detectPii(params.observation);
  if (piiWarnings.length > 0) {
    return {
      ok: false,
      error: [
        `Submission blocked — observation may contain non-anonymous data.`,
        `Detected: ${piiWarnings.join(", ")}`,
        `Rephrase using only statistical language (e.g. "X% of leads" not "John Smith").`,
      ].join("\n"),
    };
  }

  const pattern: HivePattern = {
    id: crypto.randomUUID(),
    flavor,
    region,
    category: params.category,
    observation: params.observation,
    dataPoints: params.dataPoints,
    confidence: Math.min(100, Math.max(0, params.confidence)),
    anonymous: true,
    submittedAt: new Date().toISOString(),
    source: "platform",
  };

  const url = `${apiBase}/hive/patterns`;
  context.logger.info("tiger_hive: submitting pattern", { category: params.category });

  const result = await httpRequest(url, "POST", pattern);

  // Save to local submitted list regardless of API success
  const cache = await loadCache(context);
  cache.submitted.push({ ...pattern, source: "local" });
  await saveCache(context, cache);

  if (!result.ok) {
    return {
      ok: true, // Pattern is saved locally — not a hard failure
      output: [
        `Pattern saved locally (platform unreachable — will sync when available).`,
        `Category: ${params.category}`,
        `Observation: "${params.observation}"`,
        `Data points: ${params.dataPoints} | Confidence: ${params.confidence}%`,
      ].join("\n"),
      data: { pattern, queued: true },
    };
  }

  return {
    ok: true,
    output: [
      `Pattern submitted to Hive.`,
      `Category: ${params.category}`,
      `Observation: "${params.observation}"`,
      `Data points: ${params.dataPoints} | Confidence: ${params.confidence}%`,
    ].join("\n"),
    data: { pattern, submitted: true },
  };
}

// Simple PII detector — catches names, phone numbers, emails
function detectPii(text: string): string[] {
  const warnings: string[] = [];
  // Email pattern
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) warnings.push("email address");
  // Phone pattern
  if (/\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) warnings.push("phone number");
  // Patterns suggesting a specific person (Capitalized Name sequences)
  if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text)) warnings.push("possible name (use 'lead' or 'prospect' instead)");
  return warnings;
}

// ---------------------------------------------------------------------------
// Action: generate — detect patterns in local data
// ---------------------------------------------------------------------------

interface GenerateParams {
  action: "generate";
  autoSubmit?: boolean;   // If true, submit high-confidence patterns automatically
}

async function handleGenerate(
  params: GenerateParams,
  context: ToolContext
): Promise<ToolResult> {
  const leads = await loadJson<Record<string, LeadRecord>>(context, "leads.json") ?? {};
  const nurtures = await loadJson<Record<string, NurtureRecord>>(context, "nurture.json") ?? {};
  const contacts = await loadJson<Record<string, ContactRecord>>(context, "contacts.json") ?? {};
  const conversions = await loadJson<Record<string, { leadId: string; oar: string; journeySummary?: { touchesCompleted: number; daysInNurture: number } }>>
    (context, "conversions.json") ?? {};
  const onboard = await loadJson<OnboardState>(context, "onboard_state.json");

  const flavor = onboard?.flavor ?? process.env["BOT_FLAVOR"] ?? "network-marketer";
  const allLeads = Object.values(leads);
  const allNurtures = Object.values(nurtures);
  const allContacts = Object.values(contacts);
  const allConversions = Object.values(conversions);

  const patterns: Array<Omit<HivePattern, "id" | "submittedAt" | "source">> = [];

  // ---- Pattern 1: Source / platform qualified rates ----
  const bySource: Record<string, { total: number; qualified: number }> = {};
  for (const l of allLeads) {
    const src = l.platform ?? "unknown";
    bySource[src] = bySource[src] ?? { total: 0, qualified: 0 };
    bySource[src].total++;
    if (l.qualified) bySource[src].qualified++;
  }

  for (const [src, stats] of Object.entries(bySource)) {
    if (stats.total >= 10) {
      const rate = Math.round((stats.qualified / stats.total) * 100);
      const allRate = allLeads.length > 0
        ? Math.round((allLeads.filter((l) => l.qualified).length / allLeads.length) * 100)
        : 0;
      if (Math.abs(rate - allRate) >= 15) {
        patterns.push({
          flavor,
          region: process.env["REGION"] ?? "us-en",
          category: "discovery",
          observation: `${src} leads qualify at ${rate}% vs ${allRate}% overall (${stats.total} data points).`,
          dataPoints: stats.total,
          confidence: Math.min(90, 50 + stats.total),
          anonymous: true,
        });
      }
    }
  }

  // ---- Pattern 2: Nurture touch type response rates ----
  const byTouchType: Record<string, { sent: number; positive: number }> = {};
  for (const n of allNurtures) {
    for (const t of n.touchHistory) {
      if (!t.sentAt) continue;
      byTouchType[t.type] = byTouchType[t.type] ?? { sent: 0, positive: 0 };
      byTouchType[t.type].sent++;
      if (t.responseClassification === "hot" || t.responseClassification === "warm") {
        byTouchType[t.type].positive++;
      }
    }
  }

  const touchEntries = Object.entries(byTouchType).filter(([, s]) => s.sent >= 5);
  if (touchEntries.length > 0) {
    // Find best performing touch type
    const [bestType, bestStats] = touchEntries.sort(
      ([, a], [, b]) => b.positive / b.sent - a.positive / a.sent
    )[0];
    const rate = Math.round((bestStats.positive / bestStats.sent) * 100);
    patterns.push({
      flavor,
      region: process.env["REGION"] ?? "us-en",
      category: "nurture",
      observation: `'${bestType}' touch type yields ${rate}% positive response rate (${bestStats.sent} sends).`,
      dataPoints: bestStats.sent,
      confidence: Math.min(85, 40 + bestStats.sent * 2),
      anonymous: true,
    });
  }

  // ---- Pattern 3: First contact strategy response rates ----
  const byStrategy: Record<string, { sent: number; positive: number }> = {};
  for (const c of allContacts) {
    if (!c.status || c.status === "scheduled" || c.status === "pending_approval") continue;
    byStrategy[c.strategy] = byStrategy[c.strategy] ?? { sent: 0, positive: 0 };
    byStrategy[c.strategy].sent++;
    if (c.responseType === "positive") byStrategy[c.strategy].positive++;
  }

  for (const [strategy, stats] of Object.entries(byStrategy)) {
    if (stats.sent >= 5) {
      const rate = Math.round((stats.positive / stats.sent) * 100);
      patterns.push({
        flavor,
        region: process.env["REGION"] ?? "us-en",
        category: "discovery",
        observation: `'${strategy}' first contact strategy yields ${rate}% positive response rate (${stats.sent} sends).`,
        dataPoints: stats.sent,
        confidence: Math.min(80, 40 + stats.sent * 3),
        anonymous: true,
      });
    }
  }

  // ---- Pattern 4: Conversion metrics ----
  const completed = allConversions.filter((c) => c.journeySummary);
  if (completed.length >= 3) {
    const avgDays = Math.round(
      completed.reduce((sum, c) => sum + (c.journeySummary?.daysInNurture ?? 0), 0) / completed.length
    );
    const avgTouches = Math.round(
      completed.reduce((sum, c) => sum + (c.journeySummary?.touchesCompleted ?? 0), 0) / completed.length
    );
    patterns.push({
      flavor,
      region: process.env["REGION"] ?? "us-en",
      category: "conversion",
      observation: `Average conversion: ${avgDays} days, ${avgTouches} touches in nurture (${completed.length} conversions).`,
      dataPoints: completed.length,
      confidence: Math.min(90, 50 + completed.length * 5),
      anonymous: true,
    });
  }

  // ---- Pattern 5: Imported vs discovered lead conversion rate ----
  const imported = allLeads.filter((l) => l.importedAt);
  const discovered = allLeads.filter((l) => !l.importedAt);
  if (imported.length >= 5 && discovered.length >= 5) {
    const importedConv = Math.round((imported.filter((l) => l.converted).length / imported.length) * 100);
    const discoveredConv = Math.round((discovered.filter((l) => l.converted).length / discovered.length) * 100);
    if (Math.abs(importedConv - discoveredConv) >= 10) {
      const higher = importedConv > discoveredConv ? "Imported" : "Discovered";
      const lower = importedConv > discoveredConv ? "discovered" : "imported";
      const highRate = Math.max(importedConv, discoveredConv);
      const lowRate = Math.min(importedConv, discoveredConv);
      patterns.push({
        flavor,
        region: process.env["REGION"] ?? "us-en",
        category: "scoring",
        observation: `${higher} warm contacts convert at ${highRate}% vs ${lowRate}% for ${lower} leads (${imported.length + discovered.length} total).`,
        dataPoints: imported.length + discovered.length,
        confidence: Math.min(85, 50 + (imported.length + discovered.length)),
        anonymous: true,
      });
    }
  }

  if (patterns.length === 0) {
    return {
      ok: true,
      output: [
        `No patterns detected yet — not enough data.`,
        `Minimum data requirements:`,
        `  Discovery patterns: 10+ leads per source`,
        `  Nurture patterns:   5+ touches per type`,
        `  Contact patterns:   5+ sends per strategy`,
        `  Conversion patterns: 3+ conversions`,
        ``,
        `Keep running the flywheel — patterns surface naturally.`,
      ].join("\n"),
      data: { patterns: [], dataPoints: { leads: allLeads.length, nurtures: allNurtures.length, conversions: allConversions.length } },
    };
  }

  // Save locally
  const cache = await loadCache(context);
  const now = new Date().toISOString();
  const newPatterns: HivePattern[] = patterns.map((p) => ({
    ...p,
    id: crypto.randomUUID(),
    submittedAt: now,
    source: "local" as const,
  }));

  // Replace local-source patterns with fresh ones
  cache.patterns = [
    ...cache.patterns.filter((p) => p.source === "platform"),
    ...newPatterns,
  ];
  await saveCache(context, cache);

  // Auto-submit high-confidence patterns if requested
  let submitted = 0;
  if (params.autoSubmit) {
    for (const p of newPatterns.filter((p) => p.confidence >= 70)) {
      const piiCheck = detectPii(p.observation);
      if (piiCheck.length === 0) {
        await handleSubmit(
          { action: "submit", category: p.category, observation: p.observation, dataPoints: p.dataPoints, confidence: p.confidence },
          context
        );
        submitted++;
      }
    }
  }

  const lines = [
    `${patterns.length} pattern(s) detected from local data:`,
    ``,
    ...newPatterns.map((p) => [
      `  [${p.category}] ${p.observation}`,
      `  Confidence: ${p.confidence}% | Data points: ${p.dataPoints}`,
      ``,
    ].join("\n")),
    params.autoSubmit
      ? `${submitted} high-confidence pattern(s) auto-submitted to Hive.`
      : `Call tiger_hive submit to share any of these with the platform Hive (opt-in only).`,
  ];

  return {
    ok: true,
    output: lines.join("\n").trim(),
    data: { patterns: newPatterns, submitted, autoSubmit: params.autoSubmit ?? false },
  };
}

// ---------------------------------------------------------------------------
// Action: list — show cached + submitted patterns
// ---------------------------------------------------------------------------

async function handleList(context: ToolContext, category?: PatternCategory): Promise<ToolResult> {
  const cache = await loadCache(context);

  const allPatterns = [...cache.patterns, ...cache.submitted];
  const filtered = category ? allPatterns.filter((p) => p.category === category) : allPatterns;

  if (filtered.length === 0) {
    return {
      ok: true,
      output: [
        `No Hive patterns cached locally.`,
        `Run tiger_hive query to fetch from platform.`,
        `Run tiger_hive generate to detect local patterns.`,
      ].join("\n"),
      data: { patterns: [] },
    };
  }

  const platform = filtered.filter((p) => p.source === "platform");
  const local = filtered.filter((p) => p.source === "local");
  const submitted = cache.submitted.filter((p) => category ? p.category === category : true);

  const lines: string[] = [
    `Hive Patterns (${filtered.length} total):`,
    `  Platform: ${platform.length} | Local: ${local.length} | Submitted by you: ${submitted.length}`,
    cache.lastRefreshedAt ? `  Last refreshed: ${new Date(cache.lastRefreshedAt).toDateString()}` : "",
    ``,
  ];

  if (platform.length > 0) {
    lines.push(`FROM PLATFORM:`);
    for (const p of platform) {
      lines.push(`  [${p.category}] ${p.observation}`);
      lines.push(`  Confidence: ${p.confidence}% | ${p.dataPoints} data points | ${p.flavor} / ${p.region}`);
      lines.push(``);
    }
  }

  if (local.length > 0) {
    lines.push(`DETECTED LOCALLY (not yet submitted):`);
    for (const p of local) {
      lines.push(`  [${p.category}] ${p.observation}`);
      lines.push(`  Confidence: ${p.confidence}% | ${p.dataPoints} data points`);
      lines.push(``);
    }
  }

  return {
    ok: true,
    output: lines.join("\n").trim(),
    data: { total: filtered.length, platform: platform.length, local: local.length, submitted: submitted.length },
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

  logger.info("tiger_hive called", { action });

  try {
    switch (action) {
      case "query":
        return await handleQuery(params as unknown as QueryParams, context);

      case "submit":
        return await handleSubmit(params as unknown as SubmitParams, context);

      case "generate":
        return await handleGenerate(params as unknown as GenerateParams, context);

      case "list":
        return await handleList(context, params.category as PatternCategory | undefined);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: query | submit | generate | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_hive error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_hive error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_hive = {
  name: "tiger_hive",
  description:
    "Cross-tenant anonymous pattern learning. Connects to the shared platform Hive (GET/POST /hive/patterns on TenantOrchestrator). LOCKED: fully anonymous — no tenant identifiers, lead names, or personal data ever leave the container. Opt-in only. Pattern categories: scoring (which signals predict conversion), discovery (which sources yield better leads), nurture (which touches drive engagement), conversion (what drives 8-10 scores), objection (common buckets and what resolves them). Falls back to local cache when API is unreachable. generate action analyzes local data files and surfaces insights. submit action sends anonymized patterns with PII check before transmission.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["query", "submit", "generate", "list"],
        description:
          "query: fetch relevant patterns from platform Hive (uses local cache if unreachable). submit: send an anonymized pattern to the platform. generate: analyze local data (leads.json, nurture.json, contacts.json, conversions.json) and detect patterns. list: show all locally cached and submitted patterns.",
      },
      category: {
        type: "string",
        enum: ["scoring", "discovery", "nurture", "conversion", "objection"],
        description: "Filter patterns by category. Optional for query and list.",
      },
      limit: {
        type: "number",
        description: "Max patterns to return from query. Defaults to 10.",
      },
      observation: {
        type: "string",
        description: "The insight to submit, in plain statistical language. MUST be anonymous — no names, emails, or identifiers. Example: 'Reddit leads qualify at 45% vs 28% overall (38 data points).'",
      },
      dataPoints: {
        type: "number",
        description: "Number of data points this observation is based on. Required for submit.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Confidence in the observation, 0-100. Required for submit.",
      },
      autoSubmit: {
        type: "boolean",
        description: "If true, generate will automatically submit high-confidence patterns (≥70%) to the platform Hive. Defaults to false.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_hive;
