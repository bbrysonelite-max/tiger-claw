// Tiger Claw — tiger_contact Tool
// First contact automation — Block 3.5 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Sends first contact AUTONOMOUSLY. No human in the loop by default.
// Agent does NOT pretend to be human — identifies as AI working for tenant.
//
// Three strategies (selection based on lead score):
//   Direct   — high-intent (≥70) + high-fit (≥70). Cites prospect's own signals.
//   Indirect — moderate-intent or lower-fit. "Who do you know?" framing.
//   Referral — lead came via referral. Uses referrer's name.
//
// Agent Edification Protocol: uses tenant's real credentials from onboard_state.json.
// Scarcity/takeaway energy embedded in ALL messages from first touch.
//
// Timing: randomized 1-4 hour delay, only within 9 AM–8 PM prospect local window.
// Cron runs hourly (`action: 'check'`) to surface messages that are due.
//
// Response handling — Never Chase (one follow-up max):
//   Positive  → queue for nurture
//   Neutral   → one follow-up in 48 hours, then back to pool
//   Negative  → PERMANENTLY opted out, score → 0
//   No response → one follow-up in 72 hours, then score penalty + back to pool
//
// Manual approval opt-in: set `manualApproval: true` in settings.json.
// Approved messages move from `pending_approval` to `scheduled`.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ContactStrategy = "direct" | "indirect" | "referral";

type ContactStatus =
  | "pending_approval"   // Manual approval mode — waiting for tenant sign-off
  | "scheduled"          // Approved and waiting for scheduled time
  | "sent"               // First contact sent, awaiting response
  | "follow_up_scheduled" // Follow-up queued (neutral/no-response path)
  | "follow_up_sent"     // Follow-up sent, awaiting final response
  | "nurture"            // Positive response — handed to tiger_nurture
  | "opted_out"          // Negative response — PERMANENT, no re-contact
  | "back_to_pool"       // No response after follow-up — score penalty applied
  | "error";             // Contact failed to send

type ResponseType = "positive" | "neutral" | "negative" | "no_response";

interface ContactRecord {
  id: string;                   // UUID
  leadId: string;               // Matches lead record in leads.json
  leadDisplayName: string;
  platform: string;
  profileUrl?: string;
  strategy: ContactStrategy;
  oar: "builder" | "customer";
  messageText: string;          // Generated first contact message
  followUpText?: string;        // Generated follow-up message
  status: ContactStatus;
  scheduledFor: string;         // ISO — when to send
  sentAt?: string;
  responseType?: ResponseType;
  responseAt?: string;
  followUpScheduledFor?: string;
  followUpSentAt?: string;
  referredBy?: string;
  postExcerpt?: string;         // The prospect's post that triggered contact
  queuedAt: string;
  completedAt?: string;
}

interface ContactsStore {
  [contactId: string]: ContactRecord;
}

// Minimal lead record shape needed from leads.json
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
  intentSignalHistory: Array<{ type: string; excerpt?: string; source?: string }>;
  postExcerpt?: string;
}

interface OnboardState {
  phase: string;
  identity: {
    name?: string;
    productOrOpportunity?: string;
    yearsInProfession?: string;
    biggestWin?: string;
    differentiator?: string;
  };
  icpBuilder: { idealPerson?: string };
  icpCustomer: { idealPerson?: string };
  icpSingle: { idealPerson?: string };
  botName?: string;
  flavor: string;
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
// Persistence helpers
// ---------------------------------------------------------------------------

function loadContacts(workdir: string): ContactsStore {
  const p = path.join(workdir, "contacts.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as ContactsStore;
  } catch { /* fall through */ }
  return {};
}

function saveContacts(workdir: string, contacts: ContactsStore): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, "contacts.json"), JSON.stringify(contacts, null, 2), "utf8");
}

function loadLeads(workdir: string): Record<string, LeadRecord> {
  const p = path.join(workdir, "leads.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through */ }
  return {};
}

function saveLeads(workdir: string, leads: Record<string, LeadRecord>): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, "leads.json"), JSON.stringify(leads, null, 2), "utf8");
}

function loadOnboardState(workdir: string): OnboardState | null {
  const p = path.join(workdir, "onboard_state.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as OnboardState;
  } catch { /* fall through */ }
  return null;
}

function loadSettings(workdir: string): Record<string, unknown> {
  const p = path.join(workdir, "settings.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* fall through */ }
  return {};
}

// ---------------------------------------------------------------------------
// Strategy selection — based on lead score composition
// ---------------------------------------------------------------------------

function selectStrategy(lead: LeadRecord, referredBy?: string): ContactStrategy {
  if (referredBy) return "referral";
  // Direct: high-intent AND high-fit
  if (lead.intentScore >= 70 && lead.profileFit >= 70) return "direct";
  // Indirect: everyone else who qualified (score ≥ 80 overall, but intent or fit below threshold)
  return "indirect";
}

// ---------------------------------------------------------------------------
// Timing — randomized 1-4 hour delay, 9 AM–8 PM prospect local window
// ---------------------------------------------------------------------------

/**
 * Returns the hour (0-23) in the prospect's local timezone.
 * Uses the tenant's TZ env var as proxy for prospect timezone.
 * Falls back to UTC if TZ is not set or Intl is unavailable.
 */
function getLocalHour(date: Date): number {
  const tz = process.env["TZ"];
  if (!tz) return date.getUTCHours();
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    return parseInt(formatter.format(date), 10);
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Returns the scheduled send time for a contact.
 * Adds a random 1-4 hour delay from now.
 * If the result falls outside 9 AM–8 PM in the prospect's timezone,
 * it is pushed to 9 AM the following day with a small additional jitter.
 */
function computeScheduledTime(): string {
  const delayMs = (3600000 + Math.random() * 3 * 3600000); // 1-4 hours in ms
  const scheduled = new Date(Date.now() + delayMs);

  const localHour = getLocalHour(scheduled);
  const isReasonableHour = localHour >= 9 && localHour < 20; // 9 AM–8 PM local

  if (!isReasonableHour) {
    // Calculate offset to push to 9 AM local tomorrow
    // Add 24h then adjust to the next 9 AM slot
    const hoursUntil9AM = localHour >= 20
      ? (24 - localHour + 9)     // evening → next morning
      : (9 - localHour);         // early morning → same-day 9 AM
    const pushMs = hoursUntil9AM * 3600000 + Math.random() * 3600000; // +0-60 min jitter
    return new Date(scheduled.getTime() + pushMs).toISOString();
  }

  return scheduled.toISOString();
}

// ---------------------------------------------------------------------------
// Message generation — Agent Edification Protocol
// ---------------------------------------------------------------------------

function buildDirectMessage(
  lead: LeadRecord,
  onboard: OnboardState
): string {
  const botName = onboard.botName ?? "Your Tiger";
  const tenantName = onboard.identity.name ?? "my operator";
  const biggestWin = onboard.identity.biggestWin ?? "some impressive results";
  const differentiator = onboard.identity.differentiator ?? "a different approach";
  const profession = professionLabel(onboard.flavor);

  // Pull the most relevant signal excerpt to personalize the opener
  const signalExcerpt = lead.intentSignalHistory
    .filter((s) => s.excerpt)
    .map((s) => s.excerpt)
    .find(Boolean) ?? "";

  const opener = signalExcerpt
    ? `I noticed you mentioned something about ${signalExcerpt.slice(0, 80).toLowerCase().replace(/[.?!]$/, "")}. That stood out.`
    : `Something about your profile caught my attention.`;

  return [
    `Hi ${lead.displayName},`,
    ``,
    `I'm ${botName} — an AI assistant working directly with ${tenantName}.`,
    ``,
    `${opener}`,
    ``,
    `${tenantName} is one of the sharper people I work with in ${profession}. ${biggestWin}. What makes them different: ${differentiator}.`,
    ``,
    `They asked me personally to reach out to you — not everyone on their list.`,
    ``,
    `I'm not sure this is a fit — we're selective — but if you're open to a 10-minute conversation, it's probably worth your time.`,
    ``,
    `Worth exploring?`,
  ].join("\n");
}

function buildIndirectMessage(
  lead: LeadRecord,
  onboard: OnboardState
): string {
  const botName = onboard.botName ?? "Your Tiger";
  const tenantName = onboard.identity.name ?? "my operator";
  const biggestWin = onboard.identity.biggestWin ?? "built something impressive";
  const differentiator = onboard.identity.differentiator ?? "does this differently";

  // ICP description for the "who do you know" ask
  const icpDesc =
    onboard.flavor === "network-marketer"
      ? (onboard.icpBuilder?.idealPerson ?? "driven, entrepreneurial types who want more control over their income")
      : (onboard.icpSingle?.idealPerson ?? onboard.icpCustomer?.idealPerson ?? "the right kind of person");

  return [
    `Hey ${lead.displayName},`,
    ``,
    `I'm ${botName} — an AI assistant working with ${tenantName}.`,
    ``,
    `${tenantName} is expanding and looking for a very specific type of person: ${icpDesc}.`,
    ``,
    `I'm reaching out to a few people to ask: would you happen to know anyone who fits that description?`,
    ``,
    `For context — ${tenantName} has ${biggestWin}. They ${differentiator}. This isn't for everyone, and they know it.`,
    ``,
    `(Honestly, I hadn't thought of you for this — but if you're personally curious, I'm not opposed to a conversation.)`,
  ].join("\n");
}

function buildReferralMessage(
  lead: LeadRecord,
  onboard: OnboardState,
  referredBy: string
): string {
  const botName = onboard.botName ?? "Your Tiger";
  const tenantName = onboard.identity.name ?? "my operator";
  const biggestWin = onboard.identity.biggestWin ?? "some impressive results";
  const differentiator = onboard.identity.differentiator ?? "a unique approach";

  return [
    `Hi ${lead.displayName},`,
    ``,
    `I'm ${botName} — an AI assistant working with ${tenantName}.`,
    ``,
    `${referredBy} mentioned your name and thought you'd be a strong fit for what we're building. When ${tenantName} heard that, they asked me to reach out to you directly.`,
    ``,
    `${tenantName} has ${biggestWin}. They're selective — ${differentiator} — which is probably why ${referredBy} thought of you specifically.`,
    ``,
    `Open to hearing more? Just say yes and I'll share the details.`,
  ].join("\n");
}

function buildFollowUpMessage(
  contact: ContactRecord,
  onboard: OnboardState,
  responseType: "neutral" | "no_response"
): string {
  const botName = onboard.botName ?? "Your Tiger";
  const tenantName = onboard.identity.name ?? "my operator";

  if (responseType === "no_response") {
    return [
      `Hey ${contact.leadDisplayName},`,
      ``,
      `I'm ${botName} — I reached out a few days ago on behalf of ${tenantName}.`,
      ``,
      `I won't chase you — that's not how we operate. But I wanted to make sure this didn't slip through the cracks, in case you were just busy.`,
      ``,
      `If this isn't for you, just say so and I'll leave you alone. If you're open to a quick conversation, the offer still stands.`,
      ``,
      `Either way, no pressure.`,
    ].join("\n");
  }

  // Neutral response follow-up
  return [
    `Hey ${contact.leadDisplayName},`,
    ``,
    `I'm ${botName} — following up from our earlier conversation.`,
    ``,
    `I understand it might not be the right moment. That's fine — ${tenantName} doesn't need everyone, just the right person.`,
    ``,
    `If you're still curious, I'm happy to answer one specific question. What's the thing that's making you hesitate?`,
    ``,
    `If not, no hard feelings.`,
  ].join("\n");
}

function professionLabel(flavor: string): string {
  const labels: Record<string, string> = {
    "network-marketer": "network marketing",
    "real-estate": "real estate",
    "health-wellness": "health & wellness",
  };
  return labels[flavor] ?? "their field";
}

// ---------------------------------------------------------------------------
// Score penalty helper — applies to leads that go back to pool
// ---------------------------------------------------------------------------

function applyScorePenalty(leadId: string, workdir: string, logger: ToolContext["logger"]): void {
  const leads = loadLeads(workdir);
  const lead = leads[leadId];
  if (!lead) return;

  // Penalty: -10 on intentScore (simulates signal decay from lack of response)
  const updatedIntentScore = Math.max(0, (lead.intentScore ?? 50) - 10);
  (lead as Record<string, unknown>)["intentScore"] = updatedIntentScore;

  // Recompute scores — simplified (full recompute is tiger_score's job)
  // Just flag the lead as needing a recalculate on next tiger_score.recalculate run
  (lead as Record<string, unknown>)["needsRecalculate"] = true;

  leads[leadId] = lead;
  saveLeads(workdir, leads);
  logger.info("tiger_contact: score penalty applied", { leadId, updatedIntentScore });
}

function markLeadOptedOut(leadId: string, workdir: string): void {
  const leads = loadLeads(workdir);
  const lead = leads[leadId];
  if (!lead) return;
  lead.optedOut = true;
  (lead as Record<string, unknown>)["optedOutAt"] = new Date().toISOString();
  // Hard zero scores per spec
  (lead as Record<string, unknown>)["builderScore"] = 0;
  (lead as Record<string, unknown>)["customerScore"] = 0;
  (lead as Record<string, unknown>)["qualified"] = false;
  leads[leadId] = lead;
  saveLeads(workdir, leads);
}

// ---------------------------------------------------------------------------
// Action: queue
// ---------------------------------------------------------------------------

interface QueueParams {
  action: "queue";
  leadId: string;
  referredBy?: string;
}

function handleQueue(
  params: QueueParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const leads = loadLeads(workdir);
  const lead = leads[params.leadId];

  if (!lead) {
    return { ok: false, error: `Lead ${params.leadId} not found in leads.json.` };
  }
  if (lead.optedOut) {
    return { ok: false, error: `${lead.displayName} has opted out. Cannot contact.` };
  }
  if (!lead.qualified) {
    return {
      ok: false,
      error: `${lead.displayName} has not yet qualified (score < 80). Run tiger_score first.`,
    };
  }

  const onboard = loadOnboardState(workdir);
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete. Cannot generate contact messages." };
  }

  const contacts = loadContacts(workdir);

  // Check for existing active contact for this lead
  const existingActive = Object.values(contacts).find(
    (c) =>
      c.leadId === params.leadId &&
      !["opted_out", "back_to_pool", "nurture", "error"].includes(c.status)
  );
  if (existingActive) {
    return {
      ok: true,
      output: `${lead.displayName} already has an active contact in status: ${existingActive.status}.`,
      data: { contactId: existingActive.id, status: existingActive.status, skipped: true },
    };
  }

  const strategy = selectStrategy(lead, params.referredBy);
  const oar = (lead.primaryOar ?? lead.oar ?? "builder") as "builder" | "customer";

  // Generate message
  let messageText: string;
  if (strategy === "direct") {
    messageText = buildDirectMessage(lead, onboard);
  } else if (strategy === "referral") {
    messageText = buildReferralMessage(lead, onboard, params.referredBy!);
  } else {
    messageText = buildIndirectMessage(lead, onboard);
  }

  // Generate follow-up (prepared in advance)
  // We don't know the response type yet, so we defer follow-up generation to record_response

  // Determine initial status based on manual approval setting
  const settings = loadSettings(workdir);
  const manualApproval = settings.manualApproval === true;
  const scheduledFor = computeScheduledTime();
  const status: ContactStatus = manualApproval ? "pending_approval" : "scheduled";

  const record: ContactRecord = {
    id: crypto.randomUUID(),
    leadId: params.leadId,
    leadDisplayName: lead.displayName,
    platform: lead.platform,
    profileUrl: lead.profileUrl,
    strategy,
    oar,
    messageText,
    status,
    scheduledFor,
    referredBy: params.referredBy,
    postExcerpt: lead.intentSignalHistory?.[0]?.excerpt,
    queuedAt: new Date().toISOString(),
  };

  contacts[record.id] = record;
  saveContacts(workdir, contacts);

  logger.info("tiger_contact: queued", {
    contactId: record.id,
    leadDisplayName: lead.displayName,
    strategy,
    status,
    scheduledFor,
  });

  const scheduledDate = new Date(scheduledFor);
  const output = manualApproval
    ? [
        `Contact queued for approval: ${lead.displayName} (${strategy} strategy)`,
        `Message ready. Awaiting your approval before scheduling.`,
        `Call tiger_contact with action: 'approve' and contactId: '${record.id}' to approve.`,
      ].join("\n")
    : [
        `Contact scheduled: ${lead.displayName} (${strategy} strategy)`,
        `Will send at: ${scheduledDate.toUTCString()}`,
        ``,
        `--- Message Preview ---`,
        messageText,
      ].join("\n");

  return {
    ok: true,
    output,
    data: {
      contactId: record.id,
      leadId: params.leadId,
      leadDisplayName: lead.displayName,
      strategy,
      status,
      scheduledFor,
      messageText,
      manualApproval,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: check (cron — surfaces due messages)
// ---------------------------------------------------------------------------

function handleCheck(workdir: string, logger: ToolContext["logger"]): ToolResult {
  const contacts = loadContacts(workdir);
  const now = new Date().toISOString();
  const due: ContactRecord[] = [];
  const followUpsDue: ContactRecord[] = [];

  for (const contact of Object.values(contacts)) {
    if (contact.status === "scheduled" && contact.scheduledFor <= now) {
      due.push(contact);
    }
    if (
      contact.status === "follow_up_scheduled" &&
      contact.followUpScheduledFor &&
      contact.followUpScheduledFor <= now
    ) {
      followUpsDue.push(contact);
    }
  }

  // Also check for no-response timeouts on sent contacts
  const noResponseDue: ContactRecord[] = [];
  for (const contact of Object.values(contacts)) {
    if (contact.status === "sent" && contact.sentAt) {
      const hoursSinceSent = (Date.now() - new Date(contact.sentAt).getTime()) / 3600000;
      if (hoursSinceSent >= 72) {
        noResponseDue.push(contact);
      }
    }
    if (contact.status === "follow_up_sent" && contact.followUpSentAt) {
      const hoursSinceSent = (Date.now() - new Date(contact.followUpSentAt).getTime()) / 3600000;
      if (hoursSinceSent >= 72) {
        noResponseDue.push(contact);
      }
    }
  }

  logger.info("tiger_contact: check", {
    dueCount: due.length,
    followUpsCount: followUpsDue.length,
    noResponseCount: noResponseDue.length,
  });

  if (due.length === 0 && followUpsDue.length === 0 && noResponseDue.length === 0) {
    return {
      ok: true,
      output: "No contacts due to send right now.",
      data: { due: [], followUpsDue: [], noResponseDue: [] },
    };
  }

  const allDue = [
    ...due.map((c) => ({ ...c, checkType: "first_contact" as const })),
    ...followUpsDue.map((c) => ({ ...c, checkType: "follow_up" as const })),
    ...noResponseDue.map((c) => ({ ...c, checkType: "no_response_timeout" as const })),
  ];

  const lines = [`${allDue.length} contact(s) need action:`];
  for (const c of allDue) {
    lines.push(
      `  • [${c.checkType}] ${c.leadDisplayName} (${c.platform}) — ${c.strategy} — ID: ${c.id}`
    );
  }
  lines.push(``, `For each: send the message, then call mark_sent with the contactId.`);
  lines.push(`For no_response timeouts: call record_response with type: 'no_response'.`);

  return {
    ok: true,
    output: lines.join("\n"),
    data: {
      due: due.map((c) => ({
        contactId: c.id,
        leadId: c.leadId,
        leadDisplayName: c.leadDisplayName,
        platform: c.platform,
        profileUrl: c.profileUrl,
        messageText: c.messageText,
        strategy: c.strategy,
        checkType: "first_contact",
      })),
      followUpsDue: followUpsDue.map((c) => ({
        contactId: c.id,
        leadId: c.leadId,
        leadDisplayName: c.leadDisplayName,
        platform: c.platform,
        profileUrl: c.profileUrl,
        messageText: c.followUpText ?? c.messageText,
        checkType: "follow_up",
      })),
      noResponseDue: noResponseDue.map((c) => ({
        contactId: c.id,
        leadId: c.leadId,
        leadDisplayName: c.leadDisplayName,
        checkType: "no_response_timeout",
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Action: mark_sent
// ---------------------------------------------------------------------------

interface MarkSentParams {
  action: "mark_sent";
  contactId: string;
  isFollowUp?: boolean;
}

function handleMarkSent(
  params: MarkSentParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const contacts = loadContacts(workdir);
  const contact = contacts[params.contactId];

  if (!contact) {
    return { ok: false, error: `Contact ${params.contactId} not found.` };
  }

  const now = new Date().toISOString();

  if (params.isFollowUp) {
    contact.status = "follow_up_sent";
    contact.followUpSentAt = now;
  } else {
    contact.status = "sent";
    contact.sentAt = now;
  }

  contacts[params.contactId] = contact;
  saveContacts(workdir, contacts);

  logger.info("tiger_contact: marked sent", {
    contactId: params.contactId,
    leadDisplayName: contact.leadDisplayName,
    isFollowUp: params.isFollowUp ?? false,
  });

  return {
    ok: true,
    output: `${contact.leadDisplayName}: contact marked as sent. Watching for response.`,
    data: { contactId: params.contactId, status: contact.status },
  };
}

// ---------------------------------------------------------------------------
// Action: record_response — the Never Chase state machine
// ---------------------------------------------------------------------------

interface RecordResponseParams {
  action: "record_response";
  contactId: string;
  responseType: ResponseType;
  responseText?: string;
}

function handleRecordResponse(
  params: RecordResponseParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const contacts = loadContacts(workdir);
  const contact = contacts[params.contactId];

  if (!contact) {
    return { ok: false, error: `Contact ${params.contactId} not found.` };
  }

  const onboard = loadOnboardState(workdir);
  const now = new Date().toISOString();

  contact.responseType = params.responseType;
  contact.responseAt = now;

  logger.info("tiger_contact: response recorded", {
    contactId: params.contactId,
    leadDisplayName: contact.leadDisplayName,
    responseType: params.responseType,
    status: contact.status,
  });

  switch (params.responseType) {
    case "positive": {
      // → Move to nurture. No follow-up needed.
      contact.status = "nurture";
      contact.completedAt = now;
      contacts[params.contactId] = contact;
      saveContacts(workdir, contacts);

      return {
        ok: true,
        output: [
          `${contact.leadDisplayName} responded positively. Moving to nurture sequence.`,
          `Call tiger_nurture with action: 'enroll' and leadId: '${contact.leadId}'.`,
        ].join("\n"),
        data: {
          contactId: params.contactId,
          status: "nurture",
          action: "enroll_in_nurture",
          leadId: contact.leadId,
        },
      };
    }

    case "negative": {
      // → PERMANENTLY opted out. Score → 0. No re-contact ever.
      contact.status = "opted_out";
      contact.completedAt = now;
      contacts[params.contactId] = contact;
      saveContacts(workdir, contacts);

      markLeadOptedOut(contact.leadId, workdir);

      return {
        ok: true,
        output: [
          `${contact.leadDisplayName} said no. Permanently opted out.`,
          `They have been removed from your pipeline and will never be contacted again.`,
          `That's fine — not everyone is a fit. The flywheel keeps moving.`,
        ].join("\n"),
        data: {
          contactId: params.contactId,
          status: "opted_out",
          permanent: true,
          leadId: contact.leadId,
        },
      };
    }

    case "neutral": {
      // → One follow-up within 48 hours. That's it.
      if (contact.status === "follow_up_sent") {
        // Already on the follow-up — neutral again means back to pool
        contact.status = "back_to_pool";
        contact.completedAt = now;
        contacts[params.contactId] = contact;
        saveContacts(workdir, contacts);
        applyScorePenalty(contact.leadId, workdir, logger);

        return {
          ok: true,
          output: [
            `${contact.leadDisplayName} gave a neutral follow-up response. One follow-up max — moving them back to pool.`,
            `Score penalty applied. They'll re-qualify if new signals appear.`,
          ].join("\n"),
          data: { contactId: params.contactId, status: "back_to_pool", leadId: contact.leadId },
        };
      }

      // First neutral — schedule one follow-up in 48 hours
      const followUpTime = new Date(Date.now() + 48 * 3600000).toISOString();
      contact.followUpScheduledFor = followUpTime;
      contact.status = "follow_up_scheduled";
      contact.followUpText = onboard
        ? buildFollowUpMessage(contact, onboard, "neutral")
        : contact.messageText;
      contacts[params.contactId] = contact;
      saveContacts(workdir, contacts);

      return {
        ok: true,
        output: [
          `${contact.leadDisplayName} gave a neutral response. One follow-up scheduled for 48 hours from now.`,
          `Follow-up will surface on next tiger_contact check after ${new Date(followUpTime).toUTCString()}.`,
        ].join("\n"),
        data: {
          contactId: params.contactId,
          status: "follow_up_scheduled",
          followUpScheduledFor: followUpTime,
        },
      };
    }

    case "no_response": {
      // → One follow-up in 72 hours, then score penalty + back to pool.
      if (contact.status === "follow_up_sent") {
        // No response to follow-up — back to pool with score penalty
        contact.status = "back_to_pool";
        contact.completedAt = now;
        contacts[params.contactId] = contact;
        saveContacts(workdir, contacts);
        applyScorePenalty(contact.leadId, workdir, logger);

        return {
          ok: true,
          output: [
            `${contact.leadDisplayName} didn't respond to the follow-up either. Back to pool — score penalty applied.`,
            `They'll re-qualify if they show new signals. The flywheel doesn't chase.`,
          ].join("\n"),
          data: { contactId: params.contactId, status: "back_to_pool", leadId: contact.leadId },
        };
      }

      // First no-response — schedule one follow-up in 72 hours
      const followUpTime = new Date(Date.now() + 72 * 3600000).toISOString();
      contact.followUpScheduledFor = followUpTime;
      contact.status = "follow_up_scheduled";
      contact.followUpText = onboard
        ? buildFollowUpMessage(contact, onboard, "no_response")
        : contact.messageText;
      contacts[params.contactId] = contact;
      saveContacts(workdir, contacts);

      return {
        ok: true,
        output: [
          `${contact.leadDisplayName} hasn't responded. One follow-up in 72 hours — then back to pool.`,
          `We don't chase. One follow-up is the max.`,
        ].join("\n"),
        data: {
          contactId: params.contactId,
          status: "follow_up_scheduled",
          followUpScheduledFor: followUpTime,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Action: approve (manual approval mode)
// ---------------------------------------------------------------------------

interface ApproveParams {
  action: "approve";
  contactId: string;
}

function handleApprove(
  params: ApproveParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const contacts = loadContacts(workdir);
  const contact = contacts[params.contactId];

  if (!contact) {
    return { ok: false, error: `Contact ${params.contactId} not found.` };
  }
  if (contact.status !== "pending_approval") {
    return {
      ok: true,
      output: `Contact ${params.contactId} is already in status: ${contact.status}. No action needed.`,
      data: { contactId: params.contactId, status: contact.status },
    };
  }

  // Recompute scheduled time from now (approval may come hours after queue)
  contact.scheduledFor = computeScheduledTime();
  contact.status = "scheduled";
  contacts[params.contactId] = contact;
  saveContacts(workdir, contacts);

  logger.info("tiger_contact: approved", {
    contactId: params.contactId,
    leadDisplayName: contact.leadDisplayName,
    scheduledFor: contact.scheduledFor,
  });

  return {
    ok: true,
    output: [
      `Approved. ${contact.leadDisplayName} will be contacted at ${new Date(contact.scheduledFor).toUTCString()}.`,
      ``,
      `--- Message ---`,
      contact.messageText,
    ].join("\n"),
    data: {
      contactId: params.contactId,
      status: "scheduled",
      scheduledFor: contact.scheduledFor,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

function handleList(workdir: string): ToolResult {
  const contacts = loadContacts(workdir);
  const all = Object.values(contacts);

  const byStatus: Record<string, ContactRecord[]> = {};
  for (const c of all) {
    if (!byStatus[c.status]) byStatus[c.status] = [];
    byStatus[c.status].push(c);
  }

  const statusOrder: ContactStatus[] = [
    "pending_approval",
    "scheduled",
    "sent",
    "follow_up_scheduled",
    "follow_up_sent",
    "nurture",
    "opted_out",
    "back_to_pool",
    "error",
  ];

  const lines = [`Contact Pipeline (${all.length} total)`];

  for (const status of statusOrder) {
    const group = byStatus[status] ?? [];
    if (group.length === 0) continue;
    lines.push(``, `${status.replace(/_/g, " ").toUpperCase()} (${group.length}):`);
    for (const c of group.slice(0, 10)) {
      const detail =
        status === "scheduled"
          ? ` → ${new Date(c.scheduledFor).toUTCString()}`
          : status === "follow_up_scheduled"
          ? ` → follow-up ${new Date(c.followUpScheduledFor!).toUTCString()}`
          : "";
      lines.push(`  • ${c.leadDisplayName} (${c.platform}, ${c.strategy})${detail}`);
    }
    if (group.length > 10) lines.push(`  ... and ${group.length - 10} more`);
  }

  return {
    ok: true,
    output: lines.join("\n"),
    data: {
      total: all.length,
      byStatus: Object.fromEntries(
        Object.entries(byStatus).map(([k, v]) => [k, v.length])
      ),
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

  logger.info("tiger_contact called", { action });

  try {
    switch (action) {
      case "queue":
        return handleQueue(params as unknown as QueueParams, workdir, logger);

      case "check":
        return handleCheck(workdir, logger);

      case "mark_sent":
        return handleMarkSent(params as unknown as MarkSentParams, workdir, logger);

      case "record_response":
        return handleRecordResponse(params as unknown as RecordResponseParams, workdir, logger);

      case "approve":
        return handleApprove(params as unknown as ApproveParams, workdir, logger);

      case "list":
        return handleList(workdir);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: queue | check | mark_sent | record_response | approve | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_contact error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_contact error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_contact = {
  name: "tiger_contact",
  description:
    "First contact automation. Generates edification-based messages using the tenant's real credentials, selects the right strategy (Direct / Indirect / Referral), schedules with a 1-4 hour delay, and implements the Never Chase rule (max one follow-up). The cron calls 'check' every hour to surface due messages. After sending via channel, call 'mark_sent'. When a prospect responds, call 'record_response' to advance the state machine. Positive → nurture. Negative → permanent opt-out. Neutral / no-response → one follow-up, then back to pool.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["queue", "check", "mark_sent", "record_response", "approve", "list"],
        description:
          "queue: prepare first contact for a qualified lead. check: cron action — returns due messages. mark_sent: confirm message was sent. record_response: process prospect's reply. approve: approve queued message (manual mode). list: show full contact pipeline.",
      },
      leadId: {
        type: "string",
        description: "Lead UUID from leads.json. Required for queue action.",
      },
      referredBy: {
        type: "string",
        description: "Name of the person who referred this lead (triggers Referral strategy).",
      },
      contactId: {
        type: "string",
        description: "Contact UUID from contacts.json. Required for mark_sent, record_response, approve.",
      },
      responseType: {
        type: "string",
        enum: ["positive", "neutral", "negative", "no_response"],
        description: "Prospect's response classification. For record_response action.",
      },
      responseText: {
        type: "string",
        description: "Actual text of the prospect's response (optional, for context).",
      },
      isFollowUp: {
        type: "boolean",
        description: "True if marking a follow-up as sent (not the first contact). For mark_sent.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_contact;
