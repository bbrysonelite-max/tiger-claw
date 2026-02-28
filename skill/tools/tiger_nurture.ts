// Tiger Claw — tiger_nurture Tool
// 30-day nurture sequence engine — Block 3.6 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Sequence: 8 touches over 30 days, 3-4 day default cadence.
// Touch types (LOCKED, varied — not repetitive):
//   1 - Value drop       (Reciprocity)        Day 0
//   2 - Testimonial      (Social Proof)        Day 3
//   3 - Authority        (Authority transfer)  Day 7
//   4 - Check-in         (Liking)              Day 10
//   5 - 1-10 Part 1      (Qualification pivot) Day 14
//   6 - 1-10 Part 2 / Gap-closing / Interrupt  Day 18
//   7 - Scarcity         (Takeaway escalation) Day 22
//   8 - Pattern Interrupt + Final takeaway     Day 26
//
// Adaptive acceleration: positive response → next touch within 24h.
//
// The 1-10 Framework (Touch 5-6):
//   Part 1: "On a scale of 1-10, where are you?"
//   Part 2: "What would you need to know to be a 10?" → fires for 6-7 ONLY
//   Gap-closing: match answer to objection bucket → respond → re-ask Part 1
//   Max 2 rounds. Still 6-7 after round 2 → takeaway.
//
// Exit conditions (ALL 6, LOCKED):
//   8-10 response      → Conversion (tiger_convert)
//   6-7 after 2 rounds → Takeaway, slow drip
//   5 or below         → Immediate takeaway
//   2 consecutive no-response → Exit, score penalty, back to pool
//   Explicit opt-out   → Permanent exit
//   30-day complete    → Final takeaway, slow drip
//
// Slow drip: 1 touch/month, value-only, no ask. 3 months max, then archive.
//
// Cron calls `check` every hour. After sending a touch via channel, call mark_sent.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Touch schedule: day offsets from enrollment
const TOUCH_DAY_OFFSETS = [0, 3, 7, 10, 14, 18, 22, 26] as const;
const TOTAL_TOUCHES = 8;
const NURTURE_WINDOW_DAYS = 30;

// Adaptive acceleration: how soon next touch fires after a positive response
const ACCELERATION_HOURS = 24;

// Slow drip: 1 per month, 3 months max
const SLOW_DRIP_INTERVAL_DAYS = 30;
const SLOW_DRIP_MAX_COUNT = 3;
const SLOW_DRIP_ARCHIVE_DAYS = 90;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NurtureStatus =
  | "active"              // Sequence running normally
  | "accelerated"         // Positive response — sending faster
  | "gap_closing"         // In 1-10 gap-closing dialogue
  | "slow_drip"           // Exited main sequence, monthly drips
  | "converted"           // 8-10 response — handed to tiger_convert
  | "opted_out"           // Permanent — no re-contact
  | "back_to_pool"        // 2 consecutive no-responses — score penalty applied
  | "archived";           // Slow drip exhausted — 3 months passed

type TouchType =
  | "value_drop"
  | "testimonial"
  | "authority_transfer"
  | "personal_checkin"
  | "one_to_ten_part1"
  | "one_to_ten_part2"
  | "gap_closing"
  | "scarcity_takeaway"
  | "pattern_interrupt"
  | "slow_drip_value"
  | "final_takeaway";

interface TouchRecord {
  touchNumber: number;
  type: TouchType;
  messageText: string;
  scheduledFor: string;
  sentAt?: string;
  responseText?: string;
  responseAt?: string;
  responseClassification?: "hot" | "warm" | "neutral" | "no_response" | "opted_out";
  oneToTenScore?: number;      // If this touch was a 1-10 question
}

interface NurtureRecord {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  oar: "builder" | "customer";
  enrolledAt: string;

  status: NurtureStatus;
  currentTouchNumber: number;   // 1-8, then 0 during slow drip
  touchHistory: TouchRecord[];
  consecutiveNoResponses: number;

  // 1-10 framework state
  oneToTenRound: number;        // 0 = not started, 1 = first round, 2 = second round
  lastOneToTenScore?: number;
  lastGapAnswer?: string;       // What they said in Part 2

  // Scheduling
  nextTouchScheduledFor?: string;
  lastTouchSentAt?: string;

  // Slow drip
  slowDripCount: number;
  slowDripLastSentAt?: string;

  // Timestamps
  completedAt?: string;
  convertedAt?: string;
}

interface NurtureStore {
  [nurtureId: string]: NurtureRecord;
}

interface OnboardState {
  phase: string;
  identity: {
    name?: string;
    productOrOpportunity?: string;
    yearsInProfession?: string;
    biggestWin?: string;
    differentiator?: string;
    monthlyIncomeGoal?: string;
  };
  icpBuilder: { idealPerson?: string; problemFaced?: string };
  icpCustomer: { idealPerson?: string; problemFaced?: string };
  icpSingle: { idealPerson?: string; problemFaced?: string };
  botName?: string;
  flavor: string;
}

interface LeadRecord {
  id: string;
  platform: string;
  displayName: string;
  profileFit: number;
  intentScore: number;
  oar: string;
  qualified: boolean;
  optedOut: boolean;
  intentSignalHistory: Array<{ type: string; excerpt?: string }>;
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

function loadNurture(workdir: string): NurtureStore {
  const p = path.join(workdir, "nurture.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as NurtureStore;
  } catch { /* fall through */ }
  return {};
}

function saveNurture(workdir: string, store: NurtureStore): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, "nurture.json"), JSON.stringify(store, null, 2), "utf8");
}

function loadOnboardState(workdir: string): OnboardState | null {
  const p = path.join(workdir, "onboard_state.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as OnboardState;
  } catch { /* fall through */ }
  return null;
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

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

function dayOffsetMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function scheduledForTouch(touchNumber: number, enrolledAt: string): string {
  const offset = TOUCH_DAY_OFFSETS[touchNumber - 1] ?? (touchNumber - 1) * 3;
  return new Date(new Date(enrolledAt).getTime() + dayOffsetMs(offset)).toISOString();
}

function acceleratedNextTouch(): string {
  return new Date(Date.now() + ACCELERATION_HOURS * 3600000).toISOString();
}

function slowDripNextDate(lastSentAt?: string): string {
  const base = lastSentAt ? new Date(lastSentAt) : new Date();
  return new Date(base.getTime() + dayOffsetMs(SLOW_DRIP_INTERVAL_DAYS)).toISOString();
}

// ---------------------------------------------------------------------------
// Touch type assignment
// ---------------------------------------------------------------------------

function touchTypeForNumber(touchNumber: number, record: NurtureRecord): TouchType {
  switch (touchNumber) {
    case 1: return "value_drop";
    case 2: return "testimonial";
    case 3: return "authority_transfer";
    case 4: return "personal_checkin";
    case 5: return "one_to_ten_part1";
    case 6:
      // Part 2 if they responded 6-7 to Part 1; otherwise scarcity or pattern interrupt
      if (record.lastOneToTenScore !== undefined && record.lastOneToTenScore >= 6 && record.lastOneToTenScore <= 7) {
        return record.oneToTenRound <= 1 ? "one_to_ten_part2" : "pattern_interrupt";
      }
      return "scarcity_takeaway";
    case 7: return "scarcity_takeaway";
    case 8: return "pattern_interrupt";
    default: return "scarcity_takeaway";
  }
}

// ---------------------------------------------------------------------------
// Message generation — all touch types
// ---------------------------------------------------------------------------

function professionLabel(flavor: string): string {
  const labels: Record<string, string> = {
    "network-marketer": "network marketing",
    "real-estate": "real estate",
    "health-wellness": "health & wellness",
  };
  return labels[flavor] ?? "their field";
}

function buildTouchMessage(
  touchType: TouchType,
  record: NurtureRecord,
  onboard: OnboardState,
  gapAnswer?: string
): string {
  const botName = onboard.botName ?? "your assistant";
  const tenantName = onboard.identity.name ?? "my operator";
  const biggestWin = onboard.identity.biggestWin ?? "built something impressive";
  const differentiator = onboard.identity.differentiator ?? "takes a different approach";
  const profession = professionLabel(onboard.flavor);
  const product = onboard.identity.productOrOpportunity ?? "the opportunity";
  const years = onboard.identity.yearsInProfession ?? "several years";

  const icp =
    onboard.flavor === "network-marketer"
      ? (record.oar === "builder"
          ? onboard.icpBuilder?.idealPerson
          : onboard.icpCustomer?.idealPerson)
      : onboard.icpSingle?.idealPerson;

  const name = record.leadDisplayName;

  switch (touchType) {
    case "value_drop":
      return [
        `Hey ${name},`,
        ``,
        `I'm ${botName}, working with ${tenantName}.`,
        ``,
        `I wanted to share something relevant — no pitch, just something I thought you'd find useful.`,
        ``,
        `The conversation around AI and work is shifting fast. The middle layer of jobs — management, coordination, routine knowledge work — is compressing. People who own their income stream are going to be in a very different position in 5 years than people who don't.`,
        ``,
        `Not pushing anything. Just something worth thinking about.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "testimonial":
      return [
        `Hey ${name},`,
        ``,
        `Quick one — I was talking with ${tenantName} earlier and they mentioned someone who started exactly where you are now.`,
        ``,
        `Same hesitations. Same "I'm not sure this is for me" energy. Six months later — different story entirely.`,
        ``,
        `${tenantName} doesn't work with everyone. They're selective. Which is probably why results like that happen.`,
        ``,
        `Anyway, just thought of you. No pressure.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "authority_transfer":
      return [
        `Hey ${name},`,
        ``,
        `I realized I haven't properly introduced you to ${tenantName} — I just told you they were good. Let me be more specific.`,
        ``,
        `${tenantName} has been in ${profession} for ${years}. ${biggestWin}. What makes them different: ${differentiator}.`,
        ``,
        `They're not trying to be everything to everyone. They work with a specific kind of person: ${icp ?? "someone serious about results"}.`,
        ``,
        `If that's you — even a little — it's worth one conversation.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "personal_checkin":
      return [
        `Hey ${name},`,
        ``,
        `Just checking in — how are things going?`,
        ``,
        `No agenda. ${tenantName} asked me to stay in touch with people they've been introduced to. They actually care how you're doing.`,
        ``,
        `Anything new on your end?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "one_to_ten_part1":
      return [
        `Hey ${name},`,
        ``,
        `Quick question — and I want an honest answer.`,
        ``,
        `On a scale of 1-10, where are you with ${product}? 1 = not interested at all. 10 = let's do this right now.`,
        ``,
        `Just give me a number. No judgment either way.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "one_to_ten_part2":
      return [
        `Okay, I appreciate the honesty.`,
        ``,
        `Here's what I want to know: what would you need to know — or see — to move that to a 10?`,
        ``,
        `Not trying to talk you into anything. I genuinely want to know what's in the gap. Whatever it is, I can either answer it or tell you I can't — and either is fine.`,
        ``,
        `What's the thing?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "gap_closing": {
      const answer = gapAnswer ?? "what you mentioned";
      return [
        `Got it — ${answer}.`,
        ``,
        `That's a fair question and ${tenantName} gets it a lot. Here's the honest answer:`,
        ``,
        `${tenantName} has been exactly where you are. They know what it looks like when something's a fit and when it isn't. Their experience with ${biggestWin} came from deciding to take that question seriously rather than letting it stop them.`,
        ``,
        `With that in mind — where are you now on the 1-10 scale?`,
        ``,
        `— ${botName}`,
      ].join("\n");
    }

    case "scarcity_takeaway":
      return [
        `Hey ${name},`,
        ``,
        `I'm going to be straight with you — ${tenantName} is selective about who they spend time with, and I've been reaching out to a few people on their behalf.`,
        ``,
        `Some of those conversations are moving forward. I can't keep everyone in the loop indefinitely.`,
        ``,
        `If you're curious — even a little — now is the time to say so. If not, no hard feelings at all.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "pattern_interrupt":
      return [
        `Hey ${name},`,
        ``,
        `Let me ask you something before I let you go.`,
        ``,
        `If someone offered you a million dollars to jump out of an airplane without a parachute, would you do it?`,
        ``,
        `Most people say no immediately. But here's the thing — nobody said the airplane was in the air. It's sitting on the runway.`,
        ``,
        `The lesson: don't say no before you have all the information.`,
        ``,
        `I think you might be doing that with ${product}. And that's fine — if you've thought it through. But if the no is coming from an incomplete picture, it's worth 10 minutes to complete it.`,
        ``,
        `I'll leave it there. If you want that conversation, just say yes.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "final_takeaway":
      return [
        `Hey ${name},`,
        ``,
        `I've enjoyed being in touch. I'm going to step back now — this is the last message I'll send for a while.`,
        ``,
        `${tenantName} is doing well and moving forward. If the timing ever changes for you, I'm easy to reach.`,
        ``,
        `Take care.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "slow_drip_value":
      return [
        `Hey ${name},`,
        ``,
        `Checking in — it's been a bit. Just wanted to share something I thought was worth passing along.`,
        ``,
        `${tenantName} has been focused on ${differentiator}. Things are moving. No pitch — just wanted to stay in touch.`,
        ``,
        `If anything's changed on your end, I'm always here.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    default:
      return `Hey ${name}, just checking in. — ${botName}`;
  }
}

// ---------------------------------------------------------------------------
// Score penalty helper
// ---------------------------------------------------------------------------

function applyScorePenalty(leadId: string, workdir: string): void {
  const leads = loadLeads(workdir);
  const lead = leads[leadId];
  if (!lead) return;
  (lead as Record<string, unknown>)["intentScore"] = Math.max(0, ((lead.intentScore ?? 50) as number) - 15);
  (lead as Record<string, unknown>)["needsRecalculate"] = true;
  leads[leadId] = lead;
  saveLeads(workdir, leads);
}

function markLeadOptedOut(leadId: string, workdir: string): void {
  const leads = loadLeads(workdir);
  const lead = leads[leadId];
  if (!lead) return;
  lead.optedOut = true;
  (lead as Record<string, unknown>)["optedOutAt"] = new Date().toISOString();
  (lead as Record<string, unknown>)["builderScore"] = 0;
  (lead as Record<string, unknown>)["customerScore"] = 0;
  (lead as Record<string, unknown>)["qualified"] = false;
  leads[leadId] = lead;
  saveLeads(workdir, leads);
}

// ---------------------------------------------------------------------------
// Build next touch record
// ---------------------------------------------------------------------------

function buildNextTouch(
  record: NurtureRecord,
  onboard: OnboardState,
  touchNumber: number,
  scheduledFor: string,
  gapAnswer?: string
): TouchRecord {
  const touchType = touchTypeForNumber(touchNumber, record);
  const messageText = buildTouchMessage(touchType, record, onboard, gapAnswer);

  return {
    touchNumber,
    type: touchType,
    messageText,
    scheduledFor,
  };
}

// ---------------------------------------------------------------------------
// Transition to slow drip
// ---------------------------------------------------------------------------

function transitionToSlowDrip(
  record: NurtureRecord,
  store: NurtureStore,
  workdir: string,
  onboard: OnboardState,
  logger: ToolContext["logger"]
): void {
  record.status = "slow_drip";
  record.currentTouchNumber = 0;
  // Schedule first drip 30 days from now
  const nextDrip = slowDripNextDate();
  record.nextTouchScheduledFor = nextDrip;

  logger.info("tiger_nurture: transitioned to slow drip", {
    nurtureId: record.id,
    leadDisplayName: record.leadDisplayName,
    nextDrip,
  });

  store[record.id] = record;
  saveNurture(workdir, store);
}

// ---------------------------------------------------------------------------
// Action: enroll
// ---------------------------------------------------------------------------

interface EnrollParams {
  action: "enroll";
  leadId: string;
  oar?: "builder" | "customer";
}

function handleEnroll(
  params: EnrollParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const leads = loadLeads(workdir);
  const lead = leads[params.leadId];

  if (!lead) return { ok: false, error: `Lead ${params.leadId} not found.` };
  if (lead.optedOut) return { ok: false, error: `${lead.displayName} has opted out — cannot enroll.` };

  const onboard = loadOnboardState(workdir);
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const store = loadNurture(workdir);

  // Check for already-active nurture
  const existing = Object.values(store).find(
    (r) => r.leadId === params.leadId && ["active", "accelerated", "gap_closing"].includes(r.status)
  );
  if (existing) {
    return {
      ok: true,
      output: `${lead.displayName} is already in an active nurture sequence (touch ${existing.currentTouchNumber}).`,
      data: { nurtureId: existing.id, status: existing.status, skipped: true },
    };
  }

  const oar = (params.oar ?? lead.oar ?? "builder") as "builder" | "customer";
  const enrolledAt = new Date().toISOString();
  const id = crypto.randomUUID();

  const record: NurtureRecord = {
    id,
    leadId: params.leadId,
    leadDisplayName: lead.displayName,
    platform: lead.platform,
    oar,
    enrolledAt,
    status: "active",
    currentTouchNumber: 0,
    touchHistory: [],
    consecutiveNoResponses: 0,
    oneToTenRound: 0,
    slowDripCount: 0,
  };

  // Build and schedule Touch 1 immediately
  const touch1 = buildNextTouch(record, onboard, 1, enrolledAt);
  record.touchHistory.push(touch1);
  record.currentTouchNumber = 1;
  record.nextTouchScheduledFor = enrolledAt;

  store[id] = record;
  saveNurture(workdir, store);

  logger.info("tiger_nurture: enrolled", {
    nurtureId: id,
    leadDisplayName: lead.displayName,
    oar,
  });

  return {
    ok: true,
    output: [
      `${lead.displayName} enrolled in 30-day nurture sequence.`,
      `Touch 1 (value drop) is ready to send now.`,
      `Run tiger_nurture check to surface it.`,
    ].join("\n"),
    data: {
      nurtureId: id,
      leadId: params.leadId,
      leadDisplayName: lead.displayName,
      oar,
      status: "active",
      firstTouchReady: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: check (cron — surfaces due touches)
// ---------------------------------------------------------------------------

function handleCheck(workdir: string, logger: ToolContext["logger"]): ToolResult {
  const store = loadNurture(workdir);
  const now = new Date().toISOString();

  const due: Array<{
    nurtureId: string;
    leadId: string;
    leadDisplayName: string;
    platform: string;
    touchNumber: number;
    touchType: TouchType;
    messageText: string;
    isSlowDrip: boolean;
  }> = [];

  // Check 30-day expiry on active sequences
  const onboard = loadOnboardState(workdir);

  for (const record of Object.values(store)) {
    if (!["active", "accelerated", "gap_closing", "slow_drip"].includes(record.status)) continue;

    // 30-day expiry check for active sequences
    if (["active", "accelerated", "gap_closing"].includes(record.status) && onboard) {
      const daysSinceEnrollment =
        (Date.now() - new Date(record.enrolledAt).getTime()) / 86400000;
      if (daysSinceEnrollment >= NURTURE_WINDOW_DAYS && record.currentTouchNumber < TOTAL_TOUCHES) {
        // 30 days passed without conversion — final takeaway, transition to slow drip
        const finalMsg = buildTouchMessage("final_takeaway", record, onboard);
        due.push({
          nurtureId: record.id,
          leadId: record.leadId,
          leadDisplayName: record.leadDisplayName,
          platform: record.platform,
          touchNumber: 0,
          touchType: "final_takeaway",
          messageText: finalMsg,
          isSlowDrip: false,
        });
        transitionToSlowDrip(record, store, workdir, onboard, logger);
        continue;
      }
    }

    if (!record.nextTouchScheduledFor || record.nextTouchScheduledFor > now) continue;

    // Get the current scheduled touch
    const currentTouch = record.touchHistory.find(
      (t) => t.touchNumber === record.currentTouchNumber && !t.sentAt
    );

    if (record.status === "slow_drip") {
      // Slow drip due
      if (onboard) {
        const drip = buildTouchMessage("slow_drip_value", record, onboard);
        due.push({
          nurtureId: record.id,
          leadId: record.leadId,
          leadDisplayName: record.leadDisplayName,
          platform: record.platform,
          touchNumber: record.slowDripCount + 1,
          touchType: "slow_drip_value",
          messageText: drip,
          isSlowDrip: true,
        });
      }
      continue;
    }

    if (currentTouch) {
      due.push({
        nurtureId: record.id,
        leadId: record.leadId,
        leadDisplayName: record.leadDisplayName,
        platform: record.platform,
        touchNumber: currentTouch.touchNumber,
        touchType: currentTouch.type,
        messageText: currentTouch.messageText,
        isSlowDrip: false,
      });
    }
  }

  logger.info("tiger_nurture: check", { dueCount: due.length });

  if (due.length === 0) {
    return {
      ok: true,
      output: "No nurture touches due right now.",
      data: { due: [] },
    };
  }

  const lines = [`${due.length} nurture touch(es) due:`];
  for (const d of due) {
    const tag = d.isSlowDrip ? "[slow drip]" : `[touch ${d.touchNumber}]`;
    lines.push(`  • ${tag} ${d.leadDisplayName} (${d.platform}) — ${d.touchType}`);
  }
  lines.push(``, `For each: send message via channel, then call mark_sent with nurtureId.`);

  return {
    ok: true,
    output: lines.join("\n"),
    data: { due },
  };
}

// ---------------------------------------------------------------------------
// Action: mark_sent
// ---------------------------------------------------------------------------

interface MarkSentParams {
  action: "mark_sent";
  nurtureId: string;
  isSlowDrip?: boolean;
}

function handleMarkSent(
  params: MarkSentParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const store = loadNurture(workdir);
  const record = store[params.nurtureId];
  if (!record) return { ok: false, error: `Nurture record ${params.nurtureId} not found.` };

  const now = new Date().toISOString();

  if (params.isSlowDrip || record.status === "slow_drip") {
    record.slowDripCount++;
    record.slowDripLastSentAt = now;
    record.lastTouchSentAt = now;

    if (record.slowDripCount >= SLOW_DRIP_MAX_COUNT) {
      record.status = "archived";
      record.completedAt = now;
      store[params.nurtureId] = record;
      saveNurture(workdir, store);
      return {
        ok: true,
        output: `${record.leadDisplayName}: slow drip complete (3 of 3 sent). Archiving — no further contact.`,
        data: { nurtureId: params.nurtureId, status: "archived" },
      };
    }

    // Schedule next drip
    record.nextTouchScheduledFor = slowDripNextDate(now);
    store[params.nurtureId] = record;
    saveNurture(workdir, store);

    return {
      ok: true,
      output: `${record.leadDisplayName}: slow drip ${record.slowDripCount}/${SLOW_DRIP_MAX_COUNT} sent. Next in 30 days.`,
      data: { nurtureId: params.nurtureId, slowDripCount: record.slowDripCount },
    };
  }

  // Mark regular touch as sent
  const touch = record.touchHistory.find((t) => t.touchNumber === record.currentTouchNumber);
  if (!touch) return { ok: false, error: `No pending touch found for nurture ${params.nurtureId}.` };

  touch.sentAt = now;
  record.lastTouchSentAt = now;
  store[params.nurtureId] = record;
  saveNurture(workdir, store);

  logger.info("tiger_nurture: touch marked sent", {
    nurtureId: params.nurtureId,
    touchNumber: touch.touchNumber,
    touchType: touch.type,
  });

  return {
    ok: true,
    output: `${record.leadDisplayName}: touch ${touch.touchNumber} (${touch.type}) sent. Watching for response.`,
    data: { nurtureId: params.nurtureId, touchNumber: touch.touchNumber, touchType: touch.type },
  };
}

// ---------------------------------------------------------------------------
// Action: record_response — the full nurture state machine
// ---------------------------------------------------------------------------

type NurtureResponseClassification = "hot" | "warm" | "neutral" | "no_response" | "opted_out";

interface RecordResponseParams {
  action: "record_response";
  nurtureId: string;
  classification: NurtureResponseClassification;
  responseText?: string;
  oneToTenScore?: number;  // If this was a 1-10 response, the number they gave
}

function handleRecordResponse(
  params: RecordResponseParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const store = loadNurture(workdir);
  const record = store[params.nurtureId];
  if (!record) return { ok: false, error: `Nurture record ${params.nurtureId} not found.` };

  const onboard = loadOnboardState(workdir);
  if (!onboard) return { ok: false, error: "Onboarding state not found." };

  const now = new Date().toISOString();
  const touch = record.touchHistory.find((t) => t.touchNumber === record.currentTouchNumber);

  if (touch) {
    touch.responseText = params.responseText;
    touch.responseAt = now;
    touch.responseClassification = params.classification;
    if (params.oneToTenScore !== undefined) {
      touch.oneToTenScore = params.oneToTenScore;
      record.lastOneToTenScore = params.oneToTenScore;
    }
  }

  logger.info("tiger_nurture: response recorded", {
    nurtureId: params.nurtureId,
    touchNumber: record.currentTouchNumber,
    classification: params.classification,
    oneToTenScore: params.oneToTenScore,
  });

  // ---- EXIT CONDITIONS (LOCKED) ----

  // 1. Explicit opt-out → PERMANENT
  if (params.classification === "opted_out") {
    record.status = "opted_out";
    record.completedAt = now;
    store[params.nurtureId] = record;
    saveNurture(workdir, store);
    markLeadOptedOut(record.leadId, workdir);

    return {
      ok: true,
      output: `${record.leadDisplayName} opted out. Permanently removed. No further contact ever.`,
      data: { nurtureId: params.nurtureId, status: "opted_out", permanent: true },
    };
  }

  // 2. 1-10 score — the critical branch
  if (params.oneToTenScore !== undefined) {
    const score = params.oneToTenScore;

    // 8-10 → Conversion
    if (score >= 8) {
      record.status = "converted";
      record.convertedAt = now;
      record.completedAt = now;
      store[params.nurtureId] = record;
      saveNurture(workdir, store);

      return {
        ok: true,
        output: [
          `🎯 ${record.leadDisplayName} scored ${score}/10 — READY FOR CONVERSION.`,
          `Call tiger_convert with leadId: '${record.leadId}' to begin the three-way handoff.`,
        ].join("\n"),
        data: {
          nurtureId: params.nurtureId,
          status: "converted",
          score,
          action: "start_conversion",
          leadId: record.leadId,
        },
      };
    }

    // 5 or below → Immediate takeaway
    if (score <= 5) {
      transitionToSlowDrip(record, store, workdir, onboard, logger);
      return {
        ok: true,
        output: [
          `${record.leadDisplayName} scored ${score}/10. Moving to slow drip — 1 touch/month for 3 months.`,
          `No chasing. If they re-engage, we re-enter nurture.`,
        ].join("\n"),
        data: { nurtureId: params.nurtureId, status: "slow_drip", score },
      };
    }

    // 6-7 → Part 2 or gap-closing
    if (score >= 6 && score <= 7) {
      if (record.currentTouchNumber === 5) {
        // Just finished Part 1 — schedule Part 2 accelerated
        record.oneToTenRound++;
        const nextScheduled = acceleratedNextTouch();
        const part2Touch = buildNextTouch(record, onboard, 6, nextScheduled);
        record.touchHistory.push(part2Touch);
        record.currentTouchNumber = 6;
        record.nextTouchScheduledFor = nextScheduled;
        record.status = "gap_closing";
        store[params.nurtureId] = record;
        saveNurture(workdir, store);

        return {
          ok: true,
          output: [
            `${record.leadDisplayName} scored ${score}/10. Sending Part 2 in 24 hours.`,
            `"What would you need to know to be a 10?"`,
          ].join("\n"),
          data: { nurtureId: params.nurtureId, status: "gap_closing", score, round: record.oneToTenRound },
        };
      }

      // In gap-closing — they answered Part 2 — deliver objection response
      if (record.status === "gap_closing" && params.responseText) {
        record.lastGapAnswer = params.responseText;
        record.oneToTenRound++;

        if (record.oneToTenRound > 2) {
          // Exceeded max 2 rounds → takeaway
          transitionToSlowDrip(record, store, workdir, onboard, logger);
          return {
            ok: true,
            output: [
              `${record.leadDisplayName} has been at 6-7 through 2 full rounds. Moving to slow drip.`,
              `The flywheel keeps moving.`,
            ].join("\n"),
            data: { nurtureId: params.nurtureId, status: "slow_drip" },
          };
        }

        // Build gap-closing response touch
        const nextScheduled = acceleratedNextTouch();
        const gapTouch: TouchRecord = {
          touchNumber: record.currentTouchNumber + 1,
          type: "gap_closing",
          messageText: buildTouchMessage("gap_closing", record, onboard, params.responseText),
          scheduledFor: nextScheduled,
        };
        record.touchHistory.push(gapTouch);
        record.currentTouchNumber++;
        record.nextTouchScheduledFor = nextScheduled;
        store[params.nurtureId] = record;
        saveNurture(workdir, store);

        return {
          ok: true,
          output: [
            `${record.leadDisplayName} answered Part 2: "${params.responseText.slice(0, 80)}".`,
            `Gap-closing response ready (round ${record.oneToTenRound}/2). Sends in 24 hours.`,
          ].join("\n"),
          data: {
            nurtureId: params.nurtureId,
            status: "gap_closing",
            round: record.oneToTenRound,
            gapAnswer: params.responseText,
          },
        };
      }
    }
  }

  // 3. No response — track consecutives
  if (params.classification === "no_response") {
    record.consecutiveNoResponses++;

    if (record.consecutiveNoResponses >= 2) {
      // 2 consecutive no-responses → exit, score penalty, back to pool
      record.status = "back_to_pool";
      record.completedAt = now;
      store[params.nurtureId] = record;
      saveNurture(workdir, store);
      applyScorePenalty(record.leadId, workdir);

      return {
        ok: true,
        output: [
          `${record.leadDisplayName} hasn't responded to 2 consecutive touches. Exiting nurture.`,
          `Score penalty applied. Back to pool — if new signals appear they can re-enter.`,
        ].join("\n"),
        data: { nurtureId: params.nurtureId, status: "back_to_pool", leadId: record.leadId },
      };
    }

    // Just 1 no-response — continue sequence on standard schedule
    store[params.nurtureId] = record;
    saveNurture(workdir, store);
    return advanceToNextTouch(record, store, workdir, onboard, "standard");
  }

  // 4. Hot / warm response — reset no-response counter, advance (with acceleration if hot)
  record.consecutiveNoResponses = 0;
  store[params.nurtureId] = record;
  saveNurture(workdir, store);

  const cadence = params.classification === "hot" ? "accelerated" : "standard";
  return advanceToNextTouch(record, store, workdir, onboard, cadence);
}

// ---------------------------------------------------------------------------
// Advance to next touch helper
// ---------------------------------------------------------------------------

function advanceToNextTouch(
  record: NurtureRecord,
  store: NurtureStore,
  workdir: string,
  onboard: OnboardState,
  cadence: "standard" | "accelerated"
): ToolResult {
  const nextTouchNumber = record.currentTouchNumber + 1;

  if (nextTouchNumber > TOTAL_TOUCHES) {
    // Sequence complete — final takeaway + slow drip
    transitionToSlowDrip(record, store, workdir, onboard, { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
    return {
      ok: true,
      output: [
        `${record.leadDisplayName}: all 8 touches complete. Sending final takeaway and transitioning to slow drip (1/month for 3 months).`,
      ].join("\n"),
      data: { nurtureId: record.id, status: "slow_drip", touchesComplete: true },
    };
  }

  const scheduledFor = cadence === "accelerated"
    ? acceleratedNextTouch()
    : scheduledForTouch(nextTouchNumber, record.enrolledAt);

  const nextTouch = buildNextTouch(record, onboard, nextTouchNumber, scheduledFor);
  record.touchHistory.push(nextTouch);
  record.currentTouchNumber = nextTouchNumber;
  record.nextTouchScheduledFor = scheduledFor;
  record.status = cadence === "accelerated" ? "accelerated" : "active";

  store[record.id] = record;
  saveNurture(workdir, store);

  const cadenceLabel = cadence === "accelerated"
    ? "accelerated (24h — hot response!)"
    : `standard (${new Date(scheduledFor).toUTCString()})`;

  return {
    ok: true,
    output: `${record.leadDisplayName}: touch ${nextTouchNumber} scheduled — ${cadenceLabel}.`,
    data: {
      nurtureId: record.id,
      nextTouchNumber,
      touchType: nextTouch.type,
      scheduledFor,
      cadence,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

function handleList(workdir: string): ToolResult {
  const store = loadNurture(workdir);
  const all = Object.values(store);

  const byStatus: Record<string, number> = {};
  for (const r of all) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  const active = all.filter((r) =>
    ["active", "accelerated", "gap_closing"].includes(r.status)
  );

  const lines = [
    `Nurture Pipeline (${all.length} total)`,
    Object.entries(byStatus)
      .map(([s, n]) => `  ${s}: ${n}`)
      .join("\n"),
  ];

  if (active.length > 0) {
    lines.push(``, `Active sequences:`);
    for (const r of active) {
      const day = Math.floor(
        (Date.now() - new Date(r.enrolledAt).getTime()) / 86400000
      );
      const nextDue = r.nextTouchScheduledFor
        ? new Date(r.nextTouchScheduledFor).toUTCString()
        : "—";
      lines.push(
        `  • ${r.leadDisplayName} — Day ${day}/30, touch ${r.currentTouchNumber}/${TOTAL_TOUCHES} (${r.status}) — next: ${nextDue}`
      );
    }
  }

  return {
    ok: true,
    output: lines.join("\n"),
    data: { total: all.length, byStatus, active: active.length },
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

  logger.info("tiger_nurture called", { action });

  try {
    switch (action) {
      case "enroll":
        return handleEnroll(params as unknown as EnrollParams, workdir, logger);

      case "check":
        return handleCheck(workdir, logger);

      case "mark_sent":
        return handleMarkSent(params as unknown as MarkSentParams, workdir, logger);

      case "record_response":
        return handleRecordResponse(params as unknown as RecordResponseParams, workdir, logger);

      case "list":
        return handleList(workdir);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: enroll | check | mark_sent | record_response | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_nurture error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_nurture error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_nurture = {
  name: "tiger_nurture",
  description:
    "30-day nurture sequence engine. 8 touches, 3-4 day cadence. Touch types: value drop → testimonial → authority → check-in → 1-10 Part 1 → 1-10 Part 2/gap-closing → scarcity → pattern interrupt. Adaptive acceleration on hot responses (24h). Full 1-10 framework with 2-round gap-closing. All 6 exit conditions: 8-10=conversion, 6-7 after 2 rounds=slow drip, ≤5=slow drip, 2 consecutive no-response=back to pool, opt-out=permanent, 30-day expiry=slow drip. Slow drip: 1/month × 3, then archive. Cron calls 'check' hourly.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["enroll", "check", "mark_sent", "record_response", "list"],
        description:
          "enroll: start 30-day sequence for a lead. check: cron — surfaces due touches. mark_sent: confirm touch was sent via channel. record_response: process prospect's reply to advance state machine. list: show full nurture pipeline.",
      },
      leadId: {
        type: "string",
        description: "Lead UUID from leads.json. Required for enroll.",
      },
      oar: {
        type: "string",
        enum: ["builder", "customer"],
        description: "Which oar to nurture. Defaults to lead's primaryOar.",
      },
      nurtureId: {
        type: "string",
        description: "Nurture record UUID. Required for mark_sent and record_response.",
      },
      isSlowDrip: {
        type: "boolean",
        description: "True if marking a slow drip touch as sent.",
      },
      classification: {
        type: "string",
        enum: ["hot", "warm", "neutral", "no_response", "opted_out"],
        description:
          "hot: enthusiastic, positive. warm: positive but mild. neutral: neither yes nor no. no_response: no reply. opted_out: explicitly said no/stop.",
      },
      responseText: {
        type: "string",
        description: "Actual text of the prospect's response (for gap-closing context).",
      },
      oneToTenScore: {
        type: "number",
        minimum: 1,
        maximum: 10,
        description: "The number the prospect gave in response to the 1-10 question.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_nurture;
