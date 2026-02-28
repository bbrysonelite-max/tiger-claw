// Tiger Claw — tiger_score_1to10 Tool
// Standalone 1-10 Framework handler — Block 3.6 of TIGERCLAW-MASTER-SPEC-v2.md
//
// LOCKED rules:
//   Part 1: "On a scale of 1-10, where are you?" — a number, instantly sorts
//   Part 2: "What would you need to know to be a 10?" — fires for 6-7 ONLY
//   Gap-closing: match Part 2 answer to objection bucket → respond → re-ask Part 1
//   Max 2 rounds of gap-closing. Still 6-7 after 2 rounds → takeaway energy.
//
//   8-10 → move to Conversion
//   6-7  → Part 2 → gap-close (max 2 rounds) → takeaway if still stuck
//   ≤5   → Immediate takeaway
//
// This is the standalone tool. The same logic is embedded in tiger_nurture at
// touches 5-6. Use this tool for ad-hoc qualification pivots outside the
// scheduled nurture sequence.
//
// Objection buckets (network-marketer flavor, per spec v1):
//   compensation | product | time | reputation | trust | family | cost | unknown
//
// Actions: start | respond | get | list

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionStatus =
  | "awaiting_part1"       // Part 1 question sent, waiting for number
  | "awaiting_part2"       // 6-7 response — Part 2 question sent, waiting for text
  | "awaiting_reask"       // Gap-closing response sent — Part 1 re-asked
  | "complete";            // Outcome determined

type SessionOutcome =
  | "conversion"           // 8-10 — move to tiger_convert
  | "takeaway_immediate"   // ≤5 — immediate takeaway
  | "takeaway_rounds"      // 6-7 after 2 full rounds
  | "takeaway_30day"       // 30 days without moving up (used externally)
  | "in_progress";         // Still active

type ObjectionBucket =
  | "compensation"
  | "product"
  | "time"
  | "reputation"
  | "trust"
  | "family"
  | "cost"
  | "unknown";

interface DialogueTurn {
  role: "bot" | "prospect";
  message: string;
  timestamp: string;
  score?: number;               // If prospect gave a number
  objectionBucket?: ObjectionBucket;
}

interface ScoreSession {
  id: string;
  leadId?: string;
  context: string;              // "the opportunity", "the product", etc.
  flavor: string;

  status: SessionStatus;
  outcome: SessionOutcome;
  round: number;                // 0 = not started, 1 = first round, 2 = second round

  lastScore?: number;           // Most recent Part 1 score given
  part2Answer?: string;         // Most recent Part 2 text answer
  lastBucket?: ObjectionBucket; // Classified objection from Part 2

  history: DialogueTurn[];
  createdAt: string;
  updatedAt: string;
}

interface SessionStore {
  [sessionId: string]: ScoreSession;
}

interface OnboardState {
  phase: string;
  flavor: string;
  identity: {
    name?: string;
    productOrOpportunity?: string;
    biggestWin?: string;
    yearsInProfession?: string;
    differentiator?: string;
  };
  botName?: string;
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

function loadStore(workdir: string): SessionStore {
  const p = path.join(workdir, "score_1to10_sessions.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as SessionStore;
  } catch { /* fall through */ }
  return {};
}

function saveStore(workdir: string, store: SessionStore): void {
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(
    path.join(workdir, "score_1to10_sessions.json"),
    JSON.stringify(store, null, 2),
    "utf8"
  );
}

function loadOnboard(workdir: string): OnboardState | null {
  const p = path.join(workdir, "onboard_state.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as OnboardState;
  } catch { /* fall through */ }
  return null;
}

// ---------------------------------------------------------------------------
// Objection bucket classifier
// ---------------------------------------------------------------------------

const BUCKET_KEYWORDS: Record<ObjectionBucket, string[]> = {
  compensation: ["money", "income", "earn", "pay", "paid", "salary", "profit", "commission", "compensation", "financial", "revenue", "return", "roi"],
  product: ["product", "work", "effective", "results", "proof", "evidence", "testimonial", "before", "after", "quality", "ingredients", "safe", "tested"],
  time: ["time", "busy", "schedule", "hours", "full-time", "part-time", "commitment", "juggle", "balance", "availability", "free", "spare"],
  reputation: ["pyramid", "mlm", "scheme", "scam", "legit", "legitimate", "real", "company", "brand", "reputation", "known", "credible", "trusted", "history"],
  trust: ["trust", "know you", "know them", "stranger", "who", "background", "experience", "credentials", "track record", "worked with", "vouch"],
  family: ["spouse", "husband", "wife", "partner", "family", "kids", "children", "home", "parents", "support", "approval", "together", "discuss"],
  cost: ["cost", "price", "expensive", "afford", "investment", "upfront", "startup", "fee", "charge", "risk", "money down", "how much"],
  unknown: [],
};

function classifyObjection(text: string): ObjectionBucket {
  const lower = text.toLowerCase();
  let bestBucket: ObjectionBucket = "unknown";
  let bestCount = 0;

  for (const [bucket, keywords] of Object.entries(BUCKET_KEYWORDS) as Array<[ObjectionBucket, string[]]>) {
    if (bucket === "unknown") continue;
    const count = keywords.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      bestBucket = bucket;
    }
  }

  return bestBucket;
}

// ---------------------------------------------------------------------------
// Message generators
// ---------------------------------------------------------------------------

function part1Question(context: string, botName: string): string {
  return [
    `Quick question — and I want an honest answer.`,
    ``,
    `On a scale of 1-10, where are you with ${context}? 1 = not interested at all. 10 = ready to go right now.`,
    ``,
    `Just give me a number.`,
    ``,
    `— ${botName}`,
  ].join("\n");
}

function part2Question(score: number, botName: string): string {
  return [
    `Okay — ${score}. I appreciate that.`,
    ``,
    `Here's what I want to know: what would you need to know to move that to a 10?`,
    ``,
    `Not trying to talk you into anything. I want to know what's in the gap. Whatever it is, I can either address it or tell you honestly that I can't — and either answer is fine.`,
    ``,
    `What's the thing?`,
    ``,
    `— ${botName}`,
  ].join("\n");
}

function gapClosingResponse(
  bucket: ObjectionBucket,
  answer: string,
  onboard: OnboardState,
  botName: string
): string {
  const tenantName = onboard.identity.name ?? "my operator";
  const biggestWin = onboard.identity.biggestWin ?? "built a real business in this space";
  const years = onboard.identity.yearsInProfession ?? "several years";
  const product = onboard.identity.productOrOpportunity ?? "this opportunity";

  const responses: Record<ObjectionBucket, string> = {
    compensation: [
      `Got it — the income question. That's fair.`,
      ``,
      `Here's what's real: this isn't "get rich quick" and ${tenantName} would never claim it is. What it is — for the people who work the 3-per-day principle consistently — is a compounding income stream that grows with your network. ${tenantName} ${biggestWin}. That happened through consistent, daily activity over time.`,
      ``,
      `There are realistic income numbers I can share if that would help. Just ask.`,
    ].join("\n"),

    product: [
      `Got it — you want to know if it actually works.`,
      ``,
      `That's the right question to ask. ${tenantName} has ${years} of results to point to. The proof isn't in marketing materials — it's in real people with real outcomes. I can connect you with specific examples that match your situation if that's useful.`,
    ].join("\n"),

    time: [
      `Got it — the time question. This one comes up a lot.`,
      ``,
      `${tenantName} built this part-time while working a full-time job. The 3-per-day rule sounds like a lot until you realize most people are already having 3 conversations a day — they're just not directing them. This is about focus, not more hours.`,
    ].join("\n"),

    reputation: [
      `Got it — you want to know if this is the real deal.`,
      ``,
      `${product} has been around long enough to build a track record. ${tenantName} has been doing this for ${years}. They've seen what works and what doesn't — and they wouldn't be here if this wasn't legitimate.`,
      ``,
      `The simplest test: talk to someone who's actually done it. I can arrange that.`,
    ].join("\n"),

    trust: [
      `Got it — you don't know ${tenantName} personally yet. That's honest.`,
      ``,
      `Here's what I can tell you: ${tenantName} ${biggestWin}. They've spent ${years} in this space. They have a track record with real people I can point you to. The trust gets built through a conversation — which is exactly what I'm here to set up.`,
    ].join("\n"),

    family: [
      `Got it — you want to talk it over with someone important to you. That's smart.`,
      ``,
      `${tenantName} has had this conversation with couples and families before. They're happy to include whoever matters in your decision. This isn't about pressuring one person — it's about making sure everyone who needs to understand it can.`,
    ].join("\n"),

    cost: [
      `Got it — the startup cost question. That's the right thing to look at.`,
      ``,
      `${tenantName} can walk you through exactly what's required, what the risk actually is, and how it compares to other ways of starting a business. The ROI framing is very different from the upfront-cost framing. Let them show you the math.`,
    ].join("\n"),

    unknown: [
      `Got it — "${answer.slice(0, 80)}${answer.length > 80 ? "..." : ""}".`,
      ``,
      `That's a fair thing to have on your mind. ${tenantName} has heard this before and can speak to it directly — better than I can in text. Their job is to give you a complete picture so you can make a real decision.`,
    ].join("\n"),
  };

  return [
    responses[bucket],
    ``,
    `With that in mind — back to the scale. Where are you now, 1-10?`,
    ``,
    `— ${botName}`,
  ].join("\n");
}

function takeawayMessage(score: number, round: number, botName: string, tenantName: string): string {
  if (score <= 5) {
    return [
      `Totally fair. A ${score} means this isn't right for you right now — and that's a real answer.`,
      ``,
      `I'm not going to push. If something changes down the road, I'm easy to find.`,
      ``,
      `${tenantName} appreciates the honest conversation.`,
      ``,
      `— ${botName}`,
    ].join("\n");
  }

  // 6-7 after 2 rounds
  return [
    `I hear you. After everything we've covered, you're still at ${score} — and I respect that.`,
    ``,
    `Here's the truth: if you're not at an 8, this probably isn't the right time. ${tenantName} only works with people who are genuinely excited about it — not people who got talked into it.`,
    ``,
    `I'm going to step back. If the timing ever changes, the door isn't closed.`,
    ``,
    `— ${botName}`,
  ].join("\n");
}

function conversionMessage(score: number, botName: string, tenantName: string, product: string): string {
  return [
    `${score}/10. That's what I was hoping to hear.`,
    ``,
    `You're ready. ${tenantName} is ready for you.`,
    ``,
    `I'm going to hand you off to them now — I'll introduce you properly, and they'll take it from here. You're going to be in good hands.`,
    ``,
    `— ${botName}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Score parser (extracts a number from freeform text)
// ---------------------------------------------------------------------------

function parseScore(text: string): number | null {
  // Match patterns like "7", "7/10", "a 7", "about 7", "maybe 7", "i'd say 7"
  const match = text.match(/\b([1-9]|10)\b/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 10) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Action: start
// ---------------------------------------------------------------------------

interface StartParams {
  action: "start";
  leadId?: string;
  context?: string;    // What we're scoring them on ("the opportunity", product name)
}

function handleStart(
  params: StartParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const onboard = loadOnboard(workdir);
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const botName = onboard.botName ?? "your Tiger Claw bot";
  const context = params.context ?? onboard.identity.productOrOpportunity ?? "the opportunity";
  const now = new Date().toISOString();

  const id = crypto.randomUUID();
  const question = part1Question(context, botName);

  const session: ScoreSession = {
    id,
    leadId: params.leadId,
    context,
    flavor: onboard.flavor ?? "network-marketer",
    status: "awaiting_part1",
    outcome: "in_progress",
    round: 0,
    history: [
      { role: "bot", message: question, timestamp: now },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const store = loadStore(workdir);
  store[id] = session;
  saveStore(workdir, store);

  logger.info("tiger_score_1to10: session started", { sessionId: id, leadId: params.leadId, context });

  return {
    ok: true,
    output: [
      `Session ${id} started.`,
      ``,
      `Send this to the prospect:`,
      `---`,
      question,
      `---`,
      ``,
      `Then call respond with sessionId: '${id}' and the prospect's reply.`,
    ].join("\n"),
    data: { sessionId: id, status: "awaiting_part1", messageText: question },
  };
}

// ---------------------------------------------------------------------------
// Action: respond — the full state machine
// ---------------------------------------------------------------------------

interface RespondParams {
  action: "respond";
  sessionId: string;
  prospectText: string;
}

function handleRespond(
  params: RespondParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const store = loadStore(workdir);
  const session = store[params.sessionId];
  if (!session) return { ok: false, error: `Session ${params.sessionId} not found.` };
  if (session.status === "complete") {
    return { ok: false, error: `Session ${params.sessionId} is already complete (outcome: ${session.outcome}).` };
  }

  const onboard = loadOnboard(workdir);
  if (!onboard) return { ok: false, error: "Onboard state not found." };

  const botName = onboard.botName ?? "your Tiger Claw bot";
  const tenantName = onboard.identity.name ?? "my operator";
  const product = onboard.identity.productOrOpportunity ?? "the opportunity";
  const now = new Date().toISOString();

  // Log prospect's turn
  const prospectTurn: DialogueTurn = {
    role: "prospect",
    message: params.prospectText,
    timestamp: now,
  };

  let nextMessage = "";
  let newStatus = session.status;
  let outcome: SessionOutcome = "in_progress";

  switch (session.status) {
    case "awaiting_part1":
    case "awaiting_reask": {
      const score = parseScore(params.prospectText);

      if (score === null) {
        // Can't parse a number — ask again gently
        nextMessage = [
          `Just want to make sure I understood — can you give me a number, 1-10?`,
          ``,
          `1 = definitely not interested, 10 = ready right now.`,
          ``,
          `— ${botName}`,
        ].join("\n");
        // Don't advance status
        break;
      }

      prospectTurn.score = score;
      session.lastScore = score;
      session.round++;

      if (score >= 8) {
        // → Conversion
        nextMessage = conversionMessage(score, botName, tenantName, product);
        newStatus = "complete";
        outcome = "conversion";
      } else if (score <= 5) {
        // → Immediate takeaway
        nextMessage = takeawayMessage(score, session.round, botName, tenantName);
        newStatus = "complete";
        outcome = "takeaway_immediate";
      } else {
        // 6-7
        if (session.round > 2) {
          // Exceeded max rounds → takeaway
          nextMessage = takeawayMessage(score, session.round, botName, tenantName);
          newStatus = "complete";
          outcome = "takeaway_rounds";
        } else {
          // Fire Part 2
          nextMessage = part2Question(score, botName);
          newStatus = "awaiting_part2";
        }
      }
      break;
    }

    case "awaiting_part2": {
      // Prospect answered Part 2 (text answer about what would make it a 10)
      session.part2Answer = params.prospectText;
      const bucket = classifyObjection(params.prospectText);
      session.lastBucket = bucket;
      prospectTurn.objectionBucket = bucket;

      nextMessage = gapClosingResponse(bucket, params.prospectText, onboard, botName);
      newStatus = "awaiting_reask"; // Part 1 re-asked inside gapClosingResponse
      break;
    }
  }

  // Record turns and save
  session.history.push(prospectTurn);
  if (nextMessage) {
    session.history.push({ role: "bot", message: nextMessage, timestamp: now });
  }
  session.status = newStatus;
  session.outcome = outcome;
  session.updatedAt = now;

  store[params.sessionId] = session;
  saveStore(workdir, store);

  logger.info("tiger_score_1to10: respond", {
    sessionId: params.sessionId,
    status: newStatus,
    outcome,
    lastScore: session.lastScore,
    round: session.round,
    bucket: session.lastBucket,
  });

  const outputLines = [
    `Session ${params.sessionId} — status: ${newStatus}${outcome !== "in_progress" ? `, outcome: ${outcome}` : ""}.`,
  ];

  if (outcome === "conversion") {
    outputLines.push(`🎯 CONVERSION — score ${session.lastScore}/10.`);
    outputLines.push(`Call tiger_convert initiate with leadId: '${session.leadId ?? "[leadId]"}'.`);
  } else if (outcome === "takeaway_immediate") {
    outputLines.push(`Takeaway applied (score ≤5). No further pursuit.`);
  } else if (outcome === "takeaway_rounds") {
    outputLines.push(`Takeaway applied (6-7 after ${session.round} rounds). Slow drip.`);
  } else if (newStatus === "awaiting_part2") {
    outputLines.push(`Part 2 question ready. Waiting for their gap answer.`);
  } else if (newStatus === "awaiting_reask") {
    outputLines.push(`Gap-closing response ready (round ${session.round}/${2}). Part 1 re-asked.`);
  }

  if (nextMessage) {
    outputLines.push(``, `Send to prospect:`, `---`, nextMessage, `---`);
  }

  return {
    ok: true,
    output: outputLines.join("\n"),
    data: {
      sessionId: params.sessionId,
      status: newStatus,
      outcome,
      lastScore: session.lastScore,
      round: session.round,
      bucket: session.lastBucket,
      nextMessage: nextMessage || undefined,
      leadId: session.leadId,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: get
// ---------------------------------------------------------------------------

function handleGet(sessionId: string, workdir: string): ToolResult {
  const store = loadStore(workdir);
  const session = store[sessionId];
  if (!session) return { ok: false, error: `Session ${sessionId} not found.` };

  const lines = [
    `Session ${sessionId}`,
    `  Context:   ${session.context}`,
    `  Status:    ${session.status}`,
    `  Outcome:   ${session.outcome}`,
    `  Round:     ${session.round}/2`,
    `  Last score: ${session.lastScore ?? "—"}`,
    `  Last bucket: ${session.lastBucket ?? "—"}`,
    `  Turns:     ${session.history.length}`,
    `  Started:   ${new Date(session.createdAt).toUTCString()}`,
  ];

  return {
    ok: true,
    output: lines.join("\n"),
    data: session,
  };
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

function handleList(workdir: string, limit: number): ToolResult {
  const store = loadStore(workdir);
  const all = Object.values(store).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  if (all.length === 0) return { ok: true, output: "No 1-10 sessions yet.", data: { sessions: [] } };

  const lines = [`Last ${Math.min(limit, all.length)} 1-10 session(s):`];
  for (const s of all.slice(0, limit)) {
    const scoreLabel = s.lastScore !== undefined ? `score: ${s.lastScore}` : "no score yet";
    lines.push(`  • [${s.status}] ${scoreLabel} — ${s.context} — ${s.outcome} — ${new Date(s.createdAt).toDateString()}`);
  }

  const outcomeCount: Record<string, number> = {};
  for (const s of all) outcomeCount[s.outcome] = (outcomeCount[s.outcome] ?? 0) + 1;
  lines.push(``, `Outcomes: ${Object.entries(outcomeCount).map(([o, n]) => `${o}: ${n}`).join(", ")}`);

  return {
    ok: true,
    output: lines.join("\n"),
    data: { sessions: all.slice(0, limit), total: all.length, outcomeCount },
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

  logger.info("tiger_score_1to10 called", { action });

  try {
    switch (action) {
      case "start":
        return handleStart(params as unknown as StartParams, workdir, logger);

      case "respond":
        return handleRespond(params as unknown as RespondParams, workdir, logger);

      case "get":
        return handleGet(params.sessionId as string, workdir);

      case "list":
        return handleList(workdir, typeof params.limit === "number" ? params.limit : 10);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: start | respond | get | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_score_1to10 error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_score_1to10 error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_score_1to10 = {
  name: "tiger_score_1to10",
  description:
    "Standalone 1-10 qualification framework. Two-part question sequence with gap-closing. Part 1: '1-10 where are you?' Part 2 (6-7 only): 'What would you need to know to be a 10?' Classifies Part 2 answers into objection buckets (compensation/product/time/reputation/trust/family/cost) and returns targeted gap-closing response. Re-asks Part 1 after each gap-close. Max 2 rounds — still 6-7 after round 2 = takeaway. 8-10 = conversion signal. ≤5 = immediate takeaway. Persists sessions in score_1to10_sessions.json. Use this for ad-hoc qualification outside the scheduled nurture sequence.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "respond", "get", "list"],
        description:
          "start: begin a new 1-10 session, returns Part 1 question. respond: process prospect's reply, returns next message. get: retrieve session state. list: show recent sessions with outcomes.",
      },
      leadId: {
        type: "string",
        description: "Optional lead UUID to associate the session with a lead record.",
      },
      context: {
        type: "string",
        description: "What we are scoring them on, e.g. 'the opportunity', 'the product', 'joining the team'. Defaults to the tenant's productOrOpportunity from onboard_state.",
      },
      sessionId: {
        type: "string",
        description: "Session UUID. Required for respond and get.",
      },
      prospectText: {
        type: "string",
        description: "The prospect's actual reply text. Required for respond. Can be a number ('7'), fraction ('7/10'), or free text for Part 2 gap answers.",
      },
      limit: {
        type: "number",
        description: "Number of sessions to return for list action. Defaults to 10.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_score_1to10;
