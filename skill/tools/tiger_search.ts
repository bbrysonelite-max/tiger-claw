// Tiger Claw — tiger_search Tool
// /search [keyword] — tenant-facing contact search — Block 3 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Usage:
//   /search john                — full-text search across name, bio, keywords, source, tags
//   /search status:nurture      — filter by lead status
//   /search score:90+           — filter by composite score >= 90
//   /search score:70-85         — filter by score range
//   /search status:nurture john — combine filter + keyword
//
// Returns top 10 matches with: name, score, status, last touch date.
// Output in tenant's preferredLanguage.

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types (minimal — reads from leads.json, contacts.json, nurture.json)
// ---------------------------------------------------------------------------

interface LeadRecord {
  id: string;
  platform: string;
  displayName: string;
  profileUrl?: string;
  bio?: string;
  keywords?: string[];
  profileFit: number;
  intentScore: number;
  engagement: number;
  builderScore: number;
  customerScore: number;
  oar: string;
  primaryOar: string;
  isUnicorn: boolean;
  qualified: boolean;
  qualifyingScore: number;
  optedOut: boolean;
  discoveredAt: string;
  // Extended fields set by tiger_note / tiger_move / tiger_scout
  manualStatus?: string;
  notes?: Array<{ text: string; addedAt: string }>;
  language?: string;
  sourceUrl?: string;
  tags?: string[];
}

interface NurtureRecord {
  leadId: string;
  status: string;
  lastTouchSentAt?: string;
  convertedAt?: string;
}

interface ContactRecord {
  leadId: string;
  status: string;
  sentAt?: string;
  followUpSentAt?: string;
  queuedAt: string;
}

interface ToolContext {
  workdir: string;
  config: Record<string, unknown>;
  logger: {
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
// Persistence helpers
// ---------------------------------------------------------------------------

function loadLeads(workdir: string): Record<string, LeadRecord> {
  const p = path.join(workdir, "leads.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through */ }
  return {};
}

function loadNurture(workdir: string): Record<string, NurtureRecord> {
  const p = path.join(workdir, "nurture.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through */ }
  return {};
}

function loadContacts(workdir: string): Record<string, ContactRecord> {
  const p = path.join(workdir, "contacts.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through */ }
  return {};
}

function loadSettings(workdir: string): Record<string, unknown> {
  const p = path.join(workdir, "settings.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through */ }
  return {};
}

// ---------------------------------------------------------------------------
// Status derivation — single source of truth for display status
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable status for a lead.
 * Priority: manualStatus → optedOut → nurtureStatus → contactStatus → qualified/new
 */
export function deriveStatus(
  lead: LeadRecord,
  contactsByLead: Record<string, ContactRecord[]>,
  nurtureByLead: Record<string, NurtureRecord>
): string {
  // Manual override wins
  if (lead.manualStatus) return lead.manualStatus;

  // Permanent opt-out
  if (lead.optedOut) return "do-not-contact";

  // Check nurture first (more advanced stage)
  const nurture = nurtureByLead[lead.id];
  if (nurture) {
    if (nurture.status === "converted") return "converted";
    if (nurture.status === "archived") return "archived";
    if (nurture.status === "opted_out") return "do-not-contact";
    if (["active", "accelerated", "gap_closing", "slow_drip"].includes(nurture.status)) return "nurture";
    if (nurture.status === "back_to_pool") return "new";
  }

  // Check contact record
  const contacts = contactsByLead[lead.id] ?? [];
  const latestContact = contacts.sort((a, b) =>
    (b.queuedAt ?? "").localeCompare(a.queuedAt ?? "")
  )[0];

  if (latestContact) {
    if (latestContact.status === "opted_out") return "do-not-contact";
    if (latestContact.status === "nurture") return "nurture";
    if (["sent", "follow_up_scheduled", "follow_up_sent", "scheduled", "pending_approval"].includes(
      latestContact.status
    )) return "contacted";
  }

  return "new";
}

/**
 * Get the most recent touch date across contacts and nurture sequences.
 */
export function deriveLastTouchDate(
  leadId: string,
  contactsByLead: Record<string, ContactRecord[]>,
  nurtureByLead: Record<string, NurtureRecord>
): string | undefined {
  const dates: string[] = [];

  const contacts = contactsByLead[leadId] ?? [];
  for (const c of contacts) {
    if (c.followUpSentAt) dates.push(c.followUpSentAt);
    if (c.sentAt) dates.push(c.sentAt);
  }

  const nurture = nurtureByLead[leadId];
  if (nurture?.lastTouchSentAt) dates.push(nurture.lastTouchSentAt);

  if (dates.length === 0) return undefined;
  return dates.sort().reverse()[0]; // Most recent ISO date
}

// ---------------------------------------------------------------------------
// Query parser — parses "/search status:nurture score:90+ john"
// ---------------------------------------------------------------------------

interface ParsedQuery {
  statusFilter?: string;
  scoreMin?: number;
  scoreMax?: number;
  keyword?: string;
}

function parseQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {};
  let remaining = query.trim();

  // Extract status: filter
  const statusMatch = remaining.match(/\bstatus:(\S+)/i);
  if (statusMatch) {
    result.statusFilter = statusMatch[1]!.toLowerCase();
    remaining = remaining.replace(statusMatch[0], "").trim();
  }

  // Extract score: filter — formats: score:90+  score:80  score:70-85
  const scoreMatch = remaining.match(/\bscore:(\d+)(-(\d+)|\+)?/i);
  if (scoreMatch) {
    const base = parseInt(scoreMatch[1]!, 10);
    if (scoreMatch[2] === "+") {
      result.scoreMin = base;
    } else if (scoreMatch[3]) {
      result.scoreMin = base;
      result.scoreMax = parseInt(scoreMatch[3], 10);
    } else {
      // Exact score — treat as ±5 range
      result.scoreMin = base - 5;
      result.scoreMax = base + 5;
    }
    remaining = remaining.replace(scoreMatch[0], "").trim();
  }

  // Remaining text is the keyword
  const kw = remaining.trim();
  if (kw) result.keyword = kw.toLowerCase();

  return result;
}

// ---------------------------------------------------------------------------
// Search matcher
// ---------------------------------------------------------------------------

function matchesKeyword(lead: LeadRecord, keyword: string): boolean {
  const haystack = [
    lead.displayName,
    lead.bio ?? "",
    lead.platform,
    lead.profileUrl ?? "",
    lead.sourceUrl ?? "",
    lead.language ?? "",
    ...(lead.keywords ?? []),
    ...(lead.tags ?? []),
    ...(lead.notes ?? []).map((n) => n.text),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(keyword);
}

// ---------------------------------------------------------------------------
// Format output row
// ---------------------------------------------------------------------------

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10); // YYYY-MM-DD
}

function scoreLabel(lead: LeadRecord): string {
  const score = Math.max(lead.builderScore ?? 0, lead.customerScore ?? 0, lead.qualifyingScore ?? 0);
  return score > 0 ? String(Math.round(score)) : "—";
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

async function execute(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { workdir, logger } = context;
  const query = String(params.query ?? "").trim();

  if (!query) {
    return {
      ok: false,
      error: "Query required. Try: /search john  or  /search status:nurture  or  /search score:90+",
    };
  }

  logger.info("tiger_search called", { query });

  const parsed = parseQuery(query);
  const leads = loadLeads(workdir);
  const allContacts = loadContacts(workdir);
  const allNurture = loadNurture(workdir);
  const settings = loadSettings(workdir);
  const lang = (settings.preferredLanguage as string) ?? "en";

  // Index contacts and nurture by leadId for O(1) lookup
  const contactsByLead: Record<string, ContactRecord[]> = {};
  for (const c of Object.values(allContacts)) {
    if (!contactsByLead[c.leadId]) contactsByLead[c.leadId] = [];
    contactsByLead[c.leadId]!.push(c);
  }

  const nurtureByLead: Record<string, NurtureRecord> = {};
  for (const n of Object.values(allNurture)) {
    nurtureByLead[n.leadId] = n;
  }

  // Filter leads
  let results = Object.values(leads).filter((lead) => {
    // Score filter
    const topScore = Math.max(
      lead.builderScore ?? 0,
      lead.customerScore ?? 0,
      lead.qualifyingScore ?? 0
    );
    if (parsed.scoreMin !== undefined && topScore < parsed.scoreMin) return false;
    if (parsed.scoreMax !== undefined && topScore > parsed.scoreMax) return false;

    // Status filter
    if (parsed.statusFilter) {
      const status = deriveStatus(lead, contactsByLead, nurtureByLead);
      if (status !== parsed.statusFilter) return false;
    }

    // Keyword filter
    if (parsed.keyword && !matchesKeyword(lead, parsed.keyword)) return false;

    return true;
  });

  // Sort: qualified first, then by score descending
  results = results.sort((a, b) => {
    const sa = Math.max(a.builderScore ?? 0, a.customerScore ?? 0, a.qualifyingScore ?? 0);
    const sb = Math.max(b.builderScore ?? 0, b.customerScore ?? 0, b.qualifyingScore ?? 0);
    return sb - sa;
  });

  const total = results.length;
  results = results.slice(0, 10);

  if (results.length === 0) {
    const msgEn = `No contacts found for: "${query}"`;
    const msgTh = `ไม่พบรายชื่อที่ตรงกับ: "${query}"`;
    return {
      ok: true,
      output: lang === "th" ? msgTh : msgEn,
      data: { total: 0, results: [] },
    };
  }

  // Build output lines
  const headerEn = `Found ${total} contact${total !== 1 ? "s" : ""}${total > 10 ? " — showing top 10" : ""}:`;
  const headerTh = `พบ ${total} รายชื่อ${total > 10 ? " — แสดง 10 อันดับแรก" : ""}:`;
  const lines: string[] = [lang === "th" ? headerTh : headerEn, ""];

  for (const lead of results) {
    const status = deriveStatus(lead, contactsByLead, nurtureByLead);
    const lastTouch = deriveLastTouchDate(lead.id, contactsByLead, nurtureByLead);
    const score = scoreLabel(lead);

    lines.push(
      `• ${lead.displayName}  |  Score: ${score}  |  Status: ${status}  |  Last touch: ${formatDate(lastTouch)}`
    );
  }

  lines.push("");
  const tipEn = `Use /lead [name] for full detail on any contact.`;
  const tipTh = `ใช้ /lead [ชื่อ] เพื่อดูรายละเอียดเต็มของแต่ละรายชื่อ`;
  lines.push(lang === "th" ? tipTh : tipEn);

  return {
    ok: true,
    output: lines.join("\n"),
    data: {
      total,
      showing: results.length,
      results: results.map((lead) => ({
        id: lead.id,
        displayName: lead.displayName,
        score: scoreLabel(lead),
        status: deriveStatus(lead, contactsByLead, nurtureByLead),
        lastTouchDate: deriveLastTouchDate(lead.id, contactsByLead, nurtureByLead),
        platform: lead.platform,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_search = {
  name: "tiger_search",
  description:
    "Search contacts by name, keyword, status, or score. Examples: /search john — /search status:nurture — /search score:90+ — /search status:contacted sarah. Returns top 10 matches with name, score, status, and last touch date. Output in tenant's preferredLanguage.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query. Supports plain keywords and filters: status:new|contacted|nurture|converted|archived|do-not-contact, score:80+ or score:70-85. Examples: 'john', 'status:nurture', 'score:90+ bangkok', 'status:contacted sarah'.",
      },
    },
    required: ["query"],
  },

  execute,
};

export default tiger_search;
