// Tiger Claw — tiger_convert Tool
// Stage 4: Conversion — Block 3.7 of TIGERCLAW-MASTER-SPEC-v2.md
//
// LOCKED decisions:
//   #34 — Business builder conversion = three-way handoff with full edification
//   #35 — Full prospect briefing to tenant: score, journey, gap addressed
//   #36 — Bot steps back after introduction; tenant owns the relationship
//   Customer conversion — bot closes autonomously; tenant notified after
//
// Two oar paths:
//
//   BUILDER oar — The Three-Way Handoff (mirrors the three-way call framework):
//     Step 1: Bot briefs tenant — who this is, score, what excited them,
//             their objection from 1-10 Part 2, how it was addressed.
//     Step 2: Bot edifies tenant to prospect — credentials, story, why tenant
//             is special, "they've agreed to personally spend time with you."
//     Step 3: Bot connects them — tenant's contact info or schedule preference.
//     Step 4: Bot steps back. Tenant owns the relationship from here.
//
//   CUSTOMER oar — Autonomous close:
//     Bot walks customer through the purchase action (flavor-defined).
//     Tenant notified after. Moves directly to Aftercare.
//
// Flavor-specific conversion meanings (LOCKED):
//   network-marketer / builder  → sign up as a distributor
//   network-marketer / customer → place first order
//   real-estate                 → book a showing or sign a listing agreement
//   health-wellness             → book an appointment or purchase a service
//
// Actions:
//   initiate  — called when prospect scores 8+ (from tiger_nurture).
//               Generates all messages, returns them for agent to deliver.
//   confirm   — tenant confirms they connected; marks conversion complete.
//               Triggers signal to start tiger_aftercare.
//   list      — show all conversions with status.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConversionOar = "builder" | "customer";

type ConversionStatus =
  | "pending_delivery"    // Messages generated, agent hasn't delivered yet
  | "tenant_briefed"      // Tenant received briefing; waiting for them to connect
  | "prospect_edified"    // Prospect received edification message
  | "connected"           // Bot made the connection — both parties aware
  | "confirmed"           // Tenant confirmed they spoke / converted
  | "customer_closed"     // Customer oar: bot closed autonomously
  | "no_show"             // Prospect went cold after being told about tenant
  | "cancelled";          // Tenant cancelled the handoff

interface NurtureTouch {
  touchNumber: number;
  type: string;
  messageText: string;
  sentAt?: string;
  responseAt?: string;
  responseClassification?: string;
  oneToTenScore?: number;
}

interface NurtureRecord {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  oar: string;
  enrolledAt: string;
  status: string;
  touchHistory: NurtureTouch[];
  lastOneToTenScore?: number;
  lastGapAnswer?: string;
  oneToTenRound: number;
  [key: string]: unknown;
}

interface LeadRecord {
  id: string;
  platform: string;
  platformId?: string;
  displayName: string;
  profileUrl?: string;
  profileFit: number;
  intentScore: number;
  oar: string;
  qualified: boolean;
  optedOut: boolean;
  builderScore?: number;
  customerScore?: number;
  intentSignalHistory: Array<{ type: string; excerpt?: string }>;
  converted?: boolean;
  convertedAt?: string;
  [key: string]: unknown;
}

interface OnboardState {
  phase: string;
  flavor: string;
  identity: {
    name?: string;
    productOrOpportunity?: string;
    yearsInProfession?: string;
    biggestWin?: string;
    differentiator?: string;
    contactPreference?: string;   // "telegram", "whatsapp", "phone", etc.
    contactHandle?: string;       // @handle, phone number, etc.
  };
  botName?: string;
}

interface ConversionRecord {
  id: string;
  leadId: string;
  nurtureId: string;
  leadDisplayName: string;
  platform: string;
  oar: ConversionOar;
  flavor: string;
  score: number;
  status: ConversionStatus;

  // Generated messages (builder path)
  tenantBriefText?: string;
  prospectEdificationText?: string;
  connectionText?: string;

  // Generated messages (customer path)
  autonomousCloseText?: string;
  tenantNotificationText?: string;

  // Journey summary (used in both paths)
  journeySummary: {
    touchesCompleted: number;
    daysInNurture: number;
    gapAnswer?: string;         // What they said in 1-10 Part 2
    gapAddressed?: string;      // Summary of how it was addressed
    excitementSignal?: string;  // Their most positive response excerpt
  };

  initiatedAt: string;
  tenantBriefedAt?: string;
  prospectEdifiedAt?: string;
  connectedAt?: string;
  confirmedAt?: string;
  tenantNotifiedAt?: string;
}

interface ConversionsStore {
  [conversionId: string]: ConversionRecord;
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

// ---------------------------------------------------------------------------
// Flavor helpers
// ---------------------------------------------------------------------------

function conversionGoal(flavor: string, oar: ConversionOar): string {
  const map: Record<string, Record<ConversionOar, string>> = {
    "network-marketer": {
      builder: "sign up as a distributor",
      customer: "place their first order",
    },
    "real-estate": {
      builder: "sign a listing agreement or booking agreement",
      customer: "book a showing",
    },
    "health-wellness": {
      builder: "book a consultation appointment",
      customer: "book an appointment or purchase a service",
    },
  };
  return map[flavor]?.[oar] ?? "take the next step";
}

// ---------------------------------------------------------------------------
// Journey summary extraction from nurture record
// ---------------------------------------------------------------------------

function extractJourneySummary(nurture: NurtureRecord): ConversionRecord["journeySummary"] {
  const sent = nurture.touchHistory.filter((t) => t.sentAt);
  const touchesCompleted = sent.length;
  const daysInNurture = Math.floor(
    (Date.now() - new Date(nurture.enrolledAt).getTime()) / 86400000
  );

  // Find gap answer from 1-10 Part 2 response
  const gapAnswer = nurture.lastGapAnswer;

  // Find what was used to address the gap (gap_closing touch)
  const gapClosingTouch = sent.find((t) => t.type === "gap_closing");
  const gapAddressed = gapClosingTouch
    ? "I shared context on the tenant's background and addressed the concern directly."
    : undefined;

  // Find the most positive / enthusiastic response
  const hotTouch = sent
    .filter((t) => t.responseClassification === "hot")
    .sort((a, b) => (a.responseAt ?? "") < (b.responseAt ?? "") ? 1 : -1)[0];
  const excitementSignal = hotTouch?.type
    ? `They responded warmly to the ${hotTouch.type.replace(/_/g, " ")} touch.`
    : undefined;

  return { touchesCompleted, daysInNurture, gapAnswer, gapAddressed, excitementSignal };
}

// ---------------------------------------------------------------------------
// Message generators
// ---------------------------------------------------------------------------

// BUILDER STEP 1: Full prospect briefing to tenant
function buildTenantBriefText(
  lead: LeadRecord,
  nurture: NurtureRecord,
  journey: ConversionRecord["journeySummary"],
  score: number,
  goal: string,
  botName: string
): string {
  const lines: string[] = [];

  lines.push(`🎯 ${lead.displayName} is ready.`);
  lines.push(``);
  lines.push(`Score: ${score}/100 — qualified for conversion.`);
  lines.push(`Goal: ${goal}.`);
  lines.push(`Days in nurture: ${journey.daysInNurture}. Touches completed: ${journey.touchesCompleted}.`);
  lines.push(``);

  if (journey.excitementSignal) {
    lines.push(`What resonated: ${journey.excitementSignal}`);
  }

  if (journey.gapAnswer) {
    lines.push(`Their concern (from the 1-10 question): "${journey.gapAnswer}"`);
    if (journey.gapAddressed) {
      lines.push(`How I addressed it: ${journey.gapAddressed}`);
    }
  }

  lines.push(``);
  lines.push(`They're expecting to hear from you.`);
  lines.push(`I've already sent them the edification message — they know who you are.`);
  lines.push(``);
  lines.push(`When you're ready, reach out directly. I'll step back.`);
  lines.push(``);
  lines.push(`— ${botName}`);

  return lines.join("\n");
}

// BUILDER STEP 2: Prospect edification — warm handoff message
function buildProspectEdificationText(
  lead: LeadRecord,
  onboard: OnboardState,
  journey: ConversionRecord["journeySummary"],
  botName: string
): string {
  const tenantName = onboard.identity.name ?? "my operator";
  const years = onboard.identity.yearsInProfession ?? "several years";
  const biggestWin = onboard.identity.biggestWin ?? "built something impressive in this space";
  const differentiator = onboard.identity.differentiator ?? "takes a different approach to this than anyone else I know";

  const lines: string[] = [];

  lines.push(`Hey ${lead.displayName},`);
  lines.push(``);
  lines.push(`I've really enjoyed our conversation.`);
  lines.push(``);
  lines.push(`I'd like to introduce you to ${tenantName}.`);
  lines.push(``);
  lines.push(`${tenantName} has been doing this for ${years}. ${biggestWin}. What makes them genuinely different: ${differentiator}.`);
  lines.push(``);
  lines.push(`They don't do this for everyone. They're selective about who they personally spend time with — and based on everything you've shared with me, I genuinely think you're exactly the kind of person they want to work with.`);
  lines.push(``);

  if (journey.gapAnswer) {
    lines.push(`I know you had a question about "${journey.gapAnswer}" — that's exactly the kind of thing ${tenantName} has walked people through before. They can speak to that directly.`);
    lines.push(``);
  }

  lines.push(`They'll be reaching out to you directly. I hope you give the conversation a real shot.`);
  lines.push(``);
  lines.push(`— ${botName}`);

  return lines.join("\n");
}

// BUILDER STEP 3: Connection message — introduces both parties, provides contact info
function buildConnectionText(
  lead: LeadRecord,
  onboard: OnboardState,
  botName: string
): string {
  const tenantName = onboard.identity.name ?? "my operator";
  const contactPref = onboard.identity.contactPreference ?? "their preferred channel";
  const contactHandle = onboard.identity.contactHandle
    ? `(${onboard.identity.contactHandle})`
    : "";

  const lines: string[] = [];

  lines.push(`${lead.displayName}, meet ${tenantName}.`);
  lines.push(`${tenantName}, meet ${lead.displayName}.`);
  lines.push(``);
  lines.push(`${tenantName} — you can reach ${lead.displayName} here on ${lead.platform}.`);
  lines.push(`${lead.displayName} — ${tenantName} is best reached via ${contactPref} ${contactHandle}.`.trim());
  lines.push(``);
  lines.push(`I'll let the two of you take it from here. I'm stepping back.`);
  lines.push(``);
  lines.push(`— ${botName}`);

  return lines.join("\n");
}

// CUSTOMER: Autonomous close message
function buildAutonomousCloseText(
  lead: LeadRecord,
  onboard: OnboardState,
  goal: string,
  botName: string
): string {
  const product = onboard.identity.productOrOpportunity ?? "the product";
  const tenantName = onboard.identity.name ?? "my operator";

  const lines: string[] = [];

  lines.push(`Hey ${lead.displayName},`);
  lines.push(``);
  lines.push(`I think we're both on the same page here. You've asked the right questions, and honestly, I think this is a good fit for you.`);
  lines.push(``);
  lines.push(`The next step is simple: ${goal}. ${tenantName} works with ${product} and you'll be in good hands.`);
  lines.push(``);
  lines.push(`Here's what I need from you: just say yes. I'll give you everything you need to take that next step right now.`);
  lines.push(``);
  lines.push(`— ${botName}`);

  return lines.join("\n");
}

// CUSTOMER: Tenant notification after close
function buildCustomerTenantNotification(
  lead: LeadRecord,
  journey: ConversionRecord["journeySummary"],
  score: number,
  goal: string,
  botName: string
): string {
  const lines: string[] = [];

  lines.push(`✅ Customer conversion completed.`);
  lines.push(``);
  lines.push(`${lead.displayName} (${lead.platform}) — score ${score}.`);
  lines.push(`Outcome: ${goal}.`);
  lines.push(`Days in nurture: ${journey.daysInNurture}. Touches: ${journey.touchesCompleted}.`);
  lines.push(``);
  lines.push(`They've been moved to Aftercare. No action needed from you.`);
  lines.push(``);
  lines.push(`— ${botName}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Action: initiate
// ---------------------------------------------------------------------------

interface InitiateParams {
  action: "initiate";
  leadId: string;
  nurtureId: string;
}

async function handleInitiate(
  params: InitiateParams,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const leads = await loadJson<Record<string, LeadRecord>>(context, "leads.json") ?? {};
  const nurtures = await loadJson<Record<string, NurtureRecord>>(context, "nurture.json") ?? {};
  const onboard = await loadJson<OnboardState>(context, "onboard_state.json");

  const lead = leads[params.leadId];
  if (!lead) return { ok: false, error: `Lead ${params.leadId} not found.` };
  if (lead.optedOut) return { ok: false, error: `${lead.displayName} has opted out — cannot convert.` };

  const nurture = nurtures[params.nurtureId];
  if (!nurture) return { ok: false, error: `Nurture record ${params.nurtureId} not found.` };

  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete. Cannot initiate conversion." };
  }

  const store = await loadJson<ConversionsStore>(context, "conversions.json") ?? {};

  // Check for existing active conversion
  const existing = Object.values(store).find(
    (r) =>
      r.leadId === params.leadId &&
      !["confirmed", "customer_closed", "cancelled", "no_show"].includes(r.status)
  );
  if (existing) {
    return {
      ok: true,
      output: `${lead.displayName} already has an active conversion in progress (${existing.status}).`,
      data: { conversionId: existing.id, status: existing.status, skipped: true },
    };
  }

  const oar = (nurture.oar ?? lead.oar ?? "builder") as ConversionOar;
  const score = nurture.lastOneToTenScore
    ? nurture.lastOneToTenScore * 10
    : Math.round(((lead.profileFit ?? 0) + (lead.intentScore ?? 0)) / 2);
  const flavor = onboard.flavor ?? "network-marketer";
  const goal = conversionGoal(flavor, oar);
  const botName = onboard.botName ?? "your Tiger Claw bot";
  const journey = extractJourneySummary(nurture);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const record: ConversionRecord = {
    id,
    leadId: params.leadId,
    nurtureId: params.nurtureId,
    leadDisplayName: lead.displayName,
    platform: lead.platform,
    oar,
    flavor,
    score,
    status: "pending_delivery",
    journeySummary: journey,
    initiatedAt: now,
  };

  const outputLines: string[] = [];

  if (oar === "builder") {
    record.tenantBriefText = buildTenantBriefText(lead, nurture, journey, score, goal, botName);
    record.prospectEdificationText = buildProspectEdificationText(lead, onboard, journey, botName);
    record.connectionText = buildConnectionText(lead, onboard, botName);

    outputLines.push(`THREE-WAY HANDOFF READY — ${lead.displayName} (${lead.platform})`);
    outputLines.push(`Score: ${score} | Days in nurture: ${journey.daysInNurture} | Goal: ${goal}`);
    outputLines.push(``);
    outputLines.push(`STEP 1 — Send this to TENANT:`);
    outputLines.push(`---`);
    outputLines.push(record.tenantBriefText);
    outputLines.push(`---`);
    outputLines.push(``);
    outputLines.push(`STEP 2 — Send this to PROSPECT (${lead.displayName}):`);
    outputLines.push(`---`);
    outputLines.push(record.prospectEdificationText);
    outputLines.push(`---`);
    outputLines.push(``);
    outputLines.push(`STEP 3 — Send this CONNECTION message in shared channel:`);
    outputLines.push(`---`);
    outputLines.push(record.connectionText);
    outputLines.push(`---`);
    outputLines.push(``);
    outputLines.push(`After all three messages are delivered: call mark_sent for each step.`);
    outputLines.push(`When tenant confirms they connected: call tiger_convert confirm conversionId: '${id}'`);
    outputLines.push(`Then call tiger_aftercare enroll with leadId: '${params.leadId}' oar: 'builder'`);
  } else {
    // Customer oar — autonomous close
    record.autonomousCloseText = buildAutonomousCloseText(lead, onboard, goal, botName);
    record.tenantNotificationText = buildCustomerTenantNotification(lead, journey, score, goal, botName);

    outputLines.push(`CUSTOMER AUTONOMOUS CLOSE — ${lead.displayName} (${lead.platform})`);
    outputLines.push(`Score: ${score} | Goal: ${goal}`);
    outputLines.push(``);
    outputLines.push(`SEND TO PROSPECT (${lead.displayName}):`);
    outputLines.push(`---`);
    outputLines.push(record.autonomousCloseText);
    outputLines.push(`---`);
    outputLines.push(``);
    outputLines.push(`After prospect confirms purchase, send to TENANT:`);
    outputLines.push(`---`);
    outputLines.push(record.tenantNotificationText);
    outputLines.push(`---`);
    outputLines.push(``);
    outputLines.push(`Then call tiger_convert confirm conversionId: '${id}'`);
    outputLines.push(`Then call tiger_aftercare enroll with leadId: '${params.leadId}' oar: 'customer'`);
  }

  // Persist conversion record
  store[id] = record;
  await saveJson(context, "conversions.json", store);

  // Mark lead as conversion in progress in leads.json
  lead.converted = false; // will be set true on confirm
  leads[params.leadId] = lead;
  await saveJson(context, "leads.json", leads);

  logger.info("tiger_convert: initiated", {
    conversionId: id,
    leadDisplayName: lead.displayName,
    oar,
    score,
  });

  return {
    ok: true,
    output: outputLines.join("\n"),
    data: {
      conversionId: id,
      leadId: params.leadId,
      leadDisplayName: lead.displayName,
      oar,
      score,
      goal,
      status: "pending_delivery",
      ...(oar === "builder"
        ? {
          tenantBriefText: record.tenantBriefText,
          prospectEdificationText: record.prospectEdificationText,
          connectionText: record.connectionText,
        }
        : {
          autonomousCloseText: record.autonomousCloseText,
          tenantNotificationText: record.tenantNotificationText,
        }),
    },
  };
}

// ---------------------------------------------------------------------------
// Action: mark_sent — advance conversion delivery status
// ---------------------------------------------------------------------------

interface MarkSentParams {
  action: "mark_sent";
  conversionId: string;
  step: "tenant_briefed" | "prospect_edified" | "connected" | "tenant_notified";
}

async function handleMarkSent(
  params: MarkSentParams,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const store = await loadJson<ConversionsStore>(context, "conversions.json") ?? {};
  const record = store[params.conversionId];
  if (!record) return { ok: false, error: `Conversion ${params.conversionId} not found.` };

  const now = new Date().toISOString();

  switch (params.step) {
    case "tenant_briefed":
      record.tenantBriefedAt = now;
      record.status = "tenant_briefed";
      break;
    case "prospect_edified":
      record.prospectEdifiedAt = now;
      record.status = "prospect_edified";
      break;
    case "connected":
      record.connectedAt = now;
      record.status = "connected";
      break;
    case "tenant_notified":
      record.tenantNotifiedAt = now;
      record.status = "customer_closed";
      break;
    default:
      return { ok: false, error: `Unknown step: "${params.step}".` };
  }

  store[params.conversionId] = record;
  await saveJson(context, "conversions.json", store);

  logger.info("tiger_convert: mark_sent", {
    conversionId: params.conversionId,
    step: params.step,
    status: record.status,
  });

  const nextStep = {
    tenant_briefed: oar(record) === "builder"
      ? "Next: send prospectEdificationText to prospect, then call mark_sent step: 'prospect_edified'"
      : "Next: send autonomousCloseText to prospect, await their confirmation.",
    prospect_edified: "Next: send connectionText, then call mark_sent step: 'connected'",
    connected: "Bot has stepped back. Await tenant confirmation, then call tiger_convert confirm.",
    tenant_notified: "Customer conversion complete. Call tiger_aftercare enroll oar: 'customer'.",
  }[params.step] ?? "";

  return {
    ok: true,
    output: `${record.leadDisplayName}: step '${params.step}' recorded. ${nextStep}`,
    data: { conversionId: params.conversionId, status: record.status, step: params.step },
  };
}

function oar(record: ConversionRecord): string {
  return record.oar;
}

// ---------------------------------------------------------------------------
// Action: confirm — tenant confirmed the connection happened
// ---------------------------------------------------------------------------

interface ConfirmParams {
  action: "confirm";
  conversionId: string;
}

async function handleConfirm(
  params: ConfirmParams,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const store = await loadJson<ConversionsStore>(context, "conversions.json") ?? {};
  const record = store[params.conversionId];
  if (!record) return { ok: false, error: `Conversion ${params.conversionId} not found.` };

  const now = new Date().toISOString();
  record.confirmedAt = now;
  record.status = record.oar === "customer" ? "customer_closed" : "confirmed";

  store[params.conversionId] = record;
  await saveJson(context, "conversions.json", store);

  // Mark lead as converted + advance involvement: 1 (Engaged) → 2 (Customer)
  const leads = await loadJson<Record<string, LeadRecord>>(context, "leads.json") ?? {};
  const lead = leads[record.leadId];
  if (lead) {
    lead.converted = true;
    lead.convertedAt = now;
    if (((lead as Record<string, unknown>).involvementLevel as number ?? 0) < 2) {
      (lead as Record<string, unknown>).involvementLevel = 2;
    }
    leads[record.leadId] = lead;
    await saveJson(context, "leads.json", leads);
  }

  // Also update nurture record status
  const nurtures = await loadJson<Record<string, NurtureRecord>>(context, "nurture.json") ?? {};
  const nurture = nurtures[record.nurtureId];
  if (nurture) {
    (nurture as Record<string, unknown>)["completedAt"] = now;
    nurtures[record.nurtureId] = nurture;
    await saveJson(context, "nurture.json", nurtures);
  }

  logger.info("tiger_convert: confirmed", {
    conversionId: params.conversionId,
    leadDisplayName: record.leadDisplayName,
    oar: record.oar,
  });

  const aftercareInstruction =
    record.oar === "builder"
      ? `Now call tiger_aftercare enroll with leadId: '${record.leadId}' oar: 'builder' to start the new recruit support sequence.`
      : `Now call tiger_aftercare enroll with leadId: '${record.leadId}' oar: 'customer' to start the Bronze → Silver → Gold sequence.`;

  return {
    ok: true,
    output: [
      `✅ Conversion confirmed — ${record.leadDisplayName}.`,
      `Score: ${record.score} | Oar: ${record.oar} | Days in nurture: ${record.journeySummary.daysInNurture}.`,
      ``,
      aftercareInstruction,
    ].join("\n"),
    data: {
      conversionId: params.conversionId,
      leadId: record.leadId,
      status: record.status,
      confirmedAt: now,
      nextAction: "tiger_aftercare_enroll",
    },
  };
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

async function handleList(context: ToolContext): Promise<ToolResult> {
  const store = await loadJson<ConversionsStore>(context, "conversions.json") ?? {};
  const all = Object.values(store).sort((a, b) => (a.initiatedAt < b.initiatedAt ? 1 : -1));

  if (all.length === 0) {
    return { ok: true, output: "No conversions yet.", data: { conversions: [] } };
  }

  const byStatus: Record<string, number> = {};
  for (const r of all) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  const lines = [
    `Conversions (${all.length} total):`,
    Object.entries(byStatus).map(([s, n]) => `  ${s}: ${n}`).join("\n"),
    ``,
    `Recent:`,
    ...all.slice(0, 10).map((r) => {
      const date = r.confirmedAt ?? r.initiatedAt;
      return `  • ${r.leadDisplayName} (${r.platform}) — ${r.oar} | ${r.status} | score ${r.score} | ${new Date(date).toDateString()}`;
    }),
  ];

  return {
    ok: true,
    output: lines.join("\n"),
    data: { total: all.length, byStatus, conversions: all.slice(0, 10) },
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

  logger.info("tiger_convert called", { action });

  try {
    switch (action) {
      case "initiate":
        return await handleInitiate(params as unknown as InitiateParams, context, logger);

      case "mark_sent":
        return await handleMarkSent(params as unknown as MarkSentParams, context, logger);

      case "confirm":
        return await handleConfirm(params as unknown as ConfirmParams, context, logger);

      case "list":
        return await handleList(context);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: initiate | mark_sent | confirm | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_convert error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_convert error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_convert = {
  name: "tiger_convert",
  description:
    "Stage 4 Conversion handler. Two paths based on oar. BUILDER: Three-Way Handoff — generates full tenant briefing (score, journey, gap answered), prospect edification message, and connection message. Bot steps back after introduction; tenant owns the relationship. CUSTOMER: Autonomous close — bot walks customer through the purchase action, notifies tenant after. Both paths: call initiate → mark_sent for each delivery step → confirm when tenant verifies. Then call tiger_aftercare enroll to start aftercare.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["initiate", "mark_sent", "confirm", "list"],
        description:
          "initiate: generate all conversion messages (called after 8+ score from tiger_nurture). mark_sent: record delivery of each message step. confirm: tenant confirms connection happened — marks lead as converted. list: show all conversions.",
      },
      leadId: {
        type: "string",
        description: "Lead UUID from leads.json. Required for initiate.",
      },
      nurtureId: {
        type: "string",
        description: "Nurture record UUID from nurture.json. Required for initiate.",
      },
      conversionId: {
        type: "string",
        description: "Conversion record UUID. Required for mark_sent and confirm.",
      },
      step: {
        type: "string",
        enum: ["tenant_briefed", "prospect_edified", "connected", "tenant_notified"],
        description:
          "Delivery step for mark_sent. Builder sequence: tenant_briefed → prospect_edified → connected. Customer sequence: tenant_notified.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_convert;
