// Tiger Claw — tiger_briefing Tool
// Daily morning briefing — Block 3.6 (Daily Briefing) of TIGERCLAW-MASTER-SPEC-v2.md
//
// LOCKED decisions:
//   #33 — Daily briefing in preferred channel, NOT a dashboard to log into
//   #35 — Full prospect briefing to tenant (score, journey, objections addressed)
//   #11 — 3-Per-Day Rule: flag if fewer than 3 active conversations
//
// Cron fires at 7 AM tenant timezone (configured in entrypoint.sh / onboard_state).
// Tool generates the message text; the orchestrating agent delivers it via the
// tenant's preferred channel (Telegram / WhatsApp / etc.) from onboard_state.
//
// Sections (all data-driven, no hard-coded numbers):
//   1. Conversion-ready alerts — 8-10 scored leads waiting for handoff
//   2. Hot leads — active nurture/contact with positive engagement
//   3. Questions overnight — prospects who replied needing attention
//   4. New qualified leads — crossed 80-point threshold since last briefing
//   5. Nurture recommendations — who to prioritize today + 1-10 due
//   6. Warnings — consecutive no-responses, slow drip transitions
//   7. 3-Per-Day Rule check — flag if < 3 active conversations
//
// Actions:
//   generate   — build briefing from current state files and persist to briefing.json
//   mark_sent  — record delivery timestamp for today's briefing
//   history    — show last N briefing summaries

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types from other tools (minimal shape required)
// ---------------------------------------------------------------------------

interface LeadRecord {
  id: string;
  platform: string;
  displayName: string;
  profileFit: number;
  intentScore: number;
  oar: string;
  qualified: boolean;
  optedOut: boolean;
  builderScore?: number;
  customerScore?: number;
  discoveredAt?: string;
  qualifiedAt?: string;
}

interface NurtureRecord {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  oar: string;
  enrolledAt: string;
  status: string;
  currentTouchNumber: number;
  touchHistory: Array<{
    touchNumber: number;
    type: string;
    sentAt?: string;
    responseAt?: string;
    responseClassification?: string;
    oneToTenScore?: number;
  }>;
  consecutiveNoResponses: number;
  oneToTenRound: number;
  lastOneToTenScore?: number;
  nextTouchScheduledFor?: string;
  convertedAt?: string;
  slowDripCount?: number;
}

interface AftercareRecordBrief {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  oar: "builder" | "customer";
  status: string;
  tier?: string;
  nextTouchScheduledFor?: string;
  consecutiveNoResponses: number;
  flaggedInactiveAt?: string;
  flaggedForUpgradeAt?: string;
}

interface ContactRecord {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  status: string;
  strategy: string;
  scheduledFor: string;
  sentAt?: string;
  responseType?: string;
  responseAt?: string;
  queuedAt: string;
  followUpScheduledFor?: string;
}

interface OnboardState {
  phase: string;
  identity: {
    name?: string;
    preferredChannel?: string;
  };
  flavor: string;
}

interface BriefingEntry {
  date: string;             // YYYY-MM-DD
  generatedAt: string;      // ISO
  content: string;
  activeConversations: number;
  conversionReady: number;
  newQualified: number;
  sentAt?: string;
}

interface BriefingLog {
  [date: string]: BriefingEntry;
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

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

// ---------------------------------------------------------------------------
// Data aggregation helpers
// ---------------------------------------------------------------------------

interface BriefingData {
  tenantName: string;
  flavor: string;

  // Section 1: Conversion-ready
  conversionReady: NurtureRecord[];

  // Section 2: Hot leads (active nurture/contact with recent positive response)
  hotLeads: Array<{ name: string; platform: string; stage: string; detail: string }>;

  // Section 3: Overnight questions (positive/warm responses received since yesterday briefing)
  overnightQuestions: Array<{ name: string; platform: string; context: string }>;

  // Section 4: New qualified leads (qualified since yesterday)
  newQualified: LeadRecord[];

  // Section 5: Nurture recommendations
  touchesDueToday: NurtureRecord[];
  oneToTenDue: NurtureRecord[];     // In nurture Day 12+, haven't done 1-10 yet

  // Section 6: Warnings
  consecutiveNoResponseWarnings: NurtureRecord[];
  slowDripTransitions: NurtureRecord[];

  // Section 7: Active conversation count (for 3-per-day rule)
  activeConversations: number;

  // Section 8: Aftercare highlights
  aftercareActive: Array<{ name: string; platform: string; oar: string; tier?: string; status: string; nextTouch?: string }>;
  aftercareAlerts: Array<{ name: string; platform: string; alertType: string }>;
}

function aggregateData(workdir: string, lastBriefingAt?: string): BriefingData {
  const leads = loadJson<Record<string, LeadRecord>>(path.join(workdir, "leads.json")) ?? {};
  const nurture = loadJson<Record<string, NurtureRecord>>(path.join(workdir, "nurture.json")) ?? {};
  const contacts = loadJson<Record<string, ContactRecord>>(path.join(workdir, "contacts.json")) ?? {};
  const onboard = loadJson<OnboardState>(path.join(workdir, "onboard_state.json"));

  const tenantName = onboard?.identity?.name ?? "there";
  const flavor = onboard?.flavor ?? "network-marketer";
  const cutoff = lastBriefingAt ? new Date(lastBriefingAt) : yesterday();
  const now = new Date();

  // ---- Nurture categorization ----
  const allNurture = Object.values(nurture);
  const activeNurture = allNurture.filter((r) =>
    ["active", "accelerated", "gap_closing"].includes(r.status)
  );

  // Conversion-ready: scored 8+ since last briefing, ready for tiger_convert handoff
  const conversionReady = allNurture.filter(
    (r) => r.status === "converted" && r.convertedAt && new Date(r.convertedAt) > cutoff
  );

  // Nurture records with a positive response since cutoff
  const hotLeads: BriefingData["hotLeads"] = [];
  for (const r of activeNurture) {
    const lastTouch = r.touchHistory
      .filter((t) => t.responseAt && new Date(t.responseAt) > cutoff)
      .sort((a, b) => (a.responseAt! < b.responseAt! ? 1 : -1))[0];

    if (lastTouch && ["hot", "warm"].includes(lastTouch.responseClassification ?? "")) {
      const dayNum = Math.floor((now.getTime() - new Date(r.enrolledAt).getTime()) / 86400000);
      hotLeads.push({
        name: r.leadDisplayName,
        platform: r.platform,
        stage: `nurture day ${dayNum}`,
        detail: `touch ${lastTouch.touchNumber} — ${lastTouch.responseClassification}`,
      });
    }
  }

  // Overnight questions (neutral or warm responses = they replied, something to respond to)
  const overnightQuestions: BriefingData["overnightQuestions"] = [];
  for (const c of Object.values(contacts)) {
    if (
      c.responseAt &&
      new Date(c.responseAt) > cutoff &&
      ["positive", "neutral"].includes(c.responseType ?? "")
    ) {
      overnightQuestions.push({
        name: c.leadDisplayName,
        platform: c.platform,
        context: `first contact (${c.strategy}) response: ${c.responseType}`,
      });
    }
  }
  // Also catch nurture responses overnight
  for (const r of activeNurture) {
    const lastTouch = r.touchHistory
      .filter((t) => t.responseAt && new Date(t.responseAt) > cutoff)
      .sort((a, b) => (a.responseAt! < b.responseAt! ? 1 : -1))[0];
    if (lastTouch && lastTouch.responseClassification === "neutral") {
      const dayNum = Math.floor((now.getTime() - new Date(r.enrolledAt).getTime()) / 86400000);
      overnightQuestions.push({
        name: r.leadDisplayName,
        platform: r.platform,
        context: `nurture day ${dayNum}, touch ${lastTouch.touchNumber} — replied, check in`,
      });
    }
  }

  // New qualified leads since cutoff
  const newQualified = Object.values(leads).filter(
    (l) => l.qualified && !l.optedOut && l.qualifiedAt && new Date(l.qualifiedAt) > cutoff
  );

  // Touches due today (next touch within today's window — 7 AM to midnight)
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const touchesDueToday = activeNurture.filter(
    (r) =>
      r.nextTouchScheduledFor &&
      new Date(r.nextTouchScheduledFor) <= endOfDay
  );

  // 1-10 recommendation: Day 12+ in nurture, no 1-10 asked yet
  const oneToTenDue = activeNurture.filter((r) => {
    const dayNum = Math.floor((now.getTime() - new Date(r.enrolledAt).getTime()) / 86400000);
    return dayNum >= 12 && r.oneToTenRound === 0 && r.currentTouchNumber < 5;
  });

  // Consecutive no-response warnings
  const consecutiveNoResponseWarnings = activeNurture.filter(
    (r) => r.consecutiveNoResponses === 1
  );

  // Recent slow drip transitions (status changed since cutoff — check completedAt)
  const slowDripTransitions = allNurture.filter((r) => r.status === "slow_drip");

  // Active conversations = contacts in sent/follow_up + active nurture
  const activeContactsSent = Object.values(contacts).filter((c) =>
    ["sent", "follow_up_scheduled", "follow_up_sent"].includes(c.status)
  ).length;
  const activeConversations = activeNurture.length + activeContactsSent;

  // Aftercare
  const aftercareStore = loadJson<Record<string, AftercareRecordBrief>>(path.join(workdir, "aftercare.json")) ?? {};
  const allAftercare = Object.values(aftercareStore);
  const aftercareActive: BriefingData["aftercareActive"] = allAftercare
    .filter((r) => ["active", "inactive_flagged", "upgrade_flagged"].includes(r.status))
    .map((r) => ({
      name: r.leadDisplayName,
      platform: r.platform,
      oar: r.oar,
      tier: r.tier,
      status: r.status,
      nextTouch: r.nextTouchScheduledFor,
    }));
  const aftercareAlerts: BriefingData["aftercareAlerts"] = allAftercare
    .filter((r) => r.status === "inactive_flagged" || r.status === "upgrade_flagged")
    .map((r) => ({
      name: r.leadDisplayName,
      platform: r.platform,
      alertType: r.status === "upgrade_flagged" ? "builder upgrade signal" : "inactive — 2 no-responses",
    }));

  return {
    tenantName,
    flavor,
    conversionReady,
    hotLeads,
    overnightQuestions,
    newQualified,
    touchesDueToday,
    oneToTenDue,
    consecutiveNoResponseWarnings,
    slowDripTransitions,
    activeConversations,
    aftercareActive,
    aftercareAlerts,
  };
}

// ---------------------------------------------------------------------------
// Briefing text assembly
// ---------------------------------------------------------------------------

function assembleBriefing(data: BriefingData): string {
  const lines: string[] = [];
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  lines.push(`Good morning ${data.tenantName}. Here's your ${today}:`);
  lines.push(``);

  // ---- Section 1: Conversion alerts (highest priority) ----
  if (data.conversionReady.length > 0) {
    lines.push(`🎯 READY FOR CONVERSION (${data.conversionReady.length})`);
    for (const r of data.conversionReady) {
      const score = r.lastOneToTenScore ?? "8+";
      lines.push(`  → ${r.leadDisplayName} (${r.platform}) scored ${score}/10. Run tiger_convert to begin the handoff.`);
    }
    lines.push(``);
  }

  // ---- Section 2: Hot leads ----
  if (data.hotLeads.length > 0) {
    lines.push(`🔥 HOT (${data.hotLeads.length} responded positively)`);
    for (const h of data.hotLeads) {
      lines.push(`  • ${h.name} (${h.platform}) — ${h.stage}, ${h.detail}`);
    }
    lines.push(``);
  }

  // ---- Section 3: Overnight questions ----
  if (data.overnightQuestions.length > 0) {
    lines.push(
      `❓ QUESTIONS OVERNIGHT (${data.overnightQuestions.length} prospect${data.overnightQuestions.length === 1 ? "" : "s"} replied)`
    );
    for (const q of data.overnightQuestions) {
      lines.push(`  • ${q.name} (${q.platform}) — ${q.context}`);
    }
    lines.push(``);
  }

  // ---- Section 4: New qualified ----
  if (data.newQualified.length > 0) {
    lines.push(`⭐ NEW QUALIFIED (${data.newQualified.length} crossed the 80-point threshold)`);
    for (const l of data.newQualified) {
      const score = l.builderScore ?? l.customerScore ?? Math.round(((l.profileFit ?? 0) + (l.intentScore ?? 0)) / 2);
      lines.push(`  • ${l.displayName} (${l.platform}) — score ${score}`);
    }
    lines.push(``);
  }

  // ---- Section 5: Nurture recommendations ----
  const hasRecs = data.touchesDueToday.length > 0 || data.oneToTenDue.length > 0;
  if (hasRecs) {
    lines.push(`📅 NURTURE TODAY`);

    if (data.touchesDueToday.length > 0) {
      lines.push(`  Touches due:`);
      for (const r of data.touchesDueToday) {
        const dayNum = Math.floor(
          (Date.now() - new Date(r.enrolledAt).getTime()) / 86400000
        );
        const nextTouchType = r.touchHistory.find((t) => t.touchNumber === r.currentTouchNumber && !t.sentAt)?.type ?? "scheduled";
        lines.push(`  • ${r.leadDisplayName} — Day ${dayNum}/30, touch ${r.currentTouchNumber} (${nextTouchType})`);
      }
    }

    if (data.oneToTenDue.length > 0) {
      lines.push(`  1-10 question recommended:`);
      for (const r of data.oneToTenDue) {
        const dayNum = Math.floor(
          (Date.now() - new Date(r.enrolledAt).getTime()) / 86400000
        );
        lines.push(`  • ${r.leadDisplayName} — Day ${dayNum}, engagement strong. Recommend asking the 1-10 today.`);
      }
    }

    lines.push(``);
  }

  // ---- Section 6: Warnings ----
  const hasWarnings = data.consecutiveNoResponseWarnings.length > 0 || data.slowDripTransitions.length > 0;
  if (hasWarnings) {
    lines.push(`⚠️ ATTENTION`);

    for (const r of data.consecutiveNoResponseWarnings) {
      lines.push(`  • ${r.leadDisplayName} — 1 no-response so far. One more and they exit nurture.`);
    }
    for (const r of data.slowDripTransitions) {
      lines.push(`  • ${r.leadDisplayName} — moved to slow drip (${r.slowDripCount ?? 0}/3 drips sent).`);
    }
    lines.push(``);
  }

  // ---- Section 7: 3-Per-Day Rule check ----
  const THREE_PER_DAY_MINIMUM = 3;
  if (data.activeConversations < THREE_PER_DAY_MINIMUM) {
    const deficit = THREE_PER_DAY_MINIMUM - data.activeConversations;
    lines.push(
      `📊 3-PER-DAY CHECK: ${data.activeConversations} active conversation${data.activeConversations === 1 ? "" : "s"}. ` +
      `Need ${deficit} more to hit the daily minimum. Run tiger_scout to find more leads.`
    );
    lines.push(``);
  }

  // ---- Section 8: Aftercare ----
  if (data.aftercareAlerts.length > 0) {
    lines.push(`🏆 AFTERCARE ALERTS`);
    for (const a of data.aftercareAlerts) {
      lines.push(`  • ${a.name} (${a.platform}) — ${a.alertType}`);
    }
    lines.push(``);
  }
  if (data.aftercareActive.length > 0 && data.aftercareAlerts.length === 0) {
    lines.push(`🏆 AFTERCARE: ${data.aftercareActive.length} active (${data.aftercareActive.filter((a) => a.oar === "builder").length} builders, ${data.aftercareActive.filter((a) => a.oar === "customer").length} customers)`);
    lines.push(``);
  }

  // ---- Nothing to report ----
  const hasAftercare = data.aftercareActive.length > 0 || data.aftercareAlerts.length > 0;
  if (
    data.conversionReady.length === 0 &&
    data.hotLeads.length === 0 &&
    data.overnightQuestions.length === 0 &&
    data.newQualified.length === 0 &&
    !hasRecs &&
    !hasWarnings &&
    !hasAftercare &&
    data.activeConversations >= THREE_PER_DAY_MINIMUM
  ) {
    lines.push(`All quiet overnight. ${data.activeConversations} active conversation${data.activeConversations === 1 ? "" : "s"} in flight.`);
    lines.push(`Run tiger_scout to refresh the pipeline.`);
    lines.push(``);
  }

  lines.push(`— Your Tiger Claw bot`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Action: generate
// ---------------------------------------------------------------------------

function handleGenerate(workdir: string, logger: ToolContext["logger"]): ToolResult {
  const date = todayDate();
  const logPath = path.join(workdir, "briefing.json");
  const log = loadJson<BriefingLog>(logPath) ?? {};

  // Find last briefing timestamp for "since yesterday" filtering
  const entries = Object.values(log).sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  const lastBriefingAt = entries[0]?.generatedAt;

  const data = aggregateData(workdir, lastBriefingAt);
  const content = assembleBriefing(data);

  const entry: BriefingEntry = {
    date,
    generatedAt: new Date().toISOString(),
    content,
    activeConversations: data.activeConversations,
    conversionReady: data.conversionReady.length,
    newQualified: data.newQualified.length,
  };

  log[date] = entry;
  saveJson(logPath, log);

  logger.info("tiger_briefing: generated", {
    date,
    activeConversations: data.activeConversations,
    conversionReady: data.conversionReady.length,
    newQualified: data.newQualified.length,
  });

  return {
    ok: true,
    output: content,
    data: {
      date,
      generatedAt: entry.generatedAt,
      activeConversations: data.activeConversations,
      conversionReady: data.conversionReady.length,
      newQualified: data.newQualified.length,
      channel: (loadJson<OnboardState>(path.join(workdir, "onboard_state.json")))?.identity?.preferredChannel ?? "configured channel",
    },
  };
}

// ---------------------------------------------------------------------------
// Action: mark_sent
// ---------------------------------------------------------------------------

function handleMarkSent(workdir: string, date?: string, logger?: ToolContext["logger"]): ToolResult {
  const targetDate = date ?? todayDate();
  const logPath = path.join(workdir, "briefing.json");
  const log = loadJson<BriefingLog>(logPath) ?? {};

  if (!log[targetDate]) {
    return {
      ok: false,
      error: `No briefing found for ${targetDate}. Run generate first.`,
    };
  }

  log[targetDate].sentAt = new Date().toISOString();
  saveJson(logPath, log);

  logger?.info("tiger_briefing: marked sent", { date: targetDate });

  return {
    ok: true,
    output: `Briefing for ${targetDate} marked as delivered.`,
    data: { date: targetDate, sentAt: log[targetDate].sentAt },
  };
}

// ---------------------------------------------------------------------------
// Action: history
// ---------------------------------------------------------------------------

function handleHistory(workdir: string, limit: number): ToolResult {
  const logPath = path.join(workdir, "briefing.json");
  const log = loadJson<BriefingLog>(logPath) ?? {};

  const entries = Object.values(log)
    .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))
    .slice(0, limit);

  if (entries.length === 0) {
    return { ok: true, output: "No briefings generated yet.", data: { entries: [] } };
  }

  const lines = entries.map((e) => {
    const sent = e.sentAt ? `sent ${new Date(e.sentAt).toUTCString()}` : "NOT YET SENT";
    return `  ${e.date} — ${e.activeConversations} active, ${e.conversionReady} conversion-ready, ${e.newQualified} new qualified — ${sent}`;
  });

  return {
    ok: true,
    output: [`Last ${entries.length} briefing(s):`, ...lines].join("\n"),
    data: { entries },
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

  logger.info("tiger_briefing called", { action });

  try {
    switch (action) {
      case "generate":
        return handleGenerate(workdir, logger);

      case "mark_sent":
        return handleMarkSent(workdir, params.date as string | undefined, logger);

      case "history":
        return handleHistory(workdir, typeof params.limit === "number" ? params.limit : 7);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: generate | mark_sent | history`,
        };
    }
  } catch (err) {
    logger.error("tiger_briefing error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_briefing error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_briefing = {
  name: "tiger_briefing",
  description:
    "Daily morning briefing for the tenant. Aggregates leads.json, nurture.json, and contacts.json into a single conversational summary message. NOT a dashboard — a message delivered to the tenant's preferred channel. Sections: conversion-ready alerts, hot leads (positive responses), overnight questions, new qualified leads (80+ score), nurture touch recommendations, 1-10 question recommendations, no-response warnings, and the 3-Per-Day Rule check. Cron fires generate at 7 AM, agent delivers, then calls mark_sent.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["generate", "mark_sent", "history"],
        description:
          "generate: build today's briefing text from current state (cron 7 AM). mark_sent: record that briefing was delivered to tenant's channel. history: show last N briefings.",
      },
      date: {
        type: "string",
        description: "YYYY-MM-DD. Used with mark_sent to confirm a specific date's briefing was delivered. Defaults to today.",
      },
      limit: {
        type: "number",
        description: "Number of past briefings to show with history action. Defaults to 7.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_briefing;
