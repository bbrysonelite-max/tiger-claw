// Tiger Claw — tiger_export Tool
// /export — generates CSV of all contacts and sends as file attachment
//
// Usage:
//   /export               — all contacts
//   /export converted     — only converted contacts
//   /export nurture       — only contacts currently in nurture
//
// Columns: name, score, status, involvement_level, oar, source, source_url,
//          language, first_contact_date, last_touch_date, converted_date, notes
//
// CSV is UTF-8 with BOM (\uFEFF) for Excel compatibility with Thai characters.
// Returns the CSV as a file attachment (output.file).

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeadRecord {
  id: string;
  platform: string;
  displayName: string;
  profileUrl?: string;
  bio?: string;
  builderScore: number;
  customerScore: number;
  qualifyingScore: number;
  oar: string;
  primaryOar: string;
  optedOut: boolean;
  discoveredAt: string;
  manualStatus?: string;
  notes?: Array<{ text: string; addedAt: string }>;
  language?: string;
  sourceUrl?: string;
  involvementLevel?: number;
}

interface NurtureRecord {
  leadId: string;
  status: string;
  enrolledAt?: string;
  lastTouchSentAt?: string;
  convertedAt?: string;
  involvementLevel: number;
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
  // OpenClaw file attachment: { filename, content (base64 or utf8), mimeType }
  file?: { filename: string; content: string; mimeType: string; encoding: string };
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
// Status derivation (same logic as tiger_search / tiger_lead)
// ---------------------------------------------------------------------------

function deriveStatus(
  lead: LeadRecord,
  contactsByLead: Record<string, ContactRecord[]>,
  nurtureByLead: Record<string, NurtureRecord>
): string {
  if (lead.manualStatus) return lead.manualStatus;
  if (lead.optedOut) return "do-not-contact";

  const nurture = nurtureByLead[lead.id];
  if (nurture) {
    if (nurture.status === "converted") return "converted";
    if (nurture.status === "archived") return "archived";
    if (nurture.status === "opted_out") return "do-not-contact";
    if (["active", "accelerated", "gap_closing", "slow_drip"].includes(nurture.status)) return "nurture";
    if (nurture.status === "back_to_pool") return "new";
  }

  const contacts = (contactsByLead[lead.id] ?? []).sort((a, b) =>
    (b.queuedAt ?? "").localeCompare(a.queuedAt ?? "")
  );
  const latest = contacts[0];
  if (latest) {
    if (latest.status === "opted_out") return "do-not-contact";
    if (latest.status === "nurture") return "nurture";
    if (["sent", "follow_up_scheduled", "follow_up_sent", "scheduled", "pending_approval"].includes(latest.status)) {
      return "contacted";
    }
  }
  return "new";
}

function deriveFirstContactDate(
  leadId: string,
  contactsByLead: Record<string, ContactRecord[]>
): string {
  const contacts = contactsByLead[leadId] ?? [];
  const sentDates = contacts
    .map((c) => c.sentAt)
    .filter(Boolean) as string[];
  if (sentDates.length === 0) return "";
  return sentDates.sort()[0]!.slice(0, 10);
}

function deriveLastTouchDate(
  leadId: string,
  contactsByLead: Record<string, ContactRecord[]>,
  nurtureByLead: Record<string, NurtureRecord>
): string {
  const dates: string[] = [];
  for (const c of contactsByLead[leadId] ?? []) {
    if (c.followUpSentAt) dates.push(c.followUpSentAt);
    if (c.sentAt) dates.push(c.sentAt);
  }
  const nurture = nurtureByLead[leadId];
  if (nurture?.lastTouchSentAt) dates.push(nurture.lastTouchSentAt);
  if (dates.length === 0) return "";
  return dates.sort().reverse()[0]!.slice(0, 10);
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/**
 * Escape a value for CSV:
 *   - Wrap in double quotes if it contains comma, newline, or double quote
 *   - Escape any embedded double quotes by doubling them
 */
function csvCell(value: string | number | undefined | null): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | number | undefined | null)[]): string {
  return cells.map(csvCell).join(",");
}

// ---------------------------------------------------------------------------
// Build CSV
// ---------------------------------------------------------------------------

interface CsvRow {
  name: string;
  score: string;
  status: string;
  involvement_level: string;
  oar: string;
  source: string;
  source_url: string;
  language: string;
  first_contact_date: string;
  last_touch_date: string;
  converted_date: string;
  notes: string;
}

const CSV_COLUMNS: (keyof CsvRow)[] = [
  "name",
  "score",
  "status",
  "involvement_level",
  "oar",
  "source",
  "source_url",
  "language",
  "first_contact_date",
  "last_touch_date",
  "converted_date",
  "notes",
];

function buildCsv(rows: CsvRow[]): string {
  const header = csvRow(CSV_COLUMNS);
  const dataRows = rows.map((r) => csvRow(CSV_COLUMNS.map((col) => r[col])));
  // UTF-8 BOM + header + data
  return "\uFEFF" + [header, ...dataRows].join("\r\n");
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

async function execute(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { workdir, logger } = context;
  const filterRaw = String(params.filter ?? "").trim().toLowerCase();
  // Valid filter values: "" (all), "converted", "nurture"
  const validFilters = ["", "converted", "nurture", "new", "contacted", "archived", "do-not-contact"];
  const filter = validFilters.includes(filterRaw) ? filterRaw : "";

  logger.info("tiger_export called", { filter });

  const leads = loadLeads(workdir);
  const allContacts = loadContacts(workdir);
  const allNurture = loadNurture(workdir);
  const settings = loadSettings(workdir);
  const lang = (settings.language as string) ?? "en";

  // Index by leadId
  const contactsByLead: Record<string, ContactRecord[]> = {};
  for (const c of Object.values(allContacts)) {
    if (!contactsByLead[c.leadId]) contactsByLead[c.leadId] = [];
    contactsByLead[c.leadId]!.push(c);
  }

  const nurtureByLead: Record<string, NurtureRecord> = {};
  for (const n of Object.values(allNurture)) {
    nurtureByLead[n.leadId] = n;
  }

  // Build rows
  const rows: CsvRow[] = [];

  for (const lead of Object.values(leads)) {
    const status = deriveStatus(lead, contactsByLead, nurtureByLead);

    // Apply status filter
    if (filter && status !== filter) continue;

    const nurture = nurtureByLead[lead.id];
    const topScore = Math.max(lead.builderScore ?? 0, lead.customerScore ?? 0, lead.qualifyingScore ?? 0);
    const oarLabel = lead.oar === "both" ? "builder+customer" : lead.oar;

    const notesText = (lead.notes ?? [])
      .map((n) => `[${n.addedAt.slice(0, 10)}] ${n.text}`)
      .join(" | ");

    rows.push({
      name: lead.displayName,
      score: String(Math.round(topScore)),
      status,
      involvement_level: String(nurture?.involvementLevel ?? 0),
      oar: oarLabel,
      source: lead.platform,
      source_url: lead.profileUrl ?? lead.sourceUrl ?? "",
      language: lead.language ?? "",
      first_contact_date: deriveFirstContactDate(lead.id, contactsByLead),
      last_touch_date: deriveLastTouchDate(lead.id, contactsByLead, nurtureByLead),
      converted_date: nurture?.convertedAt?.slice(0, 10) ?? "",
      notes: notesText,
    });
  }

  // Sort: converted first, then nurture, then by score descending
  const statusOrder: Record<string, number> = {
    converted: 0, nurture: 1, contacted: 2, new: 3, archived: 4, "do-not-contact": 5,
  };
  rows.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 9;
    const sb = statusOrder[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return Number(b.score) - Number(a.score);
  });

  if (rows.length === 0) {
    const msgEn = filter
      ? `No contacts with status "${filter}" to export.`
      : "No contacts to export yet.";
    const msgTh = filter
      ? `ไม่มีรายชื่อที่มีสถานะ "${filter}" สำหรับส่งออก`
      : "ยังไม่มีรายชื่อที่จะส่งออก";
    return {
      ok: true,
      output: lang === "th" ? msgTh : msgEn,
      data: { rowCount: 0 },
    };
  }

  const csvContent = buildCsv(rows);
  const today = new Date().toISOString().slice(0, 10);
  const suffix = filter ? `-${filter}` : "";
  const filename = `tiger-claw-contacts${suffix}-${today}.csv`;

  // Write to workdir for the channel layer to pick up as an attachment
  const outPath = path.join(workdir, filename);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(outPath, csvContent, "utf8");

  const msgEn = `Exported ${rows.length} contact${rows.length !== 1 ? "s" : ""}${filter ? ` (status: ${filter})` : ""} → ${filename}`;
  const msgTh = `ส่งออก ${rows.length} รายชื่อ${filter ? ` (สถานะ: ${filter})` : ""} → ${filename}`;

  return {
    ok: true,
    output: lang === "th" ? msgTh : msgEn,
    data: {
      rowCount: rows.length,
      filename,
      filePath: outPath,
      filter: filter || "all",
    },
    file: {
      filename,
      content: csvContent,
      mimeType: "text/csv",
      encoding: "utf8",
    },
  };
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_export = {
  name: "tiger_export",
  description:
    "Export all contacts as a CSV file attachment. UTF-8 with BOM for Excel compatibility with Thai characters. Columns: name, score, status, involvement_level, oar, source, source_url, language, first_contact_date, last_touch_date, converted_date, notes. Supports status filters: /export converted  /export nurture  /export new  etc.",

  parameters: {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: ["", "new", "contacted", "nurture", "converted", "archived", "do-not-contact"],
        description:
          "Optional status filter. Leave empty for all contacts. Values: new | contacted | nurture | converted | archived | do-not-contact",
      },
    },
    required: [],
  },

  execute,
};

export default tiger_export;
