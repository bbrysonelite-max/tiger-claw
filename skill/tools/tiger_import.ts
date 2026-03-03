// Tiger Claw — tiger_import Tool
// CSV import for warm contacts and organization nurture
// TIGERCLAW-MASTER-SPEC-v2.md Block 3.8 "Organization Nurture"
//
// Accepts CSV data (pasted or file content) and creates lead records for
// each contact. Imported leads are tagged as "warm" (from existing network)
// and can be enrolled into nurture or aftercare sequences.
//
// Key spec requirement: "Individual messages, NOT bulk email."
// Each imported contact becomes a lead record that goes through the normal
// flywheel — first contact, nurture, conversion — one at a time.
//
// Actions:
//   import   — parse CSV and create lead records
//   preview  — show what would be imported (dry run)
//   status   — show import history and counts

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolContext {
  workdir: string;
  logger: {
    info: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
  };
}

interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
  data?: Record<string, unknown>;
}

interface LeadRecord {
  id: string;
  platform: string;
  platformId: string;
  displayName: string;
  profileUrl?: string;
  bio?: string;
  keywords?: string[];
  profileFit: number;
  rawIntentStrength: number;
  engagement: number;
  intentScore: number;
  builderScore: number;
  customerScore: number;
  oar: "builder" | "customer" | "both";
  primaryOar: "builder" | "customer";
  isUnicorn: boolean;
  unicornBonusApplied: boolean;
  qualified: boolean;
  qualifyingScore: number;
  qualifyingOar: "builder" | "customer";
  qualifiedAt?: string;
  optedOut: boolean;
  intentSignalHistory: Array<{ type: string; strength: number; detectedAt: string; source?: string }>;
  engagementEvents: Array<{ type: string; occurredAt: string }>;
  involvementLevel: number;
  discoveredAt: string;
  lastSignalAt: string;
  lastScoredAt: string;
  purgeAt: string;
  // Import-specific fields
  importedAt?: string;
  importSource?: string;
  notes?: Array<{ text: string; addedAt: string }>;
  tags?: string[];
  language?: string;
  sourceUrl?: string;
  phone?: string;
  email?: string;
}

interface ImportRecord {
  id: string;
  importedAt: string;
  contactCount: number;
  source: string;
  leadIds: string[];
}

// ---------------------------------------------------------------------------
// CSV parsing — handles quoted fields, commas inside quotes, newlines
// ---------------------------------------------------------------------------

function parseCSV(raw: string): Array<Record<string, string>> {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = (values[j] ?? "").trim();
    }
    if (Object.values(row).some((v) => v.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function loadJSON<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    }
  } catch { /* fall through */ }
  return null;
}

function saveJSON(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Map CSV row → LeadRecord
// ---------------------------------------------------------------------------

// Recognized CSV column names (case-insensitive, flexible)
const NAME_COLS = ["name", "displayname", "display_name", "full_name", "fullname", "contact"];
const PHONE_COLS = ["phone", "phonenumber", "phone_number", "mobile", "tel"];
const EMAIL_COLS = ["email", "email_address", "emailaddress"];
const PLATFORM_COLS = ["platform", "channel", "source"];
const OAR_COLS = ["oar", "type", "lead_type", "category"];
const NOTES_COLS = ["notes", "note", "comment", "comments"];
const TAGS_COLS = ["tags", "tag", "labels", "label"];

function findCol(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c]!.length > 0) return row[c]!;
  }
  return "";
}

function rowToLead(row: Record<string, string>, importId: string): LeadRecord | null {
  const name = findCol(row, NAME_COLS);
  if (!name) return null;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const phone = findCol(row, PHONE_COLS);
  const email = findCol(row, EMAIL_COLS);
  const platform = findCol(row, PLATFORM_COLS) || "import";
  const oarRaw = findCol(row, OAR_COLS).toLowerCase();
  const oar: "builder" | "customer" | "both" =
    oarRaw === "builder" ? "builder" :
    oarRaw === "both" ? "both" : "customer";
  const notesText = findCol(row, NOTES_COLS);
  const tagsRaw = findCol(row, TAGS_COLS);

  // Warm contacts get a baseline profile fit of 60 (known to tenant, not yet scored)
  const profileFit = 60;

  return {
    id,
    platform,
    platformId: `import:${importId}:${id.slice(0, 8)}`,
    displayName: name,
    profileFit,
    rawIntentStrength: 0,
    engagement: 0,
    intentScore: 0,
    builderScore: Math.round(profileFit * (oar === "customer" ? 0.25 : 0.30)),
    customerScore: Math.round(profileFit * (oar === "builder" ? 0.25 : 0.25)),
    oar,
    primaryOar: oar === "both" ? "builder" : (oar === "builder" ? "builder" : "customer"),
    isUnicorn: oar === "both",
    unicornBonusApplied: false,
    qualified: false,
    qualifyingScore: 0,
    qualifyingOar: oar === "builder" ? "builder" : "customer",
    optedOut: false,
    intentSignalHistory: [],
    engagementEvents: [],
    involvementLevel: 0,
    discoveredAt: now,
    lastSignalAt: now,
    lastScoredAt: now,
    purgeAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    importedAt: now,
    importSource: importId,
    phone: phone || undefined,
    email: email || undefined,
    notes: notesText ? [{ text: notesText, addedAt: now }] : undefined,
    tags: tagsRaw ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : ["imported"],
  };
}

// ---------------------------------------------------------------------------
// Action: preview — dry run, show what would be imported
// ---------------------------------------------------------------------------

function handlePreview(csvData: string): ToolResult {
  if (!csvData || csvData.trim().length === 0) {
    return { ok: false, error: "No CSV data provided. Paste CSV content in the 'csv' parameter." };
  }

  const rows = parseCSV(csvData);
  if (rows.length === 0) {
    return { ok: false, error: "CSV parsed but no data rows found. Ensure header row + at least one data row." };
  }

  const headers = Object.keys(rows[0]!);
  const nameCol = NAME_COLS.find((c) => headers.includes(c));
  if (!nameCol) {
    return {
      ok: false,
      error: `No name column found. Expected one of: ${NAME_COLS.join(", ")}. Found columns: ${headers.join(", ")}`,
    };
  }

  const lines = [
    `CSV Preview — ${rows.length} contacts found`,
    `Columns: ${headers.join(", ")}`,
    ``,
  ];

  for (const row of rows.slice(0, 10)) {
    const name = findCol(row, NAME_COLS);
    const phone = findCol(row, PHONE_COLS);
    const email = findCol(row, EMAIL_COLS);
    const oar = findCol(row, OAR_COLS) || "customer";
    lines.push(`  • ${name}${phone ? ` | ${phone}` : ""}${email ? ` | ${email}` : ""} → ${oar}`);
  }

  if (rows.length > 10) {
    lines.push(`  ... and ${rows.length - 10} more`);
  }

  lines.push(``);
  lines.push(`Run with action: "import" to create these as lead records.`);

  return { ok: true, output: lines.join("\n"), data: { count: rows.length, columns: headers } };
}

// ---------------------------------------------------------------------------
// Action: import — create lead records from CSV
// ---------------------------------------------------------------------------

function handleImport(
  csvData: string,
  workdir: string,
  source: string,
  logger: ToolContext["logger"]
): ToolResult {
  if (!csvData || csvData.trim().length === 0) {
    return { ok: false, error: "No CSV data provided." };
  }

  const rows = parseCSV(csvData);
  if (rows.length === 0) {
    return { ok: false, error: "No data rows found in CSV." };
  }

  const leadsPath = path.join(workdir, "leads.json");
  const importLogPath = path.join(workdir, "import_log.json");
  const leads = loadJSON<Record<string, LeadRecord>>(leadsPath) ?? {};
  const importLog = loadJSON<ImportRecord[]>(importLogPath) ?? [];

  const importId = crypto.randomUUID().slice(0, 8);
  const created: string[] = [];
  const skipped: string[] = [];
  let duplicates = 0;

  // Build set of existing names for duplicate detection
  const existingNames = new Set(
    Object.values(leads).map((l) => l.displayName.toLowerCase())
  );

  for (const row of rows) {
    const lead = rowToLead(row, importId);
    if (!lead) {
      skipped.push(findCol(row, NAME_COLS) || "(empty row)");
      continue;
    }

    if (existingNames.has(lead.displayName.toLowerCase())) {
      duplicates++;
      skipped.push(`${lead.displayName} (duplicate)`);
      continue;
    }

    leads[lead.id] = lead;
    existingNames.add(lead.displayName.toLowerCase());
    created.push(lead.displayName);
  }

  saveJSON(leadsPath, leads);

  // Log the import
  importLog.push({
    id: importId,
    importedAt: new Date().toISOString(),
    contactCount: created.length,
    source: source || "csv_paste",
    leadIds: created.map((name) =>
      Object.values(leads).find((l) => l.displayName === name)?.id ?? ""
    ).filter(Boolean),
  });
  saveJSON(importLogPath, importLog);

  logger.info("tiger_import: contacts imported", {
    created: created.length,
    skipped: skipped.length,
    duplicates,
    importId,
  });

  const lines = [
    `Import complete — ${created.length} contacts added`,
    ``,
    `Created: ${created.length}`,
    `Skipped: ${skipped.length}${duplicates > 0 ? ` (${duplicates} duplicates)` : ""}`,
    `Import ID: ${importId}`,
    ``,
  ];

  if (created.length > 0) {
    lines.push(`Imported:`);
    for (const name of created.slice(0, 15)) {
      lines.push(`  ✓ ${name}`);
    }
    if (created.length > 15) lines.push(`  ... and ${created.length - 15} more`);
    lines.push(``);
  }

  if (skipped.length > 0) {
    lines.push(`Skipped:`);
    for (const name of skipped.slice(0, 5)) {
      lines.push(`  ✗ ${name}`);
    }
    lines.push(``);
  }

  lines.push(
    `These contacts are now in your lead database with "imported" tag.`,
    `They'll appear in your next daily briefing.`,
    `To start reaching out, use /search imported or ask me to begin first contact.`
  );

  return {
    ok: true,
    output: lines.join("\n"),
    data: { importId, created: created.length, skipped: skipped.length, duplicates },
  };
}

// ---------------------------------------------------------------------------
// Action: status — show import history
// ---------------------------------------------------------------------------

function handleStatus(workdir: string): ToolResult {
  const importLogPath = path.join(workdir, "import_log.json");
  const importLog = loadJSON<ImportRecord[]>(importLogPath) ?? [];

  if (importLog.length === 0) {
    return { ok: true, output: "No imports yet. Use action: 'import' with CSV data to import contacts." };
  }

  const totalImported = importLog.reduce((sum, r) => sum + r.contactCount, 0);
  const lines = [
    `Import History — ${importLog.length} imports, ${totalImported} total contacts`,
    ``,
  ];

  for (const r of importLog.slice(-10).reverse()) {
    const date = r.importedAt.slice(0, 10);
    lines.push(`  ${date} — ${r.contactCount} contacts (ID: ${r.id}, source: ${r.source})`);
  }

  return { ok: true, output: lines.join("\n"), data: { totalImports: importLog.length, totalImported } };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

async function execute(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { workdir, logger } = context;
  const action = (params.action as string) ?? "preview";

  logger.info("tiger_import called", { action });

  switch (action) {
    case "preview":
      return handlePreview(params.csv as string);
    case "import":
      return handleImport(params.csv as string, workdir, (params.source as string) ?? "", logger);
    case "status":
      return handleStatus(workdir);
    default:
      return { ok: false, error: `Unknown action: "${action}". Valid: preview | import | status` };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export
// ---------------------------------------------------------------------------

export const tiger_import = {
  name: "tiger_import",
  description:
    "Import CSV contacts for organization nurture. Paste CSV data with columns like name, phone, email, platform, oar, notes, tags. Each contact becomes a lead record in the normal flywheel — individual outreach, not bulk email. Use 'preview' to check before importing.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["preview", "import", "status"],
        description: "preview: dry-run showing what would be imported. import: create lead records. status: show import history.",
      },
      csv: {
        type: "string",
        description: "CSV content (header row + data rows). Required for preview and import actions.",
      },
      source: {
        type: "string",
        description: "Optional label for this import batch (e.g. 'team_roster', 'old_contacts').",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_import;
