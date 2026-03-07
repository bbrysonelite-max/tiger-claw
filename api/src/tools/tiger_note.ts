// Tiger Claw — tiger_note Tool
// /note [name] [text] — add a freeform note to a contact
//
// Notes are timestamped and stored on the lead record in leads.json.
// They appear in the /lead detail view under "NOTES".
//
// Examples:
//   /note John Smith  Met at coffee shop on Thursday
//   /note Sarah  Spouse is interested too — follow up with both
//
// Output in tenant's preferredLanguage.

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NoteEntry {
  text: string;
  addedAt: string; // ISO timestamp
}

interface LeadRecord {
  id: string;
  displayName: string;
  platform: string;
  builderScore: number;
  customerScore: number;
  qualifyingScore: number;
  optedOut: boolean;
  notes?: NoteEntry[];
  // Allow any additional fields we don't care about
  [key: string]: unknown;
}

interface ToolContext {
  workdir: string;
  config: Record<string, unknown>;
  logger: {
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
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadLeads(context: ToolContext): Promise<Record<string, LeadRecord>> {
  const data = await context.storage.get("leads.json");
  return data ?? ({} as any);
}

async function saveLeads(context: ToolContext, leads: Record<string, LeadRecord>): Promise<void> {
  await context.storage.set("leads.json", leads);
}

async function loadSettings(context: ToolContext): Promise<Record<string, unknown>> {
  const data = await context.storage.get("settings.json");
  return data ?? ({} as any);
}

// ---------------------------------------------------------------------------
// Name matching (same fuzzy approach as tiger_lead)
// ---------------------------------------------------------------------------

function findLeadByName(leads: Record<string, LeadRecord>, nameQuery: string): LeadRecord[] {
  const q = nameQuery.toLowerCase().trim();
  return Object.values(leads).filter((l) =>
    l.displayName.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

async function execute(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { workdir, logger } = context;
  const nameQuery = String(params.name ?? "").trim();
  const noteText = String(params.note ?? "").trim();

  if (!nameQuery) {
    return { ok: false, error: "Name required. Usage: /note [name] [text]" };
  }
  if (!noteText) {
    return { ok: false, error: "Note text required. Usage: /note [name] [text]" };
  }

  logger.info("tiger_note called", { name: nameQuery, noteLength: noteText.length });

  const leads = await loadLeads(context);
  const settings = await loadSettings(context);
  const lang = (settings.language as string) ?? "en";

  const matches = findLeadByName(leads, nameQuery);

  if (matches.length === 0) {
    const msgEn = `No contact found matching "${nameQuery}". Try /search ${nameQuery} first.`;
    const msgTh = `ไม่พบรายชื่อที่ตรงกับ "${nameQuery}" ลอง /search ${nameQuery} ก่อน`;
    return {
      ok: false,
      error: lang === "th" ? msgTh : msgEn,
    };
  }

  if (matches.length > 1) {
    const lines = [
      lang === "th"
        ? `พบหลายรายชื่อที่ตรงกับ "${nameQuery}" — ระบุชื่อให้ชัดเจนขึ้น:`
        : `Multiple contacts match "${nameQuery}" — be more specific:`,
      "",
    ];
    for (const m of matches.slice(0, 8)) {
      lines.push(`  • ${m.displayName}  (${m.platform})`);
    }
    return {
      ok: false,
      error: lines.join("\n"),
    };
  }

  const lead = matches[0]!;

  // Append the note
  if (!lead.notes) lead.notes = [];
  const entry: NoteEntry = {
    text: noteText,
    addedAt: new Date().toISOString(),
  };
  lead.notes.push(entry);
  leads[lead.id] = lead;
  await saveLeads(context, leads);

  logger.info("tiger_note: note added", { leadId: lead.id, displayName: lead.displayName });

  const totalNotes = lead.notes.length;
  const msgEn = `Note added to ${lead.displayName} (${totalNotes} note${totalNotes !== 1 ? "s" : ""} total). Use /lead ${lead.displayName} to view.`;
  const msgTh = `เพิ่มบันทึกสำหรับ ${lead.displayName} แล้ว (รวม ${totalNotes} บันทึก) ใช้ /lead ${lead.displayName} เพื่อดูรายละเอียด`;

  return {
    ok: true,
    output: lang === "th" ? msgTh : msgEn,
    data: {
      leadId: lead.id,
      displayName: lead.displayName,
      noteAdded: entry,
      totalNotes,
    },
  };
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_note = {
  name: "tiger_note",
  description:
    "Add a freeform timestamped note to a contact. Notes appear in the /lead detail view. Examples: /note John Smith  Met at coffee shop  — /note Sarah  Spouse is also interested. Notes are stored permanently on the contact record.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name or partial name of the contact to add the note to.",
      },
      note: {
        type: "string",
        description: "The note text to attach. Plain text. No length limit.",
      },
    },
    required: ["name", "note"],
  },

  execute,
};

export default tiger_note;
