// Tiger Claw — tiger_move Tool
// /move [name] [status] — manually override a contact's status
//
// Valid statuses: new | contacted | nurture | converted | archived | do-not-contact
//
// IMPORTANT RULES:
//   - Moving to "do-not-contact" is PERMANENT and removes them from all active sequences.
//     It mirrors the permanent opt-out in tiger_contact / tiger_nurture.
//   - Any move requires confirmation before executing (two-step: confirm: false → confirm: true).
//   - All other statuses write a "manualStatus" field on the lead record,
//     which tiger_search / tiger_lead / tiger_export read as the authoritative status.
//
// Output in tenant's preferredLanguage.

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_STATUSES = ["new", "contacted", "nurture", "converted", "archived", "do-not-contact"] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeadRecord {
  id: string;
  displayName: string;
  platform: string;
  builderScore: number;
  customerScore: number;
  qualifyingScore: number;
  optedOut: boolean;
  optedOutAt?: string;
  manualStatus?: string;
  notes?: Array<{ text: string; addedAt: string }>;
  [key: string]: unknown;
}

interface NurtureRecord {
  leadId: string;
  status: string;
  [key: string]: unknown;
}

interface ContactRecord {
  leadId: string;
  status: string;
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

async function loadNurture(context: ToolContext): Promise<Record<string, NurtureRecord>> {
  const data = await context.storage.get("nurture.json");
  return data ?? ({} as any);
}

async function saveNurture(context: ToolContext, nurture: Record<string, NurtureRecord>): Promise<void> {
  await context.storage.set("nurture.json", nurture);
}

async function loadContacts(context: ToolContext): Promise<Record<string, ContactRecord>> {
  const data = await context.storage.get("contacts.json");
  return data ?? ({} as any);
}

async function saveContacts(context: ToolContext, contacts: Record<string, ContactRecord>): Promise<void> {
  await context.storage.set("contacts.json", contacts);
}

async function loadSettings(context: ToolContext): Promise<Record<string, unknown>> {
  const data = await context.storage.get("settings.json");
  return data ?? ({} as any);
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

function findLeadByName(leads: Record<string, LeadRecord>, nameQuery: string): LeadRecord[] {
  const q = nameQuery.toLowerCase().trim();
  return Object.values(leads).filter((l) =>
    l.displayName.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Remove from active sequences (for do-not-contact)
// ---------------------------------------------------------------------------

/**
 * When a lead is moved to do-not-contact:
 * 1. Mark lead.optedOut = true, scores → 0 (permanent per spec)
 * 2. Mark any active nurture record as opted_out
 * 3. Mark any active contact record as opted_out
 */
async function removeFromAllSequences(
  context: ToolContext, leadId: string,
  workdir: string,
  logger: ToolContext["logger"]
): Promise<void> {
  // Leads
  const leads = await loadLeads(context);
  const lead = leads[leadId];
  if (lead) {
    lead.optedOut = true;
    lead.optedOutAt = new Date().toISOString();
    // Hard zero scores per spec Block 3
    lead.builderScore = 0;
    lead.customerScore = 0;
    lead.qualifyingScore = 0;
    (lead as Record<string, unknown>)["qualified"] = false;
    leads[leadId] = lead;
    await saveLeads(context, leads);
  }

  // Nurture sequences
  const nurture = await loadNurture(context);
  let nurtureChanged = false;
  for (const [key, n] of Object.entries(nurture)) {
    if (n.leadId === leadId && n.status !== "opted_out") {
      nurture[key]!.status = "opted_out";
      nurtureChanged = true;
    }
  }
  if (nurtureChanged) await saveNurture(context, nurture);

  // Contact records
  const contacts = await loadContacts(context);
  let contactsChanged = false;
  for (const [key, c] of Object.entries(contacts)) {
    if (
      c.leadId === leadId &&
      !["opted_out", "back_to_pool", "nurture"].includes(c.status)
    ) {
      contacts[key]!.status = "opted_out";
      contactsChanged = true;
    }
  }
  if (contactsChanged) await saveContacts(context, contacts);

  logger.info("tiger_move: removed from all sequences", { leadId });
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
  const targetStatus = String(params.status ?? "").trim().toLowerCase() as LeadStatus;
  const confirmed = params.confirm === true;

  if (!nameQuery) {
    return { ok: false, error: "Name required. Usage: /move [name] [status]" };
  }
  if (!targetStatus) {
    return {
      ok: false,
      error: `Status required. Valid: ${VALID_STATUSES.join(" | ")}`,
    };
  }
  if (!VALID_STATUSES.includes(targetStatus)) {
    return {
      ok: false,
      error: `Invalid status "${targetStatus}". Valid: ${VALID_STATUSES.join(" | ")}`,
    };
  }

  logger.info("tiger_move called", { name: nameQuery, status: targetStatus, confirmed });

  const leads = await loadLeads(context);
  const settings = await loadSettings(context);
  const lang = (settings.language as string) ?? "en";
  const isEn = lang !== "th";

  const matches = findLeadByName(leads, nameQuery);

  if (matches.length === 0) {
    const msgEn = `No contact found matching "${nameQuery}". Try /search ${nameQuery} first.`;
    const msgTh = `ไม่พบรายชื่อที่ตรงกับ "${nameQuery}" ลอง /search ${nameQuery} ก่อน`;
    return { ok: false, error: isEn ? msgEn : msgTh };
  }

  if (matches.length > 1) {
    const lines = [
      isEn
        ? `Multiple contacts match "${nameQuery}" — be more specific:`
        : `พบหลายรายชื่อที่ตรงกับ "${nameQuery}" — ระบุชื่อให้ชัดเจนขึ้น:`,
      "",
    ];
    for (const m of matches.slice(0, 8)) {
      lines.push(`  • ${m.displayName}  (${m.platform})`);
    }
    return { ok: false, error: lines.join("\n") };
  }

  const lead = matches[0]!;

  // Already at the target status — nothing to do
  const currentManual = lead.manualStatus ?? (lead.optedOut ? "do-not-contact" : undefined);
  if (currentManual === targetStatus) {
    const msgEn = `${lead.displayName} is already set to "${targetStatus}". No change.`;
    const msgTh = `${lead.displayName} มีสถานะ "${targetStatus}" อยู่แล้ว ไม่มีการเปลี่ยนแปลง`;
    return {
      ok: true,
      output: isEn ? msgEn : msgTh,
      data: { changed: false },
    };
  }

  // ── Confirmation gate ──
  // All moves require explicit confirm: true before executing.
  // This prevents the agent from accidentally moving the wrong contact.
  if (!confirmed) {
    const warningEn =
      targetStatus === "do-not-contact"
        ? `⚠️ PERMANENT ACTION: Moving ${lead.displayName} to do-not-contact will remove them from ALL active sequences and can never be undone.\n\nConfirm with: /move ${lead.displayName} do-not-contact confirm:true`
        : `Move ${lead.displayName} to "${targetStatus}"? This will override their current flywheel status.\n\nConfirm with: /move ${lead.displayName} ${targetStatus} confirm:true`;

    const warningTh =
      targetStatus === "do-not-contact"
        ? `⚠️ การดำเนินการถาวร: การย้าย ${lead.displayName} ไปยัง do-not-contact จะลบพวกเขาออกจากทุกลำดับที่ใช้งานอยู่และไม่สามารถยกเลิกได้\n\nยืนยันด้วย: /move ${lead.displayName} do-not-contact confirm:true`
        : `ย้าย ${lead.displayName} ไปยัง "${targetStatus}"? การดำเนินการนี้จะแทนที่สถานะในระบบปัจจุบัน\n\nยืนยันด้วย: /move ${lead.displayName} ${targetStatus} confirm:true`;

    return {
      ok: true,
      output: isEn ? warningEn : warningTh,
      data: { awaitingConfirmation: true, leadId: lead.id, targetStatus },
    };
  }

  // ── Execute the move ──
  if (targetStatus === "do-not-contact") {
    // Permanent — remove from all sequences and zero out scores
    await removeFromAllSequences(context, lead.id, workdir, logger);

    const msgEn = `${lead.displayName} has been permanently moved to do-not-contact. Removed from all active sequences. Scores zeroed.`;
    const msgTh = `${lead.displayName} ถูกย้ายไปยัง do-not-contact อย่างถาวร ลบออกจากลำดับที่ใช้งานอยู่ทั้งหมด คะแนนถูกรีเซ็ตเป็น 0 แล้ว`;
    return {
      ok: true,
      output: isEn ? msgEn : msgTh,
      data: { changed: true, leadId: lead.id, displayName: lead.displayName, newStatus: "do-not-contact", permanent: true },
    };
  }

  // Non-permanent override — write manualStatus to lead record
  // Reload leads (removeFromAllSequences may have saved in the do-not-contact path)
  const freshLeads = await loadLeads(context);
  const freshLead = freshLeads[lead.id];
  if (!freshLead) {
    return { ok: false, error: `Lead ${lead.id} not found after reload.` };
  }

  const previousStatus = freshLead.manualStatus ?? "automatic";
  freshLead.manualStatus = targetStatus;
  freshLeads[lead.id] = freshLead;
  await saveLeads(context, freshLeads);

  logger.info("tiger_move: status overridden", {
    leadId: lead.id,
    displayName: lead.displayName,
    from: previousStatus,
    to: targetStatus,
  });

  const msgEn = `${lead.displayName} moved to "${targetStatus}". (Previous: ${previousStatus}). Use /move ${lead.displayName} new to reset to automatic tracking.`;
  const msgTh = `${lead.displayName} ถูกย้ายไปยัง "${targetStatus}" แล้ว (ก่อนหน้า: ${previousStatus}) ใช้ /move ${lead.displayName} new เพื่อรีเซ็ตกลับสู่การติดตามอัตโนมัติ`;

  return {
    ok: true,
    output: isEn ? msgEn : msgTh,
    data: {
      changed: true,
      leadId: lead.id,
      displayName: lead.displayName,
      previousStatus,
      newStatus: targetStatus,
      permanent: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export const tiger_move = {
  name: "tiger_move",
  description:
    "Manually override a contact's status. Valid statuses: new | contacted | nurture | converted | archived | do-not-contact. Moving to do-not-contact is PERMANENT — removes from all active sequences and zeroes all scores. All moves require confirmation before executing (confirm: true).",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name or partial name of the contact.",
      },
      status: {
        type: "string",
        enum: ["new", "contacted", "nurture", "converted", "archived", "do-not-contact"],
        description: "Target status. do-not-contact is permanent and irreversible.",
      },
      confirm: {
        type: "boolean",
        description:
          "Must be true to execute the move. If false or absent, the tool returns a confirmation prompt instead of executing. Always get explicit confirmation from the tenant before setting confirm: true.",
      },
    },
    required: ["name", "status"],
  },

  execute,
};

export default tiger_move;
