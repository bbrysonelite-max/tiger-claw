// Tiger Claw — tiger_scout Tool
// Prospect discovery engine — Block 3.4 of TIGERCLAW-MASTER-SPEC-v2.md
//
// What this tool does:
//   1. Loads tenant ICP from onboard_state.json → extracts search keywords
//   2. Reads REGION env var → determines which sources are active
//   3. Searches active sources for prospects matching ICP keywords
//   4. Scores each prospect (profileFit + intentSignals)
//   5. Writes qualified and warming leads to leads.json (same file as tiger_score)
//   6. Returns hunt summary with count of qualified leads found
//
// Sources by region (LOCKED per spec Block 3.4):
//   Reddit      — US only.       Tier 1. Public JSON API, no auth.
//   Telegram    — US + Thailand. Tier 1. Bot API, reads joined channels/groups.
//   Facebook    — US + Thailand. Tier 2. Requires future credentials (stubbed).
//   LINE OpenChat — Thailand only. Tier 2. Requires LINE credentials (stubbed).
//
// Rate limits (enforced via scout_state.json):
//   Scheduled: minimum 23 hours between scans.
//   Burst: minimum 1 hour between bursts, max 3 per day.
//
// Runs on cron at 5 AM tenant timezone (configured in entrypoint.sh).
// Also available on-demand with action: 'hunt', mode: 'burst'.

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";
import { loadFlavorConfig } from "./flavorConfig.js";

// ---------------------------------------------------------------------------
// Scoring constants — LOCKED per spec. Must match tiger_score.ts exactly.
// ---------------------------------------------------------------------------

const SCORE_THRESHOLD = 80;
const BUILDER_WEIGHTS = { profileFit: 0.30, intentSignals: 0.45, engagement: 0.25 } as const;
const CUSTOMER_WEIGHTS = { profileFit: 0.25, intentSignals: 0.50, engagement: 0.25 } as const;
const UNICORN_BONUS = 15;
const INTENT_DECAY_TAU_DAYS = 30 / Math.LN2;
const PURGE_DAYS = 90;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OarType = "builder" | "customer" | "both";
type SourceName = "reddit" | "telegram" | "facebook_groups" | "line_openchat";

interface ICP {
  idealPerson?: string;
  problemFaced?: string;
  currentApproachFailing?: string;
  onlinePlatforms?: string;
  typesToAvoid?: string;
}

interface OnboardState {
  phase: string;
  identity: {
    name?: string;
    productOrOpportunity?: string;
    yearsInProfession?: string;
  };
  icpBuilder: ICP;
  icpCustomer: ICP;
  icpSingle: ICP;
  flavor: string;
  language: string;
  botName?: string;
}

interface IntentSignalRecord {
  type: string;
  strength: number;
  detectedAt: string;
  source?: string;
  excerpt?: string;
}

interface EngagementEventRecord {
  type: string;
  occurredAt: string;
}

// Minimal subset of LeadRecord needed to write to leads.json
interface LeadRecord {
  id: string;
  platform: string;
  platformId: string;
  displayName: string;
  profileUrl?: string;
  bio?: string;
  keywords?: string[];
  negativeSignals?: string[];
  profileFit: number;
  rawIntentStrength: number;
  engagement: number;
  intentScore: number;
  builderScore: number;
  customerScore: number;
  oar: OarType;
  primaryOar: "builder" | "customer";
  isUnicorn: boolean;
  unicornBonusApplied: boolean;
  qualified: boolean;
  qualifyingScore: number;
  qualifyingOar: "builder" | "customer";
  qualifiedAt?: string;
  optedOut: boolean;
  intentSignalHistory: IntentSignalRecord[];
  engagementEvents: EngagementEventRecord[];
  involvementLevel: number;
  discoveredAt: string;
  lastSignalAt: string;
  lastScoredAt: string;
  purgeAt: string;
}

interface LeadsStore {
  [leadId: string]: LeadRecord;
}

interface ScoutState {
  lastScheduledScan?: string;   // ISO timestamp
  lastBurstScan?: string;
  burstCountToday: number;
  burstCountDate: string;        // YYYY-MM-DD
  totalLeadsDiscovered: number;
  totalLeadsQualified: number;
  lastScanSummary?: string;
}

interface DiscoveredProfile {
  platform: SourceName;
  platformId: string;
  displayName: string;
  profileUrl?: string;
  bio?: string;
  recentPostText: string;      // Concatenated recent post content for analysis
  accountAgeDays?: number;
  postCount?: number;
  sourceUrl?: string;
  postExcerpt?: string;        // The specific post that triggered discovery
}

interface HuntParams {
  action: "hunt" | "status";
  mode?: "scheduled" | "burst";
  sources?: SourceName[];
  limit?: number;
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
// Stop words for keyword extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "its", "may", "new", "now", "old", "see", "two", "who", "boy", "did",
  "its", "let", "put", "say", "she", "too", "use", "that", "this", "with",
  "have", "from", "they", "will", "been", "each", "much", "some", "time",
  "very", "when", "come", "here", "just", "like", "long", "make", "many",
  "more", "only", "over", "such", "take", "than", "them", "well", "were",
  "what", "your", "also", "back", "even", "good", "into", "look", "most",
  "need", "know", "does", "feel", "help", "keep", "left", "live", "move",
  "name", "same", "show", "side", "talk", "then", "want", "work",
]);

// ---------------------------------------------------------------------------
// ICP helpers
// ---------------------------------------------------------------------------

function loadOnboardState(workdir: string): OnboardState | null {
  const filePath = path.join(workdir, "onboard_state.json");
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as OnboardState;
  } catch {
    return null;
  }
}

/**
 * Extract meaningful search keywords from ICP natural language answers.
 * Returns arrays of positive keywords and negative (avoid) keywords.
 */
function extractICPKeywords(icp: ICP): { positive: string[]; negative: string[] } {
  const positiveText = [
    icp.idealPerson ?? "",
    icp.problemFaced ?? "",
    icp.currentApproachFailing ?? "",
  ].join(" ");

  const words = positiveText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOP_WORDS.has(w));

  // Deduplicate
  const positive = [...new Set(words)].slice(0, 20); // Max 20 keywords per ICP

  const negativeWords = (icp.typesToAvoid ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const negative = [...new Set(negativeWords)].slice(0, 10);

  return { positive, negative };
}

// ---------------------------------------------------------------------------
// Intent signal detection patterns (Network Marketer flavor focused)
// ---------------------------------------------------------------------------

interface IntentPattern {
  pattern: RegExp;
  type: string;
  strength: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // Income / financial frustration — very strong signals
  { pattern: /\b(side\s*hustle|extra\s*income|passive\s*income|financial\s*freedom)\b/i, type: "side_hustle_interest", strength: 75 },
  { pattern: /\b(work\s*from\s*home|work\s*at\s*home|remote\s*work|wfh)\b/i, type: "side_hustle_interest", strength: 65 },
  { pattern: /\b(be\s*my\s*own\s*boss|own\s*business|start\s*a\s*business|entrepreneur)\b/i, type: "side_hustle_interest", strength: 70 },
  { pattern: /\b(tired\s*of\s*(my\s*)?(9\s*[-–]\s*5|job|boss)|quit\s*my\s*job|leave\s*my\s*job)\b/i, type: "income_complaint", strength: 72 },
  { pattern: /\b(can'?t\s*afford|struggling\s*(financially|with\s*money|with\s*bills)|need\s*more\s*money|broke|debt)\b/i, type: "income_complaint", strength: 68 },
  { pattern: /\b(lay\s*off|laid\s*off|lost\s*(my\s*)?job|job\s*loss|unemployed|looking\s*for\s*work)\b/i, type: "life_event", strength: 78 },
  { pattern: /\b(new\s*(baby|parent|mom|dad)|just\s*had\s*a\s*(baby|kid)|maternity|paternity)\b/i, type: "life_event", strength: 60 },
  { pattern: /\b(how\s*(do\s*i|can\s*i|to)\s*(make|earn|generate)\s*(money|income|cash))\b/i, type: "forum_question", strength: 70 },
  { pattern: /\b(any\s*(good\s*)?(way|ways)\s*to\s*(make|earn)\s*(money|income))\b/i, type: "forum_question", strength: 65 },
  { pattern: /\b(looking\s*(for\s*)?(opportunity|opportunities|business\s*opportunity|income\s*opportunity))\b/i, type: "side_hustle_interest", strength: 72 },
  { pattern: /\b(inflation|cost\s*of\s*living|bills\s*(are\s*)?(too\s*high|killing\s*me))\b/i, type: "pain_point_post", strength: 58 },
  { pattern: /\b(network\s*marketing|mlm|direct\s*sales|affiliate)\b/i, type: "side_hustle_interest", strength: 55 },
  { pattern: /\b(health\s*(and\s*)?wellness|lose\s*weight|get\s*fit|feel\s*better|natural\s*(health|remedy|supplement))\b/i, type: "pain_point_post", strength: 55 },
  { pattern: /\b(real\s*estate|investment\s*property|rental\s*income|landlord|flip\s*(houses|homes))\b/i, type: "side_hustle_interest", strength: 60 },
  { pattern: /\b(competitor|alternative\s*to|instead\s*of|switched\s*from|left\s*[a-z]+\s*for)\b/i, type: "competitor_engagement", strength: 50 },
];

/**
 * Detect intent signals from post/bio text.
 * Returns array of detected signals.
 */
function detectIntentSignals(
  text: string,
  source: string,
  excerpt: string
): IntentSignalRecord[] {
  const signals: IntentSignalRecord[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  for (const { pattern, type, strength } of INTENT_PATTERNS) {
    if (pattern.test(text) && !seen.has(type)) {
      seen.add(type);
      signals.push({
        type,
        strength,
        detectedAt: now,
        source,
        excerpt: excerpt.slice(0, 200),
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// ProfileFit scoring
// ---------------------------------------------------------------------------

/**
 * Score how well a discovered profile matches the tenant's ICP.
 * Returns 0-100.
 */
function scoreProfileFit(
  profile: DiscoveredProfile,
  positiveKeywords: string[],
  negativeKeywords: string[]
): { score: number; matchedKeywords: string[]; flaggedNegatives: string[] } {
  const text = `${profile.bio ?? ""} ${profile.recentPostText}`.toLowerCase();
  let score = 40; // Base — neutral

  const matchedKeywords: string[] = [];
  const flaggedNegatives: string[] = [];

  // Positive keyword matches
  for (const kw of positiveKeywords) {
    if (text.includes(kw)) {
      score += 5;
      matchedKeywords.push(kw);
    }
  }

  // Negative keyword penalties
  for (const nk of negativeKeywords) {
    if (text.includes(nk)) {
      score -= 20;
      flaggedNegatives.push(nk);
    }
  }

  // Account credibility signals
  if (profile.accountAgeDays !== undefined) {
    if (profile.accountAgeDays < 7) score -= 30;      // Likely bot / new fake account
    else if (profile.accountAgeDays > 180) score += 10; // Established account
  }

  if (profile.postCount !== undefined) {
    if (profile.postCount < 3) score -= 15;  // Low activity
    else if (profile.postCount > 20) score += 5;  // Active user
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    matchedKeywords,
    flaggedNegatives,
  };
}

// ---------------------------------------------------------------------------
// Scoring math — mirrors tiger_score.ts (LOCKED constants)
// ---------------------------------------------------------------------------

function computeIntentScore(signals: IntentSignalRecord[]): number {
  if (signals.length === 0) return 0;
  const now = Date.now();
  let weightedSum = 0;
  let maxPossible = 0;
  for (const signal of signals) {
    const ageDays = (now - new Date(signal.detectedAt).getTime()) / 86400000;
    const decayFactor = Math.exp(-ageDays / INTENT_DECAY_TAU_DAYS);
    weightedSum += signal.strength * decayFactor;
    maxPossible += signal.strength;
  }
  if (maxPossible === 0) return 0;
  return Math.min(100, Math.round((weightedSum / maxPossible) * 100));
}

function computeCompositeScore(
  profileFit: number,
  intentScore: number,
  oar: "builder" | "customer"
): number {
  const w = oar === "builder" ? BUILDER_WEIGHTS : CUSTOMER_WEIGHTS;
  // Engagement is 0 at discovery — only profileFit and intentSignals count
  return Math.min(100, Math.round(profileFit * w.profileFit + intentScore * w.intentSignals));
}

function buildAndSaveLead(
  workdir: string,
  profile: DiscoveredProfile,
  intentSignals: IntentSignalRecord[],
  profileFit: number,
  matchedKeywords: string[],
  negativeSignals: string[],
  oar: OarType
): LeadRecord {
  const leads = loadLeads(workdir);

  // Deduplication — same person on same platform
  const existing = Object.values(leads).find(
    (l) => l.platform === profile.platform && l.platformId === profile.platformId
  );

  if (existing && !existing.optedOut) {
    // Merge new intent signals (dedup by type+day)
    const existingKeys = new Set(
      existing.intentSignalHistory.map((s) => `${s.type}:${s.detectedAt.slice(0, 10)}`)
    );
    for (const sig of intentSignals) {
      const key = `${sig.type}:${sig.detectedAt.slice(0, 10)}`;
      if (!existingKeys.has(key)) {
        existing.intentSignalHistory.push(sig);
        existingKeys.add(key);
      }
    }
    existing.profileFit = profileFit;
    existing.keywords = matchedKeywords;
    existing.negativeSignals = negativeSignals;
    existing.lastSignalAt = new Date().toISOString();
    // Re-score
    recomputeAndSave(existing, leads, workdir);
    return existing;
  }

  if (existing?.optedOut) {
    return existing; // Never re-process opted-out leads
  }

  // New lead
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const intentScore = computeIntentScore(intentSignals);

  const rawBuilderScore = oar !== "customer" ? computeCompositeScore(profileFit, intentScore, "builder") : 0;
  const rawCustomerScore = oar !== "builder" ? computeCompositeScore(profileFit, intentScore, "customer") : 0;

  let builderScore = rawBuilderScore;
  let customerScore = rawCustomerScore;
  let isUnicorn = false;
  let unicornBonusApplied = false;

  if (oar === "both" && builderScore > 0 && customerScore > 0 && Math.min(builderScore, customerScore) >= 20) {
    isUnicorn = true;
    unicornBonusApplied = true;
    const higherOar = builderScore >= customerScore ? "builder" : "customer";
    if (higherOar === "builder") {
      builderScore = Math.min(100, builderScore + UNICORN_BONUS);
    } else {
      customerScore = Math.min(100, customerScore + UNICORN_BONUS);
    }
  } else if (oar === "both") {
    isUnicorn = builderScore > 0 && customerScore > 0;
  }

  const builderQualifies = oar !== "customer" && builderScore >= SCORE_THRESHOLD;
  const customerQualifies = oar !== "builder" && customerScore >= SCORE_THRESHOLD;
  const qualified = builderQualifies || customerQualifies;
  const qualifyingOar: "builder" | "customer" = builderQualifies ? "builder" : "customer";
  const qualifyingScore = qualifyingOar === "builder" ? builderScore : customerScore;
  const primaryOar: "builder" | "customer" = oar === "both" ? "builder" : (oar as "builder" | "customer");

  const record: LeadRecord = {
    id,
    platform: profile.platform,
    platformId: profile.platformId,
    displayName: profile.displayName,
    profileUrl: profile.profileUrl,
    bio: profile.bio,
    keywords: matchedKeywords,
    negativeSignals,
    profileFit,
    rawIntentStrength: Math.max(...intentSignals.map((s) => s.strength), 0),
    engagement: 0,
    intentScore,
    builderScore,
    customerScore,
    oar,
    primaryOar,
    isUnicorn,
    unicornBonusApplied,
    qualified,
    qualifyingScore,
    qualifyingOar,
    qualifiedAt: qualified ? now : undefined,
    optedOut: false,
    intentSignalHistory: intentSignals,
    engagementEvents: [],
    involvementLevel: 0,
    discoveredAt: now,
    lastSignalAt: now,
    lastScoredAt: now,
    purgeAt: new Date(Date.now() + PURGE_DAYS * 86400000).toISOString(),
  };

  leads[id] = record;
  saveLeads(workdir, leads);
  return record;
}

function recomputeAndSave(lead: LeadRecord, leads: LeadsStore, workdir: string): void {
  const intentScore = computeIntentScore(lead.intentSignalHistory);
  lead.intentScore = intentScore;

  const rawBuilder = lead.oar !== "customer" ? computeCompositeScore(lead.profileFit, intentScore, "builder") : 0;
  const rawCustomer = lead.oar !== "builder" ? computeCompositeScore(lead.profileFit, intentScore, "customer") : 0;

  lead.builderScore = rawBuilder;
  lead.customerScore = rawCustomer;

  if (lead.oar === "both" && rawBuilder > 0 && rawCustomer > 0 && Math.min(rawBuilder, rawCustomer) >= 20) {
    lead.isUnicorn = true;
    lead.unicornBonusApplied = true;
    if (rawBuilder >= rawCustomer) {
      lead.builderScore = Math.min(100, rawBuilder + UNICORN_BONUS);
    } else {
      lead.customerScore = Math.min(100, rawCustomer + UNICORN_BONUS);
    }
  }

  const qualified =
    (lead.oar !== "customer" && lead.builderScore >= SCORE_THRESHOLD) ||
    (lead.oar !== "builder" && lead.customerScore >= SCORE_THRESHOLD);

  if (qualified && !lead.qualified) {
    lead.qualifiedAt = new Date().toISOString();
  }
  lead.qualified = qualified;
  lead.qualifyingScore = Math.max(lead.builderScore, lead.customerScore);
  lead.qualifyingOar = lead.builderScore >= lead.customerScore ? "builder" : "customer";
  lead.lastScoredAt = new Date().toISOString();

  leads[lead.id] = lead;
  saveLeads(workdir, leads);
}

// ---------------------------------------------------------------------------
// Lead persistence
// ---------------------------------------------------------------------------

function loadLeads(workdir: string): LeadsStore {
  const p = path.join(workdir, "leads.json");
  try {
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) as LeadsStore;
  } catch {
    return {};
  }
}

function saveLeads(workdir: string, leads: LeadsStore): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, "leads.json"), JSON.stringify(leads, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Scout state (rate limiting)
// ---------------------------------------------------------------------------

function loadScoutState(workdir: string): ScoutState {
  const p = path.join(workdir, "scout_state.json");
  try {
    if (!fs.existsSync(p)) {
      return { burstCountToday: 0, burstCountDate: "", totalLeadsDiscovered: 0, totalLeadsQualified: 0 };
    }
    return JSON.parse(fs.readFileSync(p, "utf8")) as ScoutState;
  } catch {
    return { burstCountToday: 0, burstCountDate: "", totalLeadsDiscovered: 0, totalLeadsQualified: 0 };
  }
}

function saveScoutState(workdir: string, state: ScoutState): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, "scout_state.json"), JSON.stringify(state, null, 2), "utf8");
}

function checkRateLimit(
  state: ScoutState,
  mode: "scheduled" | "burst"
): { allowed: boolean; reason?: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (mode === "scheduled") {
    if (state.lastScheduledScan) {
      const lastScan = new Date(state.lastScheduledScan);
      const hoursSince = (now.getTime() - lastScan.getTime()) / 3600000;
      if (hoursSince < 23) {
        return {
          allowed: false,
          reason: `Last scheduled scan was ${Math.round(hoursSince)} hours ago. Minimum interval is 23 hours.`,
        };
      }
    }
    return { allowed: true };
  }

  // Burst mode
  const burstCountToday = state.burstCountDate === today ? state.burstCountToday : 0;
  if (burstCountToday >= 3) {
    return { allowed: false, reason: "Maximum 3 burst scans per day reached." };
  }
  if (state.lastBurstScan) {
    const lastBurst = new Date(state.lastBurstScan);
    const hoursSince = (now.getTime() - lastBurst.getTime()) / 3600000;
    if (hoursSince < 1) {
      return {
        allowed: false,
        reason: `Last burst scan was ${Math.round(hoursSince * 60)} minutes ago. Minimum interval is 1 hour.`,
      };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpsGet(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
      },
      (res) => {
        let respBody = "";
        res.on("data", (chunk) => (respBody += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: respBody }));
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Source: Reddit
// ---------------------------------------------------------------------------

interface RedditPost {
  kind: string;
  data: {
    id: string;
    author: string;
    title: string;
    selftext: string;
    subreddit: string;
    url: string;
    permalink: string;
    score: number;
    created_utc: number;
  };
}

interface RedditUserAbout {
  data: {
    name: string;
    icon_img?: string;
    created_utc: number;
    comment_karma: number;
    link_karma: number;
  };
}

async function fetchRedditPosts(
  keywords: string[],
  limit: number,
  logger: ToolContext["logger"]
): Promise<DiscoveredProfile[]> {
  if (keywords.length === 0) return [];

  // Build query from top keywords (Reddit search)
  const query = keywords.slice(0, 5).join(" OR ");
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=week&limit=${Math.min(limit, 25)}`;

  logger.info("tiger_scout: searching Reddit", { query });

  let data: { data?: { children?: RedditPost[] } };
  try {
    const res = await httpsGet(url, {
      "User-Agent": "TigerClaw/1.0 (automated prospecting bot; contact via tigerclaw.io)",
    });
    if (res.statusCode !== 200) {
      logger.warn("tiger_scout: Reddit returned non-200", { statusCode: res.statusCode });
      return [];
    }
    data = JSON.parse(res.body);
  } catch (err) {
    logger.error("tiger_scout: Reddit fetch failed", { err: String(err) });
    return [];
  }

  const posts = data?.data?.children ?? [];
  const profiles: DiscoveredProfile[] = [];
  const seenAuthors = new Set<string>();

  for (const post of posts) {
    const { author, title, selftext, subreddit, permalink, created_utc } = post.data;

    // Skip deleted/bot accounts
    if (!author || author === "[deleted]" || author === "AutoModerator") continue;
    if (seenAuthors.has(author)) continue;
    seenAuthors.add(author);

    // Try to get user account info (best-effort, skip if it fails)
    let accountAgeDays: number | undefined;
    let postCount: number | undefined;

    try {
      const userRes = await httpsGet(
        `https://www.reddit.com/user/${encodeURIComponent(author)}/about.json`,
        { "User-Agent": "TigerClaw/1.0" }
      );
      if (userRes.statusCode === 200) {
        const userAbout: RedditUserAbout = JSON.parse(userRes.body);
        const accountCreatedMs = userAbout.data.created_utc * 1000;
        accountAgeDays = Math.floor((Date.now() - accountCreatedMs) / 86400000);
        postCount = (userAbout.data.comment_karma + userAbout.data.link_karma) > 0
          ? Math.ceil((userAbout.data.comment_karma + userAbout.data.link_karma) / 10)
          : 1;
      }
    } catch {
      // Non-fatal — proceed without user info
    }

    profiles.push({
      platform: "reddit",
      platformId: `reddit:${author}`,
      displayName: `u/${author}`,
      profileUrl: `https://www.reddit.com/user/${author}`,
      bio: undefined, // Reddit doesn't expose bio in public JSON easily
      recentPostText: `${title} ${selftext}`.slice(0, 1000),
      accountAgeDays,
      postCount,
      sourceUrl: `https://www.reddit.com${permalink}`,
      postExcerpt: `${title} ${selftext}`.slice(0, 300),
    });
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Source: Telegram
// ---------------------------------------------------------------------------

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

async function fetchTelegramMessages(
  keywords: string[],
  limit: number,
  logger: ToolContext["logger"]
): Promise<DiscoveredProfile[]> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    logger.warn("tiger_scout: TELEGRAM_BOT_TOKEN not set — skipping Telegram source");
    return [];
  }

  logger.info("tiger_scout: reading Telegram updates");

  let updates: TelegramUpdate[];
  try {
    const res = await httpsGet(
      `https://api.telegram.org/bot${botToken}/getUpdates?limit=100&timeout=0`,
      {}
    );
    if (res.statusCode !== 200) {
      logger.warn("tiger_scout: Telegram getUpdates returned non-200", { statusCode: res.statusCode });
      return [];
    }
    const parsed = JSON.parse(res.body) as { ok: boolean; result: TelegramUpdate[] };
    updates = parsed.result ?? [];
  } catch (err) {
    logger.error("tiger_scout: Telegram fetch failed", { err: String(err) });
    return [];
  }

  // Filter to messages from groups/channels (not the tenant's own DMs)
  // and that contain at least one ICP keyword
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));
  const profiles: DiscoveredProfile[] = [];
  const seenUsers = new Set<number>();

  for (const update of updates) {
    if (!update.message?.from || !update.message.text) continue;
    if (update.message.chat.type === "private") continue; // Skip DMs — search public groups only

    const { from, text, date } = update.message;
    if (!from.id || seenUsers.has(from.id)) continue;

    // Only process messages that contain at least one ICP keyword
    const msgLower = text.toLowerCase();
    const hasKeyword = [...keywordSet].some((k) => msgLower.includes(k));
    if (!hasKeyword && keywords.length > 0) continue;

    seenUsers.add(from.id);

    const displayName = from.username
      ? `@${from.username}`
      : `${from.first_name ?? ""}${from.last_name ? " " + from.last_name : ""}`.trim() || `tg:${from.id}`;

    const accountAgeDays = Math.floor((Date.now() - date * 1000) / 86400000);

    profiles.push({
      platform: "telegram",
      platformId: `telegram:${from.id}`,
      displayName,
      profileUrl: from.username ? `https://t.me/${from.username}` : undefined,
      recentPostText: text.slice(0, 1000),
      accountAgeDays: undefined, // Can't determine from message
      postCount: undefined,
      postExcerpt: text.slice(0, 300),
    });

    if (profiles.length >= limit) break;
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Source: Facebook Groups (Tier 2 — Public Passive via Serper search)
// ---------------------------------------------------------------------------

async function fetchFacebookPosts(
  keywords: string[],
  limit: number,
  logger: ToolContext["logger"]
): Promise<DiscoveredProfile[]> {
  if (keywords.length === 0) return [];

  const serperKey = process.env.SERPER_KEY_1 ?? process.env.SERPER_KEY_2 ?? process.env.SERPER_KEY_3;
  if (!serperKey) {
    logger.warn("tiger_scout: No SERPER_KEY configured — skipping Facebook source");
    return [];
  }

  const query = `site:facebook.com/groups ${keywords.slice(0, 5).join(" OR ")}`;
  logger.info("tiger_scout: searching Facebook Groups via Serper", { query });

  let results: Array<{ title?: string; snippet?: string; link?: string }> = [];
  try {
    const body = JSON.stringify({ q: query, num: Math.min(limit, 20) });
    const res = await httpsPost("https://google.serper.dev/search", body, {
      "X-API-KEY": serperKey,
      "Content-Type": "application/json",
    });
    if (res.statusCode !== 200) {
      logger.warn("tiger_scout: Serper returned non-200 for Facebook", { statusCode: res.statusCode });
      return [];
    }
    const parsed = JSON.parse(res.body) as { organic?: typeof results };
    results = parsed.organic ?? [];
  } catch (err) {
    logger.error("tiger_scout: Serper Facebook fetch failed", { err: String(err) });
    return [];
  }

  const profiles: DiscoveredProfile[] = [];
  const seenUrls = new Set<string>();

  for (const item of results) {
    if (!item.link || !item.snippet) continue;
    if (seenUrls.has(item.link)) continue;
    seenUrls.add(item.link);

    // Extract a display name from the title or URL
    const titleMatch = item.title?.match(/(.+?)[\s\-–|]/);
    const displayName = titleMatch?.[1]?.trim() || item.title?.slice(0, 60) || "Facebook User";

    // Create a stable platformId from the URL
    const urlHash = crypto.createHash("md5").update(item.link).digest("hex").slice(0, 12);

    profiles.push({
      platform: "facebook_groups",
      platformId: `facebook:${urlHash}`,
      displayName,
      profileUrl: item.link,
      recentPostText: `${item.title ?? ""} ${item.snippet}`.slice(0, 1000),
      sourceUrl: item.link,
      postExcerpt: item.snippet.slice(0, 300),
    });

    if (profiles.length >= limit) break;
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Source: LINE OpenChat (Tier 2 — Public Passive)
// Reads webhook-delivered messages stored in line_messages.json by the
// OpenClaw LINE channel adapter. Filters by ICP keywords.
// Falls back to Serper search if no local messages and SERPER_KEY is set.
// ---------------------------------------------------------------------------

interface LINEMessage {
  userId: string;
  displayName?: string;
  text: string;
  groupId: string;
  groupName?: string;
  timestamp: number;
}

async function fetchLINEPosts(
  keywords: string[],
  limit: number,
  logger: ToolContext["logger"],
  workdir?: string
): Promise<DiscoveredProfile[]> {
  if (keywords.length === 0) return [];

  // Strategy 1: Read locally stored LINE OpenChat messages (delivered by webhook)
  const lineMessagesPath = path.join(workdir ?? ".", "line_messages.json");
  let lineMessages: LINEMessage[] = [];
  try {
    if (fs.existsSync(lineMessagesPath)) {
      lineMessages = JSON.parse(fs.readFileSync(lineMessagesPath, "utf8")) as LINEMessage[];
    }
  } catch { /* fall through */ }

  if (lineMessages.length > 0) {
    logger.info("tiger_scout: reading LINE OpenChat messages", { count: lineMessages.length });

    const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));
    const profiles: DiscoveredProfile[] = [];
    const seenUsers = new Set<string>();

    for (const msg of lineMessages) {
      if (!msg.userId || !msg.text || seenUsers.has(msg.userId)) continue;

      const textLower = msg.text.toLowerCase();
      const hasKeyword = [...keywordSet].some((k) => textLower.includes(k));
      if (!hasKeyword && keywords.length > 0) continue;

      seenUsers.add(msg.userId);

      profiles.push({
        platform: "line_openchat",
        platformId: `line:${msg.userId}`,
        displayName: msg.displayName ?? `LINE:${msg.userId.slice(0, 8)}`,
        recentPostText: msg.text.slice(0, 1000),
        postExcerpt: msg.text.slice(0, 300),
        sourceUrl: msg.groupName ? `LINE OpenChat: ${msg.groupName}` : undefined,
      });

      if (profiles.length >= limit) break;
    }

    if (profiles.length > 0) return profiles;
  }

  // Strategy 2: Serper fallback — search for LINE OpenChat content on the web
  const serperKey = process.env.SERPER_KEY_1 ?? process.env.SERPER_KEY_2 ?? process.env.SERPER_KEY_3;
  if (!serperKey) {
    logger.info("tiger_scout: LINE source — no local messages and no SERPER_KEY");
    return [];
  }

  const query = `site:line.me/ti/g2 OR "LINE OpenChat" ${keywords.slice(0, 4).join(" OR ")}`;
  logger.info("tiger_scout: searching LINE OpenChat via Serper", { query });

  try {
    const body = JSON.stringify({ q: query, num: Math.min(limit, 15) });
    const res = await httpsPost("https://google.serper.dev/search", body, {
      "X-API-KEY": serperKey,
      "Content-Type": "application/json",
    });
    if (res.statusCode !== 200) {
      logger.warn("tiger_scout: Serper returned non-200 for LINE", { statusCode: res.statusCode });
      return [];
    }
    const parsed = JSON.parse(res.body) as { organic?: Array<{ title?: string; snippet?: string; link?: string }> };
    const results = parsed.organic ?? [];

    const profiles: DiscoveredProfile[] = [];
    for (const item of results) {
      if (!item.snippet) continue;
      const urlHash = crypto.createHash("md5").update(item.link ?? item.snippet).digest("hex").slice(0, 12);

      profiles.push({
        platform: "line_openchat",
        platformId: `line:serper:${urlHash}`,
        displayName: item.title?.slice(0, 60) || "LINE User",
        profileUrl: item.link,
        recentPostText: `${item.title ?? ""} ${item.snippet}`.slice(0, 1000),
        sourceUrl: item.link,
        postExcerpt: item.snippet.slice(0, 300),
      });

      if (profiles.length >= limit) break;
    }

    return profiles;
  } catch (err) {
    logger.error("tiger_scout: Serper LINE fetch failed", { err: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Region → active sources mapping (LOCKED per spec Block 3.4)
// ---------------------------------------------------------------------------

function getActiveSources(region: string): SourceName[] {
  const regionSources: Record<string, SourceName[]> = {
    "us-en": ["reddit", "facebook_groups", "telegram"],
    "th-th": ["facebook_groups", "telegram", "line_openchat"],
  };
  return regionSources[region] ?? ["reddit", "telegram"];
}

// ---------------------------------------------------------------------------
// Core hunt logic
// ---------------------------------------------------------------------------

async function runHunt(
  workdir: string,
  mode: "scheduled" | "burst",
  sourceOverride: SourceName[] | undefined,
  limit: number,
  logger: ToolContext["logger"],
  region: string,
  flavor: string
): Promise<{
  discovered: number;
  qualified: number;
  qualifiedLeads: Array<{ displayName: string; platform: string; score: number; oar: string }>;
  below: number;
  sources: string[];
}> {
  const oar: OarType = flavor === "network-marketer" ? "both" : "customer";

  // Load ICP
  const onboardState = loadOnboardState(workdir);
  if (!onboardState || onboardState.phase !== "complete") {
    throw new Error("Onboarding not complete. Complete the onboarding interview before running discovery.");
  }

  // Extract keywords from appropriate ICP(s)
  const builderKeywords = flavor === "network-marketer"
    ? extractICPKeywords(onboardState.icpBuilder)
    : { positive: [], negative: [] };
  const customerKeywords = flavor !== "network-marketer"
    ? extractICPKeywords(onboardState.icpSingle)
    : extractICPKeywords(onboardState.icpCustomer);

  // Merge keywords (for search query — we search broadly and score precisely)
  const allPositive = [...new Set([...builderKeywords.positive, ...customerKeywords.positive])];
  const allNegative = [...new Set([...builderKeywords.negative, ...customerKeywords.negative])];

  // Fallback: if no ICP keywords, use flavor defaults
  if (allPositive.length === 0) {
    allPositive.push(...getFlavorDefaultKeywords(flavor));
  }

  const activeSources = sourceOverride ?? getActiveSources(region);
  const perSourceLimit = Math.ceil(limit / activeSources.length);

  let allProfiles: DiscoveredProfile[] = [];

  // Fetch from each active source
  for (const source of activeSources) {
    let profiles: DiscoveredProfile[] = [];
    try {
      switch (source) {
        case "reddit":
          profiles = await fetchRedditPosts(allPositive, perSourceLimit, logger);
          break;
        case "telegram":
          profiles = await fetchTelegramMessages(allPositive, perSourceLimit, logger);
          break;
        case "facebook_groups":
          profiles = await fetchFacebookPosts(allPositive, perSourceLimit, logger);
          break;
        case "line_openchat":
          profiles = await fetchLINEPosts(allPositive, perSourceLimit, logger, workdir);
          break;
      }
    } catch (err) {
      logger.error("tiger_scout: source fetch failed", { source, err: String(err) });
    }
    allProfiles = allProfiles.concat(profiles);
    logger.info("tiger_scout: source fetched", { source, count: profiles.length });
  }

  // Score each profile and write to leads.json
  let qualified = 0;
  let below = 0;
  const qualifiedLeads: Array<{ displayName: string; platform: string; score: number; oar: string }> = [];

  for (const profile of allProfiles) {
    // Score profileFit against the relevant ICP
    const fitResult = scoreProfileFit(profile, allPositive, allNegative);

    // Detect intent signals from post content
    const signals = detectIntentSignals(
      `${profile.bio ?? ""} ${profile.recentPostText}`,
      `${profile.platform}/${profile.sourceUrl ?? ""}`,
      profile.postExcerpt ?? profile.recentPostText.slice(0, 200)
    );

    // Write lead — deduplicates automatically
    const lead = buildAndSaveLead(
      workdir,
      profile,
      signals,
      fitResult.score,
      fitResult.matchedKeywords,
      fitResult.flaggedNegatives,
      oar
    );

    if (lead.optedOut) continue; // Skip opted-out leads

    if (lead.qualified) {
      qualified++;
      qualifiedLeads.push({
        displayName: lead.displayName,
        platform: lead.platform,
        score: lead.qualifyingScore,
        oar: lead.qualifyingOar,
      });
    } else {
      below++;
    }
  }

  return {
    discovered: allProfiles.length,
    qualified,
    qualifiedLeads,
    below,
    sources: activeSources,
  };
}

function getFlavorDefaultKeywords(flavor: string): string[] {
  const config = loadFlavorConfig(flavor);
  return config.defaultKeywords;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleHunt(
  params: HuntParams,
  workdir: string,
  logger: ToolContext["logger"],
  region: string,
  flavor: string
): Promise<ToolResult> {
  const mode = params.mode ?? "scheduled";
  const limit = params.limit ?? 50;
  const sourceOverride = params.sources;

  const scoutState = loadScoutState(workdir);

  // Rate limit check
  const rateCheck = checkRateLimit(scoutState, mode);
  if (!rateCheck.allowed) {
    return {
      ok: true,
      output: `Hunt skipped: ${rateCheck.reason}`,
      data: { skipped: true, reason: rateCheck.reason },
    };
  }

  logger.info("tiger_scout: starting hunt", { mode, limit });

  const result = await runHunt(workdir, mode, sourceOverride, limit, logger, region, flavor);

  // Update scout state
  const today = new Date().toISOString().slice(0, 10);
  if (mode === "scheduled") {
    scoutState.lastScheduledScan = new Date().toISOString();
  } else {
    scoutState.lastBurstScan = new Date().toISOString();
    scoutState.burstCountToday = scoutState.burstCountDate === today
      ? scoutState.burstCountToday + 1
      : 1;
    scoutState.burstCountDate = today;
  }
  scoutState.totalLeadsDiscovered += result.discovered;
  scoutState.totalLeadsQualified += result.qualified;
  scoutState.lastScanSummary = `${result.qualified} qualified / ${result.discovered} discovered`;
  saveScoutState(workdir, scoutState);

  const metTarget = result.qualified >= 5; // Daily target: minimum 5 qualified prospects
  const output = formatHuntOutput(result, metTarget);

  logger.info("tiger_scout: hunt complete", {
    discovered: result.discovered,
    qualified: result.qualified,
  });

  return {
    ok: true,
    output,
    data: {
      mode,
      sources: result.sources,
      discovered: result.discovered,
      qualified: result.qualified,
      below: result.below,
      metDailyTarget: metTarget,
      qualifiedLeads: result.qualifiedLeads,
    },
  };
}

function handleStatus(workdir: string): ToolResult {
  const state = loadScoutState(workdir);
  const leads = loadLeads(workdir);

  const qualifiedCount = Object.values(leads).filter((l) => l.qualified && !l.optedOut).length;
  const warmingCount = Object.values(leads).filter((l) => !l.qualified && !l.optedOut).length;
  const optedOutCount = Object.values(leads).filter((l) => l.optedOut).length;

  const output = [
    `Scout Status`,
    `Last scheduled scan: ${state.lastScheduledScan ? new Date(state.lastScheduledScan).toLocaleString() : "never"}`,
    `Last burst scan: ${state.lastBurstScan ? new Date(state.lastBurstScan).toLocaleString() : "never"}`,
    ``,
    `Pipeline:`,
    `  Qualified (ready for contact): ${qualifiedCount}`,
    `  Warming (below threshold):     ${warmingCount}`,
    `  Opted out (permanent):         ${optedOutCount}`,
    ``,
    `All time: ${state.totalLeadsDiscovered} discovered, ${state.totalLeadsQualified} qualified`,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      lastScheduledScan: state.lastScheduledScan ?? null,
      lastBurstScan: state.lastBurstScan ?? null,
      qualifiedCount,
      warmingCount,
      optedOutCount,
      totalDiscovered: state.totalLeadsDiscovered,
      totalQualified: state.totalLeadsQualified,
    },
  };
}

// ---------------------------------------------------------------------------
// Output formatter
// ---------------------------------------------------------------------------

function formatHuntOutput(
  result: {
    discovered: number;
    qualified: number;
    qualifiedLeads: Array<{ displayName: string; platform: string; score: number; oar: string }>;
    below: number;
    sources: string[];
  },
  metTarget: boolean
): string {
  const lines = [
    `Hunt complete. Sources: ${result.sources.join(", ")}`,
    `Discovered: ${result.discovered} prospects`,
    `Qualified (score ≥ 80): ${result.qualified}${metTarget ? " ✓ Daily target met" : " — below daily target of 5"}`,
    `Warming (below 80): ${result.below}`,
  ];

  if (result.qualifiedLeads.length > 0) {
    lines.push(``);
    lines.push(`Qualified leads ready for contact:`);
    for (const lead of result.qualifiedLeads) {
      const unicorn = lead.oar === "both" ? " 🦄" : "";
      lines.push(`  • ${lead.displayName} (${lead.platform}) — Score: ${lead.score}, Oar: ${lead.oar}${unicorn}`);
    }
  }

  if (result.discovered === 0) {
    lines.push(``);
    lines.push(`No prospects discovered this scan. This is normal for scheduled baseline scans.`);
    lines.push(`Try: refine your ICP keywords, or check that your sources are correctly configured.`);
  }

  return lines.join("\n");
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
  const region = (context.config["REGION"] as string) ?? "us-en";
  const flavor = (context.config["BOT_FLAVOR"] as string) ?? "network-marketer";

  logger.info("tiger_scout called", { action });

  try {
    switch (action) {
      case "hunt":
        return await handleHunt(params as unknown as HuntParams, workdir, logger, region, flavor);

      case "status":
        return handleStatus(workdir);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid actions: hunt | status`,
        };
    }
  } catch (err) {
    logger.error("tiger_scout error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_scout error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_scout = {
  name: "tiger_scout",
  description:
    "Prospect discovery engine. Searches Reddit, Telegram, Facebook, and LINE (based on regional config) for prospects matching the tenant's ICP. Scores each prospect and writes qualified leads (score ≥ 80) to the pipeline. Runs automatically at 5 AM tenant time via cron. Call with action: 'hunt' for on-demand scan, or action: 'status' to check pipeline and last scan times. Rate limited: scheduled min 23h apart, burst max 3/day with 1h between.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["hunt", "status"],
        description: "'hunt' — run a prospect discovery scan. 'status' — show pipeline counts and last scan info.",
      },
      mode: {
        type: "string",
        enum: ["scheduled", "burst"],
        description: "'scheduled' (default) — standard scan. 'burst' — intensive scan, limited to 3 per day.",
      },
      sources: {
        type: "array",
        items: { type: "string", enum: ["reddit", "telegram", "facebook", "line"] },
        description: "Override which sources to search. Defaults to regional config.",
      },
      limit: {
        type: "number",
        description: "Max prospects to evaluate across all sources. Default: 50.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_scout;
