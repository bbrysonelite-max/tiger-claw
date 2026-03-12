// Tiger Claw — tiger_score Tool
// Lead scoring engine — Block 3.2 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Three dimensions:
//   profileFit    (0-100) — static, who they are. Scored at discovery.
//   intentSignals (0-100) — behavioral, recency-weighted with exponential decay.
//   engagement    (0-100) — starts at 0, builds from interaction events.
//
// Weights (LOCKED):
//   Business Builder: profileFit × 0.30 + intentSignals × 0.45 + engagement × 0.25
//   Customer:         profileFit × 0.25 + intentSignals × 0.50 + engagement × 0.25
//
// Threshold: 80. Fixed. Not configurable per tenant.
//
// Unicorn Bonus: Lead with signals in BOTH oars gets +15 on the higher score.
//   If both hit 80, prioritize builder oar.
//
// State persisted to {workdir}/leads.json (per-tenant, keyed by leadId).
// Score recalculates dynamically on every new signal.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Constants — LOCKED per spec
// ---------------------------------------------------------------------------

const SCORE_THRESHOLD = 80; // Hard threshold — non-configurable

const BUILDER_WEIGHTS = { profileFit: 0.30, intentSignals: 0.45, engagement: 0.25 } as const;
const CUSTOMER_WEIGHTS = { profileFit: 0.25, intentSignals: 0.50, engagement: 0.25 } as const;

const UNICORN_BONUS = 15; // Applied to higher oar score when both oars triggered

// Intent decay half-life: 30 days. Signal from today = full, 30 days ago ≈ 50%.
// Using exponential decay: factor = e^(-t/τ) where τ = decay constant.
// We want factor = 0.5 at t = 30 days, so τ = 30 / ln(2) ≈ 43.3 days.
const INTENT_DECAY_TAU_DAYS = 30 / Math.LN2; // ≈ 43.3

// Below-threshold leads purged after 90 days with no qualification
const PURGE_DAYS = 90;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OarType = "builder" | "customer" | "both";
type PrimaryOar = "builder" | "customer";

type IntentSignalType =
  | "pain_point_post"     // Posting about a pain our product solves
  | "forum_question"      // Asking questions in relevant communities
  | "competitor_engagement" // Engaging with competitor content
  | "life_event"          // Life event signaling readiness (job change, new baby, etc.)
  | "search_behavior"     // Search patterns indicating intent
  | "income_complaint"    // Complaining about income / job / hours
  | "side_hustle_interest"; // Expressing interest in extra income

type EngagementEventType =
  | "opened_message"    // Opened the first contact message (+10)
  | "replied"           // Replied to any message (+25)
  | "asked_question"    // Asked a question — very strong signal (+35)
  | "clicked_link"      // Clicked a shared link (+15)
  | "requested_info"    // Explicitly requested more information (+40, near-conversion)
  | "ignored_touch"     // No response to a scheduled touch (-5)
  | "blocked_opted_out"; // Blocked or explicit opt-out (→ score 0, permanent exit)

interface IntentSignalRecord {
  type: IntentSignalType;
  strength: number;      // Raw signal strength 0-100 before decay
  detectedAt: string;    // ISO timestamp — used for recency decay
  source?: string;       // Platform or source where detected
  excerpt?: string;      // Brief text excerpt that triggered this signal
}

interface EngagementEventRecord {
  type: EngagementEventType;
  occurredAt: string;    // ISO timestamp
  touchNumber?: number;  // Which touch in the sequence this happened on
}

interface LeadRecord {
  id: string;                        // UUID
  platform: string;                  // reddit | facebook | telegram | line
  platformId: string;                // Platform-specific identifier
  displayName: string;               // Display name on platform
  profileUrl?: string;
  bio?: string;                      // Profile bio / about text
  keywords?: string[];               // Keywords found in profile matching ICP
  negativeSignals?: string[];        // Negative signal flags

  // Raw dimension scores (0-100 each)
  profileFit: number;
  rawIntentStrength: number;         // Unweighted peak intent strength
  engagement: number;

  // Computed intent score (after decay aggregation)
  intentScore: number;

  // Computed composite scores (weighted formula)
  builderScore: number;
  customerScore: number;

  // Active oar context
  oar: OarType;
  primaryOar: PrimaryOar;            // If both, builder is primary per spec
  isUnicorn: boolean;                // Both oars triggered
  unicornBonusApplied: boolean;

  // Qualification
  qualified: boolean;                // Highest composite score >= 80
  qualifyingScore: number;           // The score that qualified them
  qualifyingOar: PrimaryOar;         // Which oar qualified
  qualifiedAt?: string;              // ISO timestamp of first qualification

  // Opt-out (permanent — score → 0, no re-contact ever)
  optedOut: boolean;
  optedOutAt?: string;

  // Signal history (used for decay recalculation)
  intentSignalHistory: IntentSignalRecord[];
  engagementEvents: EngagementEventRecord[];

  // Involvement Spectrum (Block 3.3): 0=Prospect, 1=Engaged, 2=Customer,
  // 3=Repeat customer, 4=Referral source, 5=Wholesale buyer,
  // 6=Side hustle builder, 7=Full-time builder
  involvementLevel: number;

  // Lifecycle timestamps
  discoveredAt: string;
  lastSignalAt: string;
  lastScoredAt: string;
  purgeAt: string;                   // For below-threshold leads
}

interface LeadsStore {
  [leadId: string]: LeadRecord;
}

// Tool input types
interface IntentSignalInput {
  type: IntentSignalType;
  strength: number;       // 0-100
  detectedAt?: string;    // ISO timestamp, defaults to now
  source?: string;
  excerpt?: string;
}

interface ScoreInput {
  platform: string;
  platformId: string;
  displayName: string;
  profileUrl?: string;
  bio?: string;
  keywords?: string[];
  negativeSignals?: string[];
  profileFit: number;            // 0-100, provided by tiger_scout
  intentSignals: IntentSignalInput[];
  oar: OarType;
}

interface UpdateEngagementInput {
  leadId?: string;
  platformId?: string;
  platform?: string;
  event: EngagementEventType;
  occurredAt?: string;
  touchNumber?: number;
}

interface RecalculateInput {
  leadId?: string;   // Specific lead, or all if omitted
}

interface GetInput {
  leadId?: string;
  platformId?: string;
  platform?: string;
}

interface ListInput {
  filter?: "qualified" | "warming" | "all";
  oar?: "builder" | "customer";
  limit?: number;
}

type ScoreParams =
  | ({ action: "score" } & ScoreInput)
  | ({ action: "update_engagement" } & UpdateEngagementInput)
  | ({ action: "recalculate" } & RecalculateInput)
  | ({ action: "get" } & GetInput)
  | ({ action: "list" } & ListInput);

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
// Scoring Math
// ---------------------------------------------------------------------------

/**
 * Aggregate intent signals with exponential recency decay.
 * More recent signals carry full weight; older signals decay.
 * Returns a score 0-100.
 */
function computeIntentScore(signals: IntentSignalRecord[]): number {
  if (signals.length === 0) return 0;

  const now = Date.now();
  let weightedSum = 0;
  let maxPossible = 0;

  for (const signal of signals) {
    const ageMs = now - new Date(signal.detectedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decayFactor = Math.exp(-ageDays / INTENT_DECAY_TAU_DAYS);
    weightedSum += signal.strength * decayFactor;
    maxPossible += signal.strength; // Without decay
  }

  // Normalize to 0-100 based on max possible (undecayed) strength
  // Cap at 100
  if (maxPossible === 0) return 0;
  const raw = (weightedSum / maxPossible) * 100;
  return Math.min(100, Math.round(raw));
}

/**
 * Compute weighted composite score for one oar.
 * Returns 0-100.
 */
function computeCompositeScore(
  profileFit: number,
  intentScore: number,
  engagement: number,
  oar: "builder" | "customer"
): number {
  const weights = oar === "builder" ? BUILDER_WEIGHTS : CUSTOMER_WEIGHTS;
  const raw =
    profileFit * weights.profileFit +
    intentScore * weights.intentSignals +
    engagement * weights.engagement;
  return Math.min(100, Math.round(raw));
}

/**
 * Apply the Unicorn Bonus (+15 on higher of two scores) when lead
 * has signals in both oars. Returns updated { builderScore, customerScore }.
 */
function applyUnicornBonus(
  builderScore: number,
  customerScore: number
): { builderScore: number; customerScore: number; isUnicorn: boolean; applied: boolean } {
  // Unicorn bonus only when both oars have meaningful signals (score > 0)
  if (builderScore === 0 || customerScore === 0) {
    return { builderScore, customerScore, isUnicorn: false, applied: false };
  }

  const higher = Math.max(builderScore, customerScore);
  const lower = Math.min(builderScore, customerScore);

  // Only apply if both oars show some intent (lower score > 20 — not zero/noise)
  if (lower < 20) {
    return { builderScore, customerScore, isUnicorn: true, applied: false };
  }

  const bonusedHigher = Math.min(100, higher + UNICORN_BONUS);

  if (builderScore >= customerScore) {
    return {
      builderScore: bonusedHigher,
      customerScore,
      isUnicorn: true,
      applied: true,
    };
  } else {
    return {
      builderScore,
      customerScore: bonusedHigher,
      isUnicorn: true,
      applied: true,
    };
  }
}

/**
 * Engagement event delta values.
 * blocked_opted_out is handled separately (hard zero + permanent flag).
 */
const ENGAGEMENT_DELTAS: Record<EngagementEventType, number> = {
  opened_message: 10,
  replied: 25,
  asked_question: 35,
  clicked_link: 15,
  requested_info: 40,
  ignored_touch: -5,
  blocked_opted_out: 0, // Handled separately — sets score to 0, flags opt-out
};

/**
 * Apply engagement event to current engagement score.
 * Returns new engagement score (0-100) and opt-out status.
 */
function applyEngagementEvent(
  currentEngagement: number,
  event: EngagementEventType
): { engagement: number; optedOut: boolean } {
  if (event === "blocked_opted_out") {
    return { engagement: 0, optedOut: true };
  }

  const delta = ENGAGEMENT_DELTAS[event];
  const updated = Math.max(0, Math.min(100, currentEngagement + delta));
  return { engagement: updated, optedOut: false };
}

// ---------------------------------------------------------------------------
// Qualification logic
// ---------------------------------------------------------------------------

function determineQualification(
  builderScore: number,
  customerScore: number,
  oar: OarType
): {
  qualified: boolean;
  qualifyingScore: number;
  qualifyingOar: PrimaryOar;
} {
  const builderQualifies = oar !== "customer" && builderScore >= SCORE_THRESHOLD;
  const customerQualifies = oar !== "builder" && customerScore >= SCORE_THRESHOLD;

  if (builderQualifies && customerQualifies) {
    // Both qualify — prioritize builder per spec
    return { qualified: true, qualifyingScore: builderScore, qualifyingOar: "builder" };
  }
  if (builderQualifies) {
    return { qualified: true, qualifyingScore: builderScore, qualifyingOar: "builder" };
  }
  if (customerQualifies) {
    return { qualified: true, qualifyingScore: customerScore, qualifyingOar: "customer" };
  }
  // Neither qualifies
  const highestScore = Math.max(builderScore, customerScore);
  const highestOar: PrimaryOar = builderScore >= customerScore ? "builder" : "customer";
  return { qualified: false, qualifyingScore: highestScore, qualifyingOar: highestOar };
}

// ---------------------------------------------------------------------------
// Lead persistence
// ---------------------------------------------------------------------------

function leadsFilePath(workdir: string): string {
  return path.join(workdir, "leads.json");
}

async function loadLeads(context: ToolContext): Promise<LeadsStore> {
  const data = await context.storage.get("leads.json");
  return data ?? ({} as any);
}

async function saveLeads(context: ToolContext, leads: LeadsStore): Promise<void> {
  await context.storage.set("leads.json", leads);
}

function findLeadByPlatformId(
  leads: LeadsStore,
  platform: string,
  platformId: string
): LeadRecord | undefined {
  return Object.values(leads).find(
    (l) => l.platform === platform && l.platformId === platformId
  );
}

function purgeExpiredLeads(leads: LeadsStore): { purged: number } {
  const now = new Date().toISOString();
  let purged = 0;
  for (const [id, lead] of Object.entries(leads)) {
    if (!lead.qualified && !lead.optedOut && lead.purgeAt <= now) {
      delete leads[id];
      purged++;
    }
  }
  return { purged };
}

// ---------------------------------------------------------------------------
// Full lead scoring pipeline
// ---------------------------------------------------------------------------

function buildLeadRecord(input: ScoreInput, existingId?: string): LeadRecord {
  const now = new Date().toISOString();
  const id = existingId ?? crypto.randomUUID();

  // Normalize intent signals to full records
  const intentSignalHistory: IntentSignalRecord[] = input.intentSignals.map((s) => ({
    type: s.type,
    strength: Math.min(100, Math.max(0, s.strength)),
    detectedAt: s.detectedAt ?? now,
    source: s.source,
    excerpt: s.excerpt,
  }));

  const intentScore = computeIntentScore(intentSignalHistory);
  const profileFit = Math.min(100, Math.max(0, input.profileFit));

  // Compute raw oar scores before unicorn bonus
  const rawBuilderScore =
    input.oar !== "customer"
      ? computeCompositeScore(profileFit, intentScore, 0, "builder")
      : 0;
  const rawCustomerScore =
    input.oar !== "builder"
      ? computeCompositeScore(profileFit, intentScore, 0, "customer")
      : 0;

  // Apply unicorn bonus if both oars active
  const unicorn =
    input.oar === "both"
      ? applyUnicornBonus(rawBuilderScore, rawCustomerScore)
      : { builderScore: rawBuilderScore, customerScore: rawCustomerScore, isUnicorn: false, applied: false };

  const { qualified, qualifyingScore, qualifyingOar } = determineQualification(
    unicorn.builderScore,
    unicorn.customerScore,
    input.oar
  );

  const primaryOar: PrimaryOar =
    input.oar === "both" ? "builder" : (input.oar as PrimaryOar);
  const purgeAt = new Date(
    new Date(now).getTime() + PURGE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    id,
    platform: input.platform,
    platformId: input.platformId,
    displayName: input.displayName,
    profileUrl: input.profileUrl,
    bio: input.bio,
    keywords: input.keywords ?? [],
    negativeSignals: input.negativeSignals ?? [],

    profileFit,
    rawIntentStrength: Math.max(...(intentSignalHistory.map((s) => s.strength)), 0),
    engagement: 0,
    intentScore,

    builderScore: unicorn.builderScore,
    customerScore: unicorn.customerScore,

    oar: input.oar,
    primaryOar,
    isUnicorn: unicorn.isUnicorn,
    unicornBonusApplied: unicorn.applied,

    qualified,
    qualifyingScore,
    qualifyingOar,
    qualifiedAt: qualified ? now : undefined,

    optedOut: false,

    intentSignalHistory,
    engagementEvents: [],

    involvementLevel: 0,

    discoveredAt: now,
    lastSignalAt: now,
    lastScoredAt: now,
    purgeAt,
  };
}

function recomputeScores(lead: LeadRecord): LeadRecord {
  if (lead.optedOut) {
    // Opted-out leads keep scores at 0
    lead.builderScore = 0;
    lead.customerScore = 0;
    lead.qualified = false;
    lead.lastScoredAt = new Date().toISOString();
    return lead;
  }

  const intentScore = computeIntentScore(lead.intentSignalHistory);
  lead.intentScore = intentScore;

  const rawBuilderScore =
    lead.oar !== "customer"
      ? computeCompositeScore(lead.profileFit, intentScore, lead.engagement, "builder")
      : 0;
  const rawCustomerScore =
    lead.oar !== "builder"
      ? computeCompositeScore(lead.profileFit, intentScore, lead.engagement, "customer")
      : 0;

  const unicorn =
    lead.oar === "both"
      ? applyUnicornBonus(rawBuilderScore, rawCustomerScore)
      : { builderScore: rawBuilderScore, customerScore: rawCustomerScore, isUnicorn: lead.isUnicorn, applied: lead.unicornBonusApplied };

  lead.builderScore = unicorn.builderScore;
  lead.customerScore = unicorn.customerScore;
  lead.isUnicorn = unicorn.isUnicorn;
  lead.unicornBonusApplied = unicorn.applied;

  const { qualified, qualifyingScore, qualifyingOar } = determineQualification(
    lead.builderScore,
    lead.customerScore,
    lead.oar
  );

  if (qualified && !lead.qualified) {
    lead.qualifiedAt = new Date().toISOString();
  }
  lead.qualified = qualified;
  lead.qualifyingScore = qualifyingScore;
  lead.qualifyingOar = qualifyingOar;
  lead.lastScoredAt = new Date().toISOString();

  return lead;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleScore(
  params: Record<string, unknown>,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const input = params as unknown as ScoreInput;

  if (!input.platform || !input.platformId || !input.displayName) {
    return { ok: false, error: "score requires: platform, platformId, displayName" };
  }
  if (typeof input.profileFit !== "number") {
    return { ok: false, error: "score requires a numeric profileFit (0-100)" };
  }
  if (!Array.isArray(input.intentSignals)) {
    return { ok: false, error: "score requires intentSignals array" };
  }
  if (!input.oar || !["builder", "customer", "both"].includes(input.oar)) {
    return { ok: false, error: "score requires oar: 'builder' | 'customer' | 'both'" };
  }

  const leads = await loadLeads(context);

  // Check for existing lead (deduplication)
  const existing = findLeadByPlatformId(leads, input.platform, input.platformId);

  if (existing) {
    // Re-score existing lead — merge new intent signals, keep engagement
    const newSignals: IntentSignalRecord[] = input.intentSignals.map((s) => ({
      type: s.type,
      strength: Math.min(100, Math.max(0, s.strength)),
      detectedAt: s.detectedAt ?? new Date().toISOString(),
      source: s.source,
      excerpt: s.excerpt,
    }));

    // Merge signals — keep existing history, append new (dedup by type+day)
    const existingDates = new Set(
      existing.intentSignalHistory.map((s) => `${s.type}:${s.detectedAt.slice(0, 10)}`)
    );
    for (const sig of newSignals) {
      const key = `${sig.type}:${sig.detectedAt.slice(0, 10)}`;
      if (!existingDates.has(key)) {
        existing.intentSignalHistory.push(sig);
        existingDates.add(key);
      }
    }

    // Update profile fit if provided (static but can be refined)
    existing.profileFit = Math.min(100, Math.max(0, input.profileFit));
    existing.oar = input.oar;
    existing.lastSignalAt = new Date().toISOString();
    if (input.bio) existing.bio = input.bio;
    if (input.keywords) existing.keywords = input.keywords;
    if (input.negativeSignals) existing.negativeSignals = input.negativeSignals;

    recomputeScores(existing);
    leads[existing.id] = existing;
    await saveLeads(context, leads);

    logger.info("tiger_score: re-scored existing lead", {
      id: existing.id,
      displayName: existing.displayName,
      builderScore: existing.builderScore,
      customerScore: existing.customerScore,
      qualified: existing.qualified,
    });

    return {
      ok: true,
      output: formatScoreOutput(existing, "re-scored"),
      data: sanitizeLead(existing),
    };
  }

  // New lead
  const record = buildLeadRecord(input);
  leads[record.id] = record;
  await saveLeads(context, leads);

  logger.info("tiger_score: scored new lead", {
    id: record.id,
    displayName: record.displayName,
    builderScore: record.builderScore,
    customerScore: record.customerScore,
    qualified: record.qualified,
  });

  return {
    ok: true,
    output: formatScoreOutput(record, "new"),
    data: sanitizeLead(record),
  };
}

async function handleUpdateEngagement(
  params: Record<string, unknown>,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const input = params as unknown as UpdateEngagementInput;

  if (!input.event) {
    return { ok: false, error: "update_engagement requires event type" };
  }

  const leads = await loadLeads(context);
  let lead: LeadRecord | undefined;

  if (input.leadId) {
    lead = leads[input.leadId];
  } else if (input.platform && input.platformId) {
    lead = findLeadByPlatformId(leads, input.platform, input.platformId);
  }

  if (!lead) {
    return { ok: false, error: "Lead not found. Provide leadId or platform+platformId." };
  }

  if (lead.optedOut) {
    return {
      ok: true,
      output: `Lead ${lead.displayName} has opted out permanently. No further contact.`,
      data: { optedOut: true, leadId: lead.id },
    };
  }

  const eventRecord: EngagementEventRecord = {
    type: input.event,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    touchNumber: input.touchNumber,
  };

  lead.engagementEvents.push(eventRecord);

  const result = applyEngagementEvent(lead.engagement, input.event);
  lead.engagement = result.engagement;

  if (result.optedOut) {
    lead.optedOut = true;
    lead.optedOutAt = new Date().toISOString();
    lead.engagement = 0;
    lead.builderScore = 0;
    lead.customerScore = 0;
    lead.qualified = false;
    lead.lastScoredAt = new Date().toISOString();

    leads[lead.id] = lead;
    await saveLeads(context, leads);

    logger.info("tiger_score: lead opted out — permanent", {
      id: lead.id,
      displayName: lead.displayName,
    });

    return {
      ok: true,
      output: `${lead.displayName} has blocked or opted out. They have been permanently removed from your pipeline. I will never contact them again.`,
      data: { optedOut: true, leadId: lead.id },
    };
  }

  recomputeScores(lead);
  leads[lead.id] = lead;
  await saveLeads(context, leads);

  logger.info("tiger_score: engagement updated", {
    id: lead.id,
    event: input.event,
    engagement: lead.engagement,
    builderScore: lead.builderScore,
    customerScore: lead.customerScore,
  });

  const newlyQualified = lead.qualified && !lead.qualifiedAt
    ? false
    : (lead.qualified && lead.qualifiedAt
        ? new Date(lead.qualifiedAt).getTime() > Date.now() - 5000  // within last 5s
        : false);

  return {
    ok: true,
    output: formatEngagementOutput(lead, input.event, newlyQualified),
    data: sanitizeLead(lead),
  };
}

async function handleRecalculate(
  params: Record<string, unknown>,
  context: ToolContext,
  logger: ToolContext["logger"]
): Promise<ToolResult> {
  const input = params as unknown as RecalculateInput;
  const leads = await loadLeads(context);

  let count = 0;
  let newlyQualified = 0;

  const targets = input.leadId
    ? [leads[input.leadId]].filter(Boolean) as LeadRecord[]
    : Object.values(leads);

  for (const lead of targets) {
    if (lead.optedOut) continue;
    const wasQualified = lead.qualified;
    recomputeScores(lead);
    if (lead.qualified && !wasQualified) newlyQualified++;
    leads[lead.id] = lead;
    count++;
  }

  // Also purge expired below-threshold leads
  const { purged } = purgeExpiredLeads(leads);

  await saveLeads(context, leads);

  logger.info("tiger_score: recalculated", { count, newlyQualified, purged });

  return {
    ok: true,
    output: input.leadId
      ? leads[input.leadId]
        ? `Recalculated score for lead. ${formatScoreOutput(leads[input.leadId], "recalculated")}`
        : `Lead ${input.leadId} not found or was purged during recalculation.`
      : `Recalculated scores for ${count} leads. ${newlyQualified} newly qualified. ${purged} expired leads purged.`,
    data: {
      recalculated: count,
      newlyQualified,
      purged,
      leadId: input.leadId ?? null,
    },
  };
}

async function handleGet(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const input = params as unknown as GetInput;
  const leads = await loadLeads(context);

  let lead: LeadRecord | undefined;

  if (input.leadId) {
    lead = leads[input.leadId];
  } else if (input.platform && input.platformId) {
    lead = findLeadByPlatformId(leads, input.platform, input.platformId);
  }

  if (!lead) {
    return { ok: true, output: "Lead not found.", data: null };
  }

  return {
    ok: true,
    output: formatScoreOutput(lead, "retrieved"),
    data: sanitizeLead(lead),
  };
}

async function handleList(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const input = params as unknown as ListInput;
  const leads = await loadLeads(context);

  const filter = input.filter ?? "qualified";
  const limit = input.limit ?? 50;

  let results = Object.values(leads).filter((l) => !l.optedOut);

  if (filter === "qualified") {
    results = results.filter((l) => l.qualified);
  } else if (filter === "warming") {
    results = results.filter((l) => !l.qualified);
  }

  if (input.oar) {
    results = results.filter(
      (l) => l.oar === input.oar || l.oar === "both"
    );
  }

  // Sort: unicorns first, then by qualifying score desc
  results.sort((a, b) => {
    if (a.isUnicorn && !b.isUnicorn) return -1;
    if (!a.isUnicorn && b.isUnicorn) return 1;
    return b.qualifyingScore - a.qualifyingScore;
  });

  const page = results.slice(0, limit);
  const total = results.length;
  const qualifiedCount = Object.values(leads).filter((l) => l.qualified && !l.optedOut).length;
  const warmingCount = Object.values(leads).filter((l) => !l.qualified && !l.optedOut).length;

  return {
    ok: true,
    output: formatListOutput(page, filter, total, qualifiedCount, warmingCount),
    data: {
      leads: page.map(sanitizeLead),
      total,
      showing: page.length,
      qualifiedCount,
      warmingCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatScoreOutput(lead: LeadRecord, verb: string): string {
  const status = lead.optedOut
    ? "OPTED OUT"
    : lead.qualified
    ? `QUALIFIED (${lead.qualifyingOar.toUpperCase()}, score: ${lead.qualifyingScore})`
    : `Warming (score: ${lead.qualifyingScore}/${SCORE_THRESHOLD})`;

  const unicornTag = lead.isUnicorn ? " 🦄 DUAL OPPORTUNITY" : "";

  const lines = [
    `Lead ${verb}: ${lead.displayName} on ${lead.platform}${unicornTag}`,
    `Status: ${status}`,
  ];

  if (!lead.optedOut) {
    if (lead.oar !== "customer") {
      lines.push(`  Builder score: ${lead.builderScore} (Fit: ${lead.profileFit} | Intent: ${lead.intentScore} | Engage: ${lead.engagement})`);
    }
    if (lead.oar !== "builder") {
      lines.push(`  Customer score: ${lead.customerScore} (Fit: ${lead.profileFit} | Intent: ${lead.intentScore} | Engage: ${lead.engagement})`);
    }
    if (lead.isUnicorn) {
      lines.push(`  Unicorn bonus +${UNICORN_BONUS} applied to ${lead.builderScore >= lead.customerScore ? "builder" : "customer"} score.`);
    }
  }

  return lines.join("\n");
}

function formatEngagementOutput(
  lead: LeadRecord,
  event: EngagementEventType,
  newlyQualified: boolean
): string {
  const eventLabels: Record<EngagementEventType, string> = {
    opened_message: "opened your message",
    replied: "replied",
    asked_question: "asked a question — strong signal",
    clicked_link: "clicked your link",
    requested_info: "requested more information — near-conversion signal",
    ignored_touch: "didn't respond to a touch",
    blocked_opted_out: "opted out",
  };

  const lines = [
    `${lead.displayName} ${eventLabels[event]}.`,
    `Engagement: ${lead.engagement}/100 | Score: ${lead.qualifyingScore}`,
  ];

  if (newlyQualified) {
    lines.push(`🎯 NEWLY QUALIFIED! ${lead.displayName} just crossed the ${SCORE_THRESHOLD} threshold on the ${lead.qualifyingOar} oar. Ready for first contact.`);
  }

  return lines.join("\n");
}

function formatListOutput(
  leads: LeadRecord[],
  filter: string,
  total: number,
  qualifiedCount: number,
  warmingCount: number
): string {
  const lines = [
    `Pipeline: ${qualifiedCount} qualified | ${warmingCount} warming`,
    `Showing: ${leads.length} of ${total} (${filter})`,
    ``,
  ];

  if (leads.length === 0) {
    lines.push("No leads match this filter.");
    return lines.join("\n");
  }

  for (const lead of leads) {
    const unicorn = lead.isUnicorn ? " 🦄" : "";
    const score = lead.qualifyingScore;
    const oarLabel = lead.oar === "both" ? "DUAL" : lead.primaryOar.toUpperCase();
    lines.push(`• ${lead.displayName} (${lead.platform}) — ${oarLabel}${unicorn} — Score: ${score}`);
  }

  return lines.join("\n");
}

// Return lead data without internal history arrays for cleaner agent context
function sanitizeLead(lead: LeadRecord): Record<string, unknown> {
  const { intentSignalHistory: _i, engagementEvents: _e, ...rest } = lead;
  return {
    ...rest,
    intentSignalCount: _i.length,
    engagementEventCount: _e.length,
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

  logger.info("tiger_score called", { action });

  try {
    switch (action) {
      case "score":
        return await handleScore(params, context, logger);

      case "update_engagement":
        return await handleUpdateEngagement(params, context, logger);

      case "recalculate":
        return await handleRecalculate(params, context, logger);

      case "get":
        return await handleGet(params, context);

      case "list":
        return await handleList(params, context);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid actions: score | update_engagement | recalculate | get | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_score error", { action, err });
    return {
      ok: false,
      error: `tiger_score error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export const tiger_score = {
  name: "tiger_score",
  description:
    "Lead scoring engine. Three dimensions: profileFit (static), intentSignals (recency-weighted), engagement (event-driven). Weights: Builder 30/45/25, Customer 25/50/25. Hard threshold: 80. Unicorn Bonus: +15 on higher score when both oars signal. Actions: score (new/existing lead), update_engagement (record interaction event), recalculate (recompute after intent decay), get (fetch lead record), list (qualified/warming pipeline).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["score", "update_engagement", "recalculate", "get", "list"],
        description: "The scoring action to perform.",
      },
      // score params
      platform: {
        type: "string",
        description: "Platform where lead was discovered (reddit | facebook | telegram | line).",
      },
      platformId: {
        type: "string",
        description: "Platform-specific identifier for the lead.",
      },
      displayName: {
        type: "string",
        description: "Display name on platform.",
      },
      profileUrl: { type: "string" },
      bio: { type: "string", description: "Bio or profile description text." },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "ICP-matching keywords found in profile.",
      },
      negativeSignals: {
        type: "array",
        items: { type: "string" },
        description: "Negative signal flags (competitor, bot, wrong_geo, etc.).",
      },
      profileFit: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Profile Fit score 0-100, determined by tiger_scout.",
      },
      intentSignals: {
        type: "array",
        description: "Array of intent signal objects with type, strength, detectedAt.",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            strength: { type: "number", minimum: 0, maximum: 100 },
            detectedAt: { type: "string" },
            source: { type: "string" },
            excerpt: { type: "string" },
          },
          required: ["type", "strength"],
        },
      },
      oar: {
        type: "string",
        enum: ["builder", "customer", "both"],
        description: "Which oar(s) this lead is relevant for.",
      },
      // update_engagement / get params
      leadId: { type: "string", description: "Lead UUID (from previous score call)." },
      event: {
        type: "string",
        enum: [
          "opened_message",
          "replied",
          "asked_question",
          "clicked_link",
          "requested_info",
          "ignored_touch",
          "blocked_opted_out",
        ],
        description: "Engagement event type for update_engagement action.",
      },
      occurredAt: { type: "string", description: "ISO timestamp of the event." },
      touchNumber: { type: "number", description: "Which touch in the nurture sequence." },
      // list params
      filter: {
        type: "string",
        enum: ["qualified", "warming", "all"],
        description: "Filter for list action. Default: qualified.",
      },
      limit: {
        type: "number",
        description: "Max results for list action. Default: 50.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_score;
