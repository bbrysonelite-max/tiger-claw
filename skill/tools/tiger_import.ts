// Tiger Claw — tiger_import Tool
// CSV warm contact importer — Block 3.6 (Manual Lead Import) of TIGERCLAW-MASTER-SPEC-v2.md
//
// LOCKED decisions:
//   #31 — Manual lead import with warm contact scoring
//   #32 — "Just track" option for personal contacts
//   #42 — CSV import for existing organization contacts (e.g., Nu Skin monthly printout)
//   #43 — Org contacts get involvement level tracking (0-7 spectrum)
//   #44 — Bot sends individual nurture, NOT bulk email
//
// Two modes:
//   SINGLE — tenant describes a contact in natural language or structured fields
//     "Add John Smith, met at Phoenix networking event, real estate investor, seemed interested"
//     Profile Fit inferred from description keywords.
//     Intent from tenant's assessment keyword:
//       "seemed interested" = 60, "wants to get started" = 90, etc.
//     Engagement = 0 until first contact.
//
//   CSV — batch import from file contents (Nu Skin printout, etc.)
//     Flexible column mapping: name, phone, email, platform, status, notes, involvement
//     Each row creates one lead record with org involvement tracking.
//
// Four entry points (LOCKED):
//   discovery_pool  — watch, don't contact (default)
//   first_contact   — reach out automatically via tiger_contact
//   nurture         — already talked, pick up sequence via tiger_nurture
//   just_track      — reminder system only, tenant handles personally
//
// Involvement spectrum 0-7 (LOCKED #43):
//   0 Not involved     1 Curious           2 Trying product
//   3 Repeat customer  4 Referral source   5 Wholesale buyer
//   6 Side-hustle builder  7 Full-time builder
//
// All imported contacts write directly to leads.json (same store as discovered leads).
// Import log persisted in import_log.json.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Intent phrase → score mapping (spec LOCKED example values)
const INTENT_PHRASE_MAP: Array<{ keywords: string[]; score: number }> = [
  { keywords: ["wants to get started", "ready to go", "sign me up", "let's do it", "all in"], score: 90 },
  { keywords: ["really excited", "very interested", "definitely interested", "can't wait"], score: 85 },
  { keywords: ["serious interest", "serious about", "seriously interested", "asking about joining"], score: 75 },
  { keywords: ["asked a lot of questions", "lots of questions", "engaged", "very curious"], score: 70 },
  { keywords: ["seemed interested", "interested", "open to it", "open minded", "receptive"], score: 60 },
  { keywords: ["might be interested", "possibly interested", "maybe", "worth a conversation"], score: 50 },
  { keywords: ["not sure", "on the fence", "undecided", "hasn't decided"], score: 40 },
  { keywords: ["skeptical", "doubtful", "hesitant", "not sure if"], score: 30 },
  { keywords: ["not interested", "said no", "declined", "not for them"], score: 10 },
];

// Profile fit keywords → component scores
const PROFILE_FIT_SIGNALS: Array<{ keywords: string[]; boost: number }> = [
  { keywords: ["entrepreneur", "business owner", "self-employed", "owns a business"], boost: 20 },
  { keywords: ["network marketing", "mlm", "direct sales", "distributor"], boost: 25 },
  { keywords: ["sales", "salesperson", "sales background", "in sales"], boost: 15 },
  { keywords: ["real estate", "realtor", "agent", "investor"], boost: 15 },
  { keywords: ["looking for income", "extra income", "side income", "side hustle"], boost: 20 },
  { keywords: ["looking for work", "job hunting", "between jobs", "unemployed"], boost: 15 },
  { keywords: ["financial freedom", "passive income", "financial independence"], boost: 20 },
  { keywords: ["health", "wellness", "fitness", "nutrition"], boost: 10 },
  { keywords: ["social media", "influencer", "content creator", "online"], boost: 10 },
  { keywords: ["retired", "semi-retired", "free time", "flexible schedule"], boost: 12 },
];

// Involvement keyword → level mapping
const INVOLVEMENT_KEYWORDS: Array<{ keywords: string[]; level: number }> = [
  { keywords: ["full-time", "full time builder", "team leader", "director", "executive"], level: 7 },
  { keywords: ["side hustle", "part-time builder", "recruiting", "building a team", "new distributor"], level: 6 },
  { keywords: ["wholesale", "buys at cost", "distributor price", "business account"], level: 5 },
  { keywords: ["referred", "gave names", "referral source", "sending people"], level: 4 },
  { keywords: ["repeat customer", "orders regularly", "reordered", "second order"], level: 3 },
  { keywords: ["trying", "just started", "new customer", "first order", "sample"], level: 2 },
  { keywords: ["curious", "asking questions", "learning about", "looking into"], level: 1 },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntryPoint = "discovery_pool" | "first_contact" | "nurture" | "just_track";

// Mirrors the lead record shape used by other tools
interface LeadRecord {
  id: string;
  platform: string;
  platformId: string;
  displayName: string;
  profileUrl?: string;
  profileFit: number;
  intentScore: number;
  oar: string;
  primaryOar: string;
  qualified: boolean;
  optedOut: boolean;
  builderScore?: number;
  customerScore?: number;
  intentSignalHistory: Array<{ type: string; excerpt?: string; source?: string }>;
  discoveredAt: string;
  qualifiedAt?: string;
  converted?: boolean;

  // Import-specific fields
  importedAt: string;
  importSource: "manual" | "csv";
  entryPoint: EntryPoint;
  involvementLevel: number;       // 0-7 spectrum
  tenantNotes?: string;
  contactInfo?: {
    phone?: string;
    email?: string;
    telegram?: string;
    whatsapp?: string;
  };
  importBatchId?: string;
}

interface ImportLogEntry {
  batchId: string;
  importedAt: string;
  source: "manual" | "csv";
  contactsImported: number;
  qualifiedCount: number;
  entryPoint: EntryPoint;
  leads: Array<{ id: string; displayName: string; score: number; entryPoint: EntryPoint }>;
}

interface ImportLog {
  entries: ImportLogEntry[];
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

function loadJson<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch { /* fall through */ }
  return null;
}

function saveJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function loadLeads(workdir: string): Record<string, LeadRecord> {
  return loadJson<Record<string, LeadRecord>>(path.join(workdir, "leads.json")) ?? {};
}

function saveLeads(workdir: string, leads: Record<string, LeadRecord>): void {
  saveJson(path.join(workdir, "leads.json"), leads);
}

function appendImportLog(workdir: string, entry: ImportLogEntry): void {
  const p = path.join(workdir, "import_log.json");
  const log = loadJson<ImportLog>(p) ?? { entries: [] };
  log.entries.push(entry);
  saveJson(p, log);
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function inferIntentScore(description: string): number {
  const lower = description.toLowerCase();
  for (const { keywords, score } of INTENT_PHRASE_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) return score;
  }
  return 50; // Default: unknown interest = moderate
}

function inferProfileFit(description: string): number {
  const lower = description.toLowerCase();
  let base = 40; // Warm contact starts with a base advantage over cold discovery
  for (const { keywords, boost } of PROFILE_FIT_SIGNALS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      base = Math.min(95, base + boost);
    }
  }
  return base;
}

function inferInvolvementLevel(description: string): number {
  const lower = description.toLowerCase();
  for (const { keywords, level } of INVOLVEMENT_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return level;
  }
  return 0; // Not yet involved
}

function computeWarmScore(profileFit: number, intentScore: number, oar: "builder" | "customer"): number {
  // Simplified scoring (no engagement yet — Engagement = 0 until contact)
  const weights = oar === "builder"
    ? { profileFit: 0.30, intentSignals: 0.45, engagement: 0.25 }
    : { profileFit: 0.25, intentSignals: 0.50, engagement: 0.25 };
  return Math.min(100, Math.round(
    profileFit * weights.profileFit +
    intentScore * weights.intentSignals +
    0 * weights.engagement
  ));
}

const QUALIFICATION_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// Build lead record from description
// ---------------------------------------------------------------------------

function buildLeadFromDescription(
  name: string,
  description: string,
  entryPoint: EntryPoint,
  oar: "builder" | "customer",
  contactInfo: LeadRecord["contactInfo"],
  batchId: string,
  source: "manual" | "csv"
): LeadRecord {
  const profileFit = inferProfileFit(description);
  const intentScore = inferIntentScore(description);
  const involvementLevel = inferInvolvementLevel(description);
  const compositeScore = computeWarmScore(profileFit, intentScore, oar);
  const qualified = compositeScore >= QUALIFICATION_THRESHOLD;
  const now = new Date().toISOString();

  // Determine platform from contact info
  const platform =
    contactInfo?.telegram ? "telegram" :
    contactInfo?.whatsapp ? "whatsapp" :
    contactInfo?.phone ? "phone" :
    contactInfo?.email ? "email" :
    "imported";

  const platformId = contactInfo?.telegram ?? contactInfo?.whatsapp ?? contactInfo?.phone ?? contactInfo?.email ?? name.toLowerCase().replace(/\s+/g, "_");

  return {
    id: crypto.randomUUID(),
    platform,
    platformId,
    displayName: name,
    profileFit,
    intentScore,
    oar,
    primaryOar: oar,
    qualified,
    optedOut: false,
    builderScore: oar === "builder" ? compositeScore : undefined,
    customerScore: oar === "customer" ? compositeScore : undefined,
    intentSignalHistory: [
      { type: "tenant_description", excerpt: description.slice(0, 200), source: "import" },
    ],
    discoveredAt: now,
    qualifiedAt: qualified ? now : undefined,
    importedAt: now,
    importSource: source,
    entryPoint,
    involvementLevel,
    tenantNotes: description,
    contactInfo,
    importBatchId: batchId,
  };
}

// ---------------------------------------------------------------------------
// Action: add (single warm contact)
// ---------------------------------------------------------------------------

interface AddParams {
  action: "add";
  name: string;
  description: string;
  entryPoint?: EntryPoint;
  oar?: "builder" | "customer";
  phone?: string;
  email?: string;
  telegram?: string;
  whatsapp?: string;
}

function handleAdd(
  params: AddParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const onboard = loadJson<OnboardState>(path.join(workdir, "onboard_state.json"));
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const entryPoint = params.entryPoint ?? "discovery_pool";
  const oar = params.oar ?? "builder";
  const batchId = crypto.randomUUID();

  const contactInfo: LeadRecord["contactInfo"] = {};
  if (params.phone) contactInfo.phone = params.phone;
  if (params.email) contactInfo.email = params.email;
  if (params.telegram) contactInfo.telegram = params.telegram;
  if (params.whatsapp) contactInfo.whatsapp = params.whatsapp;

  const lead = buildLeadFromDescription(
    params.name,
    params.description,
    entryPoint,
    oar,
    contactInfo,
    batchId,
    "manual"
  );

  const leads = loadLeads(workdir);
  leads[lead.id] = lead;
  saveLeads(workdir, leads);

  appendImportLog(workdir, {
    batchId,
    importedAt: new Date().toISOString(),
    source: "manual",
    contactsImported: 1,
    qualifiedCount: lead.qualified ? 1 : 0,
    entryPoint,
    leads: [{ id: lead.id, displayName: lead.displayName, score: lead.builderScore ?? lead.customerScore ?? 0, entryPoint }],
  });

  logger.info("tiger_import: add", {
    leadId: lead.id,
    displayName: lead.displayName,
    profileFit: lead.profileFit,
    intentScore: lead.intentScore,
    qualified: lead.qualified,
    entryPoint,
    involvementLevel: lead.involvementLevel,
  });

  const score = lead.builderScore ?? lead.customerScore ?? 0;
  const qualifiedLabel = lead.qualified ? "✅ QUALIFIED (80+)" : `below threshold (${score})`;

  const nextStepMap: Record<EntryPoint, string> = {
    discovery_pool: "In discovery pool — watching, not contacting.",
    first_contact: `Run tiger_contact queue with leadId: '${lead.id}' to send first outreach.`,
    nurture: `Run tiger_nurture enroll with leadId: '${lead.id}' to start the nurture sequence.`,
    just_track: "Just tracking — you handle this one personally. No automated contact.",
  };

  return {
    ok: true,
    output: [
      `${params.name} imported.`,
      `Profile Fit: ${lead.profileFit} | Intent: ${lead.intentScore} | Score: ${score} — ${qualifiedLabel}`,
      `Involvement level: ${lead.involvementLevel}/7 | Entry point: ${entryPoint}`,
      ``,
      nextStepMap[entryPoint],
    ].join("\n"),
    data: {
      leadId: lead.id,
      displayName: lead.displayName,
      profileFit: lead.profileFit,
      intentScore: lead.intentScore,
      score,
      qualified: lead.qualified,
      involvementLevel: lead.involvementLevel,
      entryPoint,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV parser — minimal, no dependencies
// ---------------------------------------------------------------------------

function parseCsv(csvText: string): Array<Record<string, string>> {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // First line = headers
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split — handles quoted fields with commas
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }

  return rows;
}

// Flexible column name resolution
function resolveColumn(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== "") return row[c];
  }
  return "";
}

// Infer involvement from org status column values
function inferInvolvementFromStatus(status: string): number {
  const lower = status.toLowerCase();
  if (lower.includes("executive") || lower.includes("director") || lower.includes("president")) return 7;
  if (lower.includes("distributor") || lower.includes("builder") || lower.includes("recruit")) return 6;
  if (lower.includes("wholesale") || lower.includes("preferred")) return 5;
  if (lower.includes("active") || lower.includes("repeat")) return 3;
  if (lower.includes("customer") || lower.includes("retail")) return 2;
  if (lower.includes("prospect") || lower.includes("lead") || lower.includes("inquiry")) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Action: csv
// ---------------------------------------------------------------------------

interface CsvParams {
  action: "csv";
  csvText: string;
  entryPoint?: EntryPoint;
  oar?: "builder" | "customer";
  // Optional column name overrides
  nameColumn?: string;
  phoneColumn?: string;
  emailColumn?: string;
  notesColumn?: string;
  statusColumn?: string;
  involvementColumn?: string;
}

function handleCsv(
  params: CsvParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const onboard = loadJson<OnboardState>(path.join(workdir, "onboard_state.json"));
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const rows = parseCsv(params.csvText);
  if (rows.length === 0) {
    return { ok: false, error: "CSV is empty or could not be parsed. Ensure first row is a header." };
  }

  const entryPoint = params.entryPoint ?? "discovery_pool";
  const oar = params.oar ?? "builder";
  const batchId = crypto.randomUUID();
  const leads = loadLeads(workdir);

  const imported: ImportLogEntry["leads"] = [];
  let skipped = 0;

  for (const row of rows) {
    // Resolve name — required
    const name = resolveColumn(row, [
      params.nameColumn ?? "name",
      "full name", "fullname", "full_name",
      "first name", "firstname", "contact name",
    ]);
    if (!name) { skipped++; continue; }

    // Resolve contact info
    const phone = resolveColumn(row, [params.phoneColumn ?? "phone", "phone number", "mobile", "tel"]);
    const email = resolveColumn(row, [params.emailColumn ?? "email", "email address", "e-mail"]);
    const notes = resolveColumn(row, [params.notesColumn ?? "notes", "note", "comments", "remarks", "description"]);
    const status = resolveColumn(row, [params.statusColumn ?? "status", "rank", "title", "level"]);
    const involvementRaw = resolveColumn(row, [params.involvementColumn ?? "involvement", "level", "tier"]);

    // Build description from all available signals
    const descParts: string[] = [];
    if (notes) descParts.push(notes);
    if (status) descParts.push(`Status: ${status}`);
    const description = descParts.join(". ") || `Org contact${status ? ` — ${status}` : ""}`;

    // Involvement: prefer explicit column, then infer from status, then from notes
    const involvementLevel =
      involvementRaw && !isNaN(parseInt(involvementRaw, 10))
        ? Math.min(7, Math.max(0, parseInt(involvementRaw, 10)))
        : status
        ? inferInvolvementFromStatus(status)
        : inferInvolvementLevel(description);

    const contactInfo: LeadRecord["contactInfo"] = {};
    if (phone) contactInfo.phone = phone;
    if (email) contactInfo.email = email;

    const lead = buildLeadFromDescription(name, description, entryPoint, oar, contactInfo, batchId, "csv");
    // Override involvement level with the resolved one
    lead.involvementLevel = involvementLevel;

    leads[lead.id] = lead;
    imported.push({
      id: lead.id,
      displayName: lead.displayName,
      score: lead.builderScore ?? lead.customerScore ?? 0,
      entryPoint,
    });
  }

  saveLeads(workdir, leads);

  const qualifiedCount = imported.filter((l) => l.score >= QUALIFICATION_THRESHOLD).length;

  appendImportLog(workdir, {
    batchId,
    importedAt: new Date().toISOString(),
    source: "csv",
    contactsImported: imported.length,
    qualifiedCount,
    entryPoint,
    leads: imported,
  });

  logger.info("tiger_import: csv", {
    batchId,
    imported: imported.length,
    skipped,
    qualified: qualifiedCount,
    entryPoint,
  });

  const nextStepMap: Record<EntryPoint, string> = {
    discovery_pool: "All contacts in discovery pool — watching, not contacting.",
    first_contact: `Run tiger_contact check to see which are due for first outreach.`,
    nurture: `Enroll qualified contacts in nurture via tiger_nurture enroll.`,
    just_track: "All set to just_track — you handle these personally.",
  };

  return {
    ok: true,
    output: [
      `CSV import complete — batch ${batchId}`,
      `Imported: ${imported.length} | Skipped: ${skipped} | Qualified: ${qualifiedCount}`,
      `Entry point: ${entryPoint}`,
      ``,
      nextStepMap[entryPoint],
      ``,
      `Top contacts:`,
      ...imported
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((l) => `  • ${l.displayName} — score ${l.score}${l.score >= QUALIFICATION_THRESHOLD ? " ✅" : ""}`),
    ].join("\n"),
    data: {
      batchId,
      imported: imported.length,
      skipped,
      qualifiedCount,
      entryPoint,
      leads: imported,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

interface ListParams {
  action: "list";
  entryPoint?: EntryPoint;
  limit?: number;
}

function handleList(params: ListParams, workdir: string): ToolResult {
  const leads = loadLeads(workdir);
  const imported = Object.values(leads)
    .filter((l) => l.importedAt)
    .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));

  const filtered = params.entryPoint
    ? imported.filter((l) => l.entryPoint === params.entryPoint)
    : imported;

  if (filtered.length === 0) {
    return { ok: true, output: "No imported contacts yet.", data: { contacts: [] } };
  }

  const limit = params.limit ?? 20;
  const shown = filtered.slice(0, limit);

  const byEntry: Record<string, number> = {};
  for (const l of imported) {
    byEntry[l.entryPoint ?? "unknown"] = (byEntry[l.entryPoint ?? "unknown"] ?? 0) + 1;
  }

  const lines = [
    `Imported contacts (${imported.length} total):`,
    `  By entry point: ${Object.entries(byEntry).map(([e, n]) => `${e}: ${n}`).join(", ")}`,
    ``,
    `Showing ${shown.length}${params.entryPoint ? ` (${params.entryPoint})` : ""}:`,
    ...shown.map((l) => {
      const score = l.builderScore ?? l.customerScore ?? 0;
      const q = l.qualified ? "✅" : "  ";
      const inv = `inv:${l.involvementLevel}`;
      const ep = l.entryPoint ?? "discovery_pool";
      return `  ${q} ${l.displayName.padEnd(22)} score:${String(score).padStart(3)} ${inv} [${ep}]`;
    }),
  ];

  return {
    ok: true,
    output: lines.join("\n"),
    data: { total: imported.length, byEntry, contacts: shown },
  };
}

// ---------------------------------------------------------------------------
// Action: set_entry_point
// ---------------------------------------------------------------------------

interface SetEntryPointParams {
  action: "set_entry_point";
  leadId: string;
  entryPoint: EntryPoint;
}

function handleSetEntryPoint(
  params: SetEntryPointParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const leads = loadLeads(workdir);
  const lead = leads[params.leadId];
  if (!lead) return { ok: false, error: `Lead ${params.leadId} not found.` };

  const previous = lead.entryPoint ?? "discovery_pool";
  lead.entryPoint = params.entryPoint;
  leads[params.leadId] = lead;
  saveLeads(workdir, leads);

  logger.info("tiger_import: set_entry_point", {
    leadId: params.leadId,
    previous,
    entryPoint: params.entryPoint,
  });

  const nextStepMap: Record<EntryPoint, string> = {
    discovery_pool: "Moved to discovery pool — watching only.",
    first_contact: `Run tiger_contact queue with leadId: '${params.leadId}' to send first outreach.`,
    nurture: `Run tiger_nurture enroll with leadId: '${params.leadId}' to start the sequence.`,
    just_track: "Set to just_track — you handle this one personally.",
  };

  return {
    ok: true,
    output: [
      `${lead.displayName}: entry point changed from '${previous}' to '${params.entryPoint}'.`,
      nextStepMap[params.entryPoint],
    ].join("\n"),
    data: { leadId: params.leadId, previousEntryPoint: previous, entryPoint: params.entryPoint },
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

  logger.info("tiger_import called", { action });

  try {
    switch (action) {
      case "add":
        return handleAdd(params as unknown as AddParams, workdir, logger);

      case "csv":
        return handleCsv(params as unknown as CsvParams, workdir, logger);

      case "list":
        return handleList(params as unknown as ListParams, workdir);

      case "set_entry_point":
        return handleSetEntryPoint(params as unknown as SetEntryPointParams, workdir, logger);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: add | csv | list | set_entry_point`,
        };
    }
  } catch (err) {
    logger.error("tiger_import error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_import error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_import = {
  name: "tiger_import",
  description:
    "Warm contact importer. Two modes. ADD: tenant describes a contact in natural language — 'John Smith, real estate investor, seemed interested, met at Phoenix event'. Profile Fit inferred from description keywords. Intent from assessment phrases ('seemed interested'=60, 'wants to get started'=90). Engagement=0 until contact. CSV: batch import from CSV text (Nu Skin monthly printout etc.) — flexible column mapping, org status auto-maps to involvement level 0-7. Both modes write to leads.json. Four entry points: discovery_pool (watch only), first_contact (auto-outreach via tiger_contact), nurture (pick up sequence via tiger_nurture), just_track (reminder only, tenant handles personally).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "csv", "list", "set_entry_point"],
        description:
          "add: import single warm contact with description. csv: batch import from CSV text. list: show all imported contacts (filterable by entry point). set_entry_point: move a contact to a different entry point.",
      },
      name: {
        type: "string",
        description: "Contact's full name. Required for add.",
      },
      description: {
        type: "string",
        description: "Natural language description of the contact and context. Required for add. Example: 'Met at Phoenix networking event, real estate investor, seemed interested in extra income streams.'",
      },
      entryPoint: {
        type: "string",
        enum: ["discovery_pool", "first_contact", "nurture", "just_track"],
        description:
          "How to handle this contact. discovery_pool: watch, don't contact. first_contact: auto-outreach now. nurture: already talked, pick up sequence. just_track: reminder only, tenant handles personally. Defaults to discovery_pool.",
      },
      oar: {
        type: "string",
        enum: ["builder", "customer"],
        description: "Which oar to score against. Defaults to builder.",
      },
      phone: { type: "string", description: "Phone number for the contact." },
      email: { type: "string", description: "Email address for the contact." },
      telegram: { type: "string", description: "Telegram handle for the contact." },
      whatsapp: { type: "string", description: "WhatsApp number for the contact." },
      csvText: {
        type: "string",
        description: "Full CSV file contents as a string. First row must be headers. Required for csv action.",
      },
      nameColumn: { type: "string", description: "CSV column name for contact name. Auto-detected if omitted." },
      phoneColumn: { type: "string", description: "CSV column name for phone. Auto-detected if omitted." },
      emailColumn: { type: "string", description: "CSV column name for email. Auto-detected if omitted." },
      notesColumn: { type: "string", description: "CSV column name for notes/description. Auto-detected if omitted." },
      statusColumn: { type: "string", description: "CSV column name for org status/rank. Auto-detected if omitted." },
      leadId: {
        type: "string",
        description: "Lead UUID. Required for set_entry_point.",
      },
      limit: {
        type: "number",
        description: "Max contacts to show in list. Defaults to 20.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_import;
