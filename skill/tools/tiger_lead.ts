// Tiger Claw — tiger_lead Tool
// /lead [name] — full contact detail view — Block 3 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Shows:
//   - Score breakdown: profileFit, intentScore, engagement + computed builder/customer scores
//   - Current status and involvement level
//   - Every nurture touch: type, scheduled date, sent date, response
//   - All notes (from tiger_note)
//   - Source, source URL, detected language
//   - OAR assignment (business builder / customer / both)
//   - Unicorn bonus flag
//
// Output in tenant's preferredLanguage.

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeadRecord {
  id: string;
  platform: string;
  platformId?: string;
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
  oar: string;
  primaryOar: string;
  isUnicorn: boolean;
  unicornBonusApplied: boolean;
  qualified: boolean;
  qualifyingScore: number;
  qualifyingOar: string;
  qualifiedAt?: string;
  optedOut: boolean;
  optedOutAt?: string;
  discoveredAt: string;
  lastSignalAt: string;
  intentSignalHistory: Array<{
    type: string;
    strength: number;
    detectedAt: string;
    source?: string;
    excerpt?: string;
  }>;
  engagementEvents: Array<{ type: string; occurredAt: string }>;
  // Extended fields (set by tiger_note / tiger_move / tiger_scout)
  manualStatus?: string;
  notes?: Array<{ text: string; addedAt: string }>;
  language?: string;
  sourceUrl?: string;
  tags?: string[];
  needsRecalculate?: boolean;
}

interface NurtureTouchRecord {
  touchNumber: number;
  touchType: string;
  scheduledFor: string;
  sentAt?: string;
  response?: string;
  responseAt?: string;
  responseScore?: number; // 1-10 framework response
  gapClosingRound?: number;
}

interface NurtureRecord {
  leadId: string;
  leadDisplayName: string;
  status: string;
  enrolledAt: string;
  lastTouchSentAt?: string;
  convertedAt?: string;
  involvementLevel: number;
  touches: NurtureTouchRecord[];
  gapClosingRounds?: number;
  slowDripCount?: number;
}

interface ContactRecord {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  strategy: string;
  oar: string;
  messageText: string;
  followUpText?: string;
  status: string;
  scheduledFor: string;
  sentAt?: string;
  responseType?: string;
  responseAt?: string;
  followUpScheduledFor?: string;
  followUpSentAt?: string;
  postExcerpt?: string;
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
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

// Fuzzy name match: find a lead whose displayName contains the query (case-insensitive)
function findLeadByName(leads: Record<string, LeadRecord>, nameQuery: string): LeadRecord[] {
  const q = nameQuery.toLowerCase().trim();
  return Object.values(leads).filter((l) =>
    l.displayName.toLowerCase().includes(q)
  );
}

// Derive status label (same logic as tiger_search for consistency)
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

function involvementLabel(level: number): string {
  const labels: Record<number, string> = {
    0: "Prospect",
    1: "Engaged",
    2: "Customer",
    3: "Repeat customer",
    4: "Referral source",
    5: "Wholesale buyer",
    6: "Side hustle builder",
    7: "Full-time builder",
  };
  return labels[level] ?? `Level ${level}`;
}

function touchTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    value_drop: "Value drop",
    testimonial: "Testimonial",
    authority_transfer: "Authority transfer",
    personal_checkin: "Personal check-in",
    one_to_ten_part1: "1-10 Part 1",
    one_to_ten_part2: "1-10 Part 2",
    gap_closing: "Gap closing",
    scarcity_takeaway: "Scarcity/Takeaway",
    pattern_interrupt: "Pattern Interrupt",
    slow_drip_value: "Slow drip",
  };
  return labels[type] ?? type;
}

// ---------------------------------------------------------------------------
// Build the detail view
// ---------------------------------------------------------------------------

function buildDetailView(
  lead: LeadRecord,
  contacts: ContactRecord[],
  nurture: NurtureRecord | undefined,
  lang: string
): string {
  const lines: string[] = [];
  const isEn = lang !== "th";

  // ── Header ──
  lines.push(`━━━ ${lead.displayName} ━━━`);
  lines.push("");

  // ── Score breakdown ──
  const scoreHeader = isEn ? "SCORE BREAKDOWN" : "คะแนน";
  lines.push(`[ ${scoreHeader} ]`);
  lines.push(`  Profile Fit:   ${lead.profileFit ?? 0}`);
  lines.push(`  Intent:        ${lead.intentScore ?? 0}`);
  lines.push(`  Engagement:    ${lead.engagement ?? 0}`);
  lines.push(`  Builder score: ${Math.round(lead.builderScore ?? 0)}${lead.unicornBonusApplied ? " (+15 Unicorn)" : ""}`);
  lines.push(`  Customer score:${Math.round(lead.customerScore ?? 0)}`);
  lines.push(`  Qualified:     ${lead.qualified ? "YES ✓" : "No"}`);
  if (lead.qualifiedAt) lines.push(`  Qualified on:  ${formatDate(lead.qualifiedAt)}`);
  lines.push("");

  // ── Status and OAR ──
  const contactsByLead: Record<string, ContactRecord[]> = { [lead.id]: contacts };
  const nurtureByLead: Record<string, NurtureRecord> = nurture ? { [lead.id]: nurture } : {};
  const status = deriveStatus(lead, contactsByLead, nurtureByLead);
  const oarLabel = lead.oar === "both"
    ? "Business Builder + Customer (Unicorn)"
    : lead.oar === "builder"
    ? "Business Builder"
    : "Customer";

  const statusHeader = isEn ? "STATUS" : "สถานะ";
  lines.push(`[ ${statusHeader} ]`);
  lines.push(`  Status:      ${status}`);
  lines.push(`  OAR:         ${oarLabel}`);
  if (nurture) {
    lines.push(`  Involvement: ${involvementLabel(nurture.involvementLevel ?? 0)} (Level ${nurture.involvementLevel ?? 0})`);
  }
  lines.push(`  Discovered:  ${formatDate(lead.discoveredAt)}`);
  lines.push(`  Platform:    ${lead.platform}`);
  if (lead.profileUrl ?? lead.sourceUrl) {
    lines.push(`  Profile URL: ${lead.profileUrl ?? lead.sourceUrl}`);
  }
  if (lead.language) lines.push(`  Language:    ${lead.language}`);
  lines.push("");

  // ── Nurture sequence ──
  if (nurture && nurture.touches && nurture.touches.length > 0) {
    const nurtureHeader = isEn ? "NURTURE SEQUENCE" : "ลำดับการดูแล";
    lines.push(`[ ${nurtureHeader} ] — ${nurture.status.toUpperCase()}`);
    lines.push(`  Enrolled: ${formatDate(nurture.enrolledAt)}`);
    if (nurture.convertedAt) lines.push(`  Converted: ${formatDate(nurture.convertedAt)}`);
    lines.push("");

    for (const touch of nurture.touches) {
      const sentLabel = touch.sentAt ? `sent ${formatDate(touch.sentAt)}` : `scheduled ${formatDate(touch.scheduledFor)}`;
      const responseLabel = touch.response
        ? ` → response: "${touch.response}"${touch.responseScore !== undefined ? ` (${touch.responseScore}/10)` : ""}`
        : "";
      lines.push(
        `  Touch ${touch.touchNumber}: ${touchTypeLabel(touch.touchType)}  [${sentLabel}]${responseLabel}`
      );
    }
    lines.push("");
  }

  // ── First contact history ──
  if (contacts.length > 0) {
    const contactHeader = isEn ? "FIRST CONTACT HISTORY" : "ประวัติการติดต่อ";
    lines.push(`[ ${contactHeader} ]`);
    for (const c of contacts.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
      const sentLabel = c.sentAt ? `sent ${formatDateTime(c.sentAt)}` : c.status;
      const responseLabel = c.responseType ? ` → ${c.responseType}` : "";
      lines.push(`  ${c.strategy} strategy  [${sentLabel}]${responseLabel}`);
    }
    lines.push("");
  }

  // ── Intent signals ──
  if (lead.intentSignalHistory && lead.intentSignalHistory.length > 0) {
    const signalHeader = isEn ? "INTENT SIGNALS" : "สัญญาณความสนใจ";
    lines.push(`[ ${signalHeader} ]`);
    for (const sig of lead.intentSignalHistory.slice(0, 5)) {
      const excerpt = sig.excerpt ? ` — "${sig.excerpt.slice(0, 60)}"` : "";
      lines.push(`  ${formatDate(sig.detectedAt)}  ${sig.type} (${sig.strength})${excerpt}`);
    }
    if (lead.intentSignalHistory.length > 5) {
      lines.push(`  ... and ${lead.intentSignalHistory.length - 5} more signals`);
    }
    lines.push("");
  }

  // ── Notes ──
  const notesList = lead.notes ?? [];
  if (notesList.length > 0) {
    const notesHeader = isEn ? "NOTES" : "บันทึก";
    lines.push(`[ ${notesHeader} ]`);
    for (const n of notesList) {
      lines.push(`  ${formatDateTime(n.addedAt)}  ${n.text}`);
    }
    lines.push("");
  }

  // ── Tags ──
  if (lead.tags && lead.tags.length > 0) {
    lines.push(`Tags: ${lead.tags.join(", ")}`);
    lines.push("");
  }

  const tipEn = `Use /note ${lead.displayName} [text] to add a note.  Use /move ${lead.displayName} [status] to override status.`;
  const tipTh = `ใช้ /note ${lead.displayName} [ข้อความ] เพื่อเพิ่มบันทึก  ใช้ /move ${lead.displayName} [สถานะ] เพื่อเปลี่ยนสถานะ`;
  lines.push(isEn ? tipEn : tipTh);

  return lines.join("\n");
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

  if (!nameQuery) {
    return { ok: false, error: "Name required. Usage: /lead [name]" };
  }

  logger.info("tiger_lead called", { name: nameQuery });

  const leads = loadLeads(workdir);
  const allContacts = loadContacts(workdir);
  const allNurture = loadNurture(workdir);
  const settings = loadSettings(workdir);
  const lang = (settings.preferredLanguage as string) ?? "en";

  const matches = findLeadByName(leads, nameQuery);

  if (matches.length === 0) {
    const msgEn = `No contact found matching "${nameQuery}". Try /search ${nameQuery} to find them.`;
    const msgTh = `ไม่พบรายชื่อที่ตรงกับ "${nameQuery}" ลอง /search ${nameQuery}`;
    return {
      ok: true,
      output: lang === "th" ? msgTh : msgEn,
      data: { found: false },
    };
  }

  // If multiple matches, show a disambiguation list
  if (matches.length > 1) {
    const lines = [
      lang === "th"
        ? `พบหลายรายชื่อที่ตรงกับ "${nameQuery}":`
        : `Multiple contacts match "${nameQuery}" — be more specific:`,
      "",
    ];
    for (const m of matches.slice(0, 10)) {
      const status = deriveStatus(m, {}, allNurture);
      lines.push(`  • ${m.displayName}  (${m.platform}, score: ${Math.round(m.qualifyingScore ?? 0)}, ${status})`);
    }
    return {
      ok: true,
      output: lines.join("\n"),
      data: { found: true, ambiguous: true, count: matches.length },
    };
  }

  const lead = matches[0]!;

  // Gather this lead's contacts and nurture record
  const leadContacts = Object.values(allContacts).filter((c) => c.leadId === lead.id);

  // nurture.json is keyed by nurtureId, not leadId — find by leadId field
  const nurture = Object.values(allNurture).find((n) => n.leadId === lead.id);

  const output = buildDetailView(lead, leadContacts, nurture, lang);

  return {
    ok: true,
    output,
    data: {
      found: true,
      leadId: lead.id,
      displayName: lead.displayName,
      status: deriveStatus(lead, { [lead.id]: leadContacts }, nurture ? { [lead.id]: nurture } : {}),
      scores: {
        profileFit: lead.profileFit,
        intentScore: lead.intentScore,
        engagement: lead.engagement,
        builderScore: Math.round(lead.builderScore ?? 0),
        customerScore: Math.round(lead.customerScore ?? 0),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_lead = {
  name: "tiger_lead",
  description:
    "Full contact detail view. Shows score breakdown (all three dimensions), current status, involvement level, every nurture touch with dates and responses, first contact history, intent signals, notes, source URL, detected language, and OAR assignment. One command — complete history of a contact.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name or partial name of the contact. Case-insensitive fuzzy match against displayName.",
      },
    },
    required: ["name"],
  },

  execute,
};

export default tiger_lead;
