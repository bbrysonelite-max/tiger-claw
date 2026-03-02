// Tiger Claw — tiger_onboard Tool
// Onboarding interview flow — Block 5, Section 5.2 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Five phases:
//   Phase 1 — Identity: "Who are you?" (6 questions)
//   Phase 2 — ICP: "Who are you looking for?" (5 questions + confirm). Runs twice
//              for two-oar flavors (builder + customer), once for single-oar.
//   Phase 3 — Key Setup: Primary key → validate. Fallback key → validate. CANNOT skip.
//   Phase 4 — Naming Ceremony: Bot name → regenerate SOUL.md
//   Phase 5 — Flywheel Start: Set tenant active, trigger first scout
//
// State is persisted to {workdir}/onboard_state.json between calls.
// SOUL.md is written to {workdir}/SOUL.md after Phase 4.

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { resolveConfig, generateSoulMd, type TenantData } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OnboardPhase =
  | "identity"
  | "icp_builder"
  | "icp_builder_confirm"
  | "icp_customer"
  | "icp_customer_confirm"
  | "icp_single"
  | "icp_single_confirm"
  | "keys_primary"
  | "keys_primary_retry"
  | "keys_fallback"
  | "keys_fallback_retry"
  | "naming"
  | "complete";

interface IdentityAnswers {
  name?: string;
  productOrOpportunity?: string;
  yearsInProfession?: string;
  monthlyIncomeGoal?: string;
  biggestWin?: string;
  differentiator?: string;
}

interface ICPAnswers {
  idealPerson?: string;
  problemFaced?: string;
  currentApproachFailing?: string;
  onlinePlatforms?: string;
  typesToAvoid?: string;
  confirmed?: boolean;
  adjustmentNote?: string;
}

interface OnboardState {
  phase: OnboardPhase;
  questionIndex: number;
  identity: IdentityAnswers;
  icpBuilder: ICPAnswers;
  icpCustomer: ICPAnswers;
  icpSingle: ICPAnswers;
  primaryKeyValidated: boolean;
  fallbackKeyValidated: boolean;
  // Actual key values stored so key_state.json can be written on completion
  // and the entrypoint can resolve the correct Layer 2/3 key after a restart.
  primaryKey?: string;
  fallbackKey?: string;
  botName?: string;
  flavor: string;
  language: string;
  tenantId: string;
  startedAt: string;
  completedAt?: string;
}

interface OnboardParams {
  action: "start" | "respond" | "status";
  response?: string;
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
// Constants — Questions per phase
// ---------------------------------------------------------------------------

// Identity question keys match IdentityAnswers field names (in order)
const IDENTITY_QUESTION_KEYS: (keyof IdentityAnswers)[] = [
  "name",
  "productOrOpportunity",
  "yearsInProfession",
  "monthlyIncomeGoal",
  "biggestWin",
  "differentiator",
];

// Returns the question text for the given identity field, adapted for the flavor's profession label
function identityQuestion(key: keyof IdentityAnswers, profession: string): string {
  const questions: Record<keyof IdentityAnswers, string> = {
    name: "What's your name?",
    productOrOpportunity: `What product or opportunity do you represent?`,
    yearsInProfession: `How long have you been in ${profession}?`,
    monthlyIncomeGoal: "What's your monthly income goal?",
    biggestWin:
      "What's your biggest win so far? (I'll use this to build credibility for you with prospects.)",
    differentiator: "What makes you different from others in your field?",
  };
  return questions[key];
}

// ICP question keys match ICPAnswers field names (in order)
const ICP_QUESTION_KEYS: (keyof ICPAnswers)[] = [
  "idealPerson",
  "problemFaced",
  "currentApproachFailing",
  "onlinePlatforms",
  "typesToAvoid",
];

// Returns the question text for the given ICP field, labeled by oar type
function icpQuestion(
  key: keyof ICPAnswers,
  oarLabel: "recruit" | "customer" | "client"
): string {
  const questions: Record<string, string> = {
    idealPerson: `Describe your ideal ${oarLabel}. Who are they? What do they look like on paper?`,
    problemFaced: `What problem is your ideal ${oarLabel} trying to solve?`,
    currentApproachFailing: `What are they currently doing that isn't working?`,
    onlinePlatforms: `Where does your ideal ${oarLabel} spend time online? (e.g., Facebook groups, Reddit, Telegram channels, LinkedIn)`,
    typesToAvoid: `Any types of people you want to avoid contacting?`,
  };
  return questions[key] ?? "";
}

// ---------------------------------------------------------------------------
// Flavor helpers
// ---------------------------------------------------------------------------

// Returns true if this flavor runs two oars (business builder + customer)
function isTwoOarFlavor(flavor: string): boolean {
  return flavor === "network-marketer";
}

// Returns a human-readable profession label for identity questions
function professionLabel(flavor: string): string {
  const labels: Record<string, string> = {
    "network-marketer": "network marketing",
    "real-estate": "real estate",
    "health-wellness": "health & wellness",
  };
  return labels[flavor] ?? "your profession";
}

// Returns the oar label for ICP questions
function oarLabel(flavor: string, oar: "builder" | "customer" | "single"): "recruit" | "customer" | "client" {
  if (oar === "builder") return "recruit";
  if (flavor === "real-estate") return "client";
  return "customer";
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function stateFilePath(workdir: string): string {
  return path.join(workdir, "onboard_state.json");
}

function loadState(workdir: string): OnboardState | null {
  const filePath = stateFilePath(workdir);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as OnboardState;
  } catch {
    return null;
  }
}

function saveState(workdir: string, state: OnboardState): void {
  const filePath = stateFilePath(workdir);
  // Ensure workdir exists
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function initialState(workdir: string): OnboardState {
  const flavor = process.env.BOT_FLAVOR ?? "network-marketer";
  const language = process.env.PREFERRED_LANGUAGE ?? "en";
  const tenantId = process.env.TIGER_CLAW_TENANT_ID ?? "unknown";

  return {
    phase: "identity",
    questionIndex: 0,
    identity: {},
    icpBuilder: {},
    icpCustomer: {},
    icpSingle: {},
    primaryKeyValidated: false,
    fallbackKeyValidated: false,
    flavor,
    language,
    tenantId,
    startedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — Identity
// ---------------------------------------------------------------------------

function handleIdentity(
  state: OnboardState,
  response: string | undefined,
  workdir: string
): ToolResult {
  const profession = professionLabel(state.flavor);

  // First call (action: 'start') — no answer yet, just ask question 0
  if (state.questionIndex === 0 && response === undefined) {
    const question = identityQuestion(IDENTITY_QUESTION_KEYS[0], profession);
    state.questionIndex = 1;
    saveState(workdir, state);
    return {
      ok: true,
      output: `Great, let's get you set up. I have a few quick questions so I can represent you properly.\n\n${question}`,
      data: { phase: "identity", questionIndex: 1, progressPercent: 5 },
    };
  }

  // Save the answer to the question we just asked (questionIndex - 1)
  if (response !== undefined) {
    const answeredKey = IDENTITY_QUESTION_KEYS[state.questionIndex - 1];
    (state.identity as Record<string, string>)[answeredKey] = response.trim();
  }

  // More identity questions remaining
  if (state.questionIndex < IDENTITY_QUESTION_KEYS.length) {
    const question = identityQuestion(IDENTITY_QUESTION_KEYS[state.questionIndex], profession);
    state.questionIndex++;
    saveState(workdir, state);
    return {
      ok: true,
      output: question,
      data: { phase: "identity", questionIndex: state.questionIndex, progressPercent: 10 },
    };
  }

  // Identity complete — transition to ICP, ask first ICP question immediately
  state.phase = isTwoOarFlavor(state.flavor) ? "icp_builder" : "icp_single";
  state.questionIndex = 1; // Q0 is included in icpIntro below; Q1 is next

  const icpIntro = isTwoOarFlavor(state.flavor)
    ? `Perfect. Now let's build your recruiting engine. I need to understand exactly who you're hunting for — first your Business Builders, then your Customers.\n\n${icpQuestion("idealPerson", "recruit")}`
    : `Perfect. Now let's talk about who you're looking for.\n\n${icpQuestion("idealPerson", oarLabel(state.flavor, "single"))}`;

  saveState(workdir, state);

  return {
    ok: true,
    output: icpIntro,
    data: { phase: state.phase, questionIndex: 1, progressPercent: 20 },
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — ICP
// ---------------------------------------------------------------------------

function buildICPSummary(
  answers: ICPAnswers,
  oarDescription: string
): string {
  return [
    `Here's your ${oarDescription} profile:`,
    `• Who they are: ${answers.idealPerson ?? "—"}`,
    `• Problem they face: ${answers.problemFaced ?? "—"}`,
    `• What's not working for them: ${answers.currentApproachFailing ?? "—"}`,
    `• Where they hang out online: ${answers.onlinePlatforms ?? "—"}`,
    `• Types to avoid: ${answers.typesToAvoid ?? "—"}`,
    ``,
    `Does this look right? Reply "yes" to confirm, or tell me what to adjust.`,
  ].join("\n");
}

function handleICP(
  state: OnboardState,
  response: string | undefined,
  workdir: string
): ToolResult {
  const phase = state.phase as
    | "icp_builder"
    | "icp_builder_confirm"
    | "icp_customer"
    | "icp_customer_confirm"
    | "icp_single"
    | "icp_single_confirm";

  // Determine which ICP object we're working on
  const isBuilder = phase === "icp_builder" || phase === "icp_builder_confirm";
  const isSingle = phase === "icp_single" || phase === "icp_single_confirm";
  const icpData = isBuilder
    ? state.icpBuilder
    : isSingle
    ? state.icpSingle
    : state.icpCustomer;

  // Confirmation phases — tenant is reviewing the summary
  if (phase === "icp_builder_confirm" || phase === "icp_customer_confirm" || phase === "icp_single_confirm") {
    const normalized = (response ?? "").toLowerCase().trim();
    const confirmed = normalized === "yes" || normalized === "y" || normalized.startsWith("yes");

    if (confirmed) {
      icpData.confirmed = true;
      return transitionAfterICPConfirm(state, workdir);
    }

    // Tenant wants to adjust — store the note and re-show updated summary
    icpData.adjustmentNote = response ?? "";
    // Apply simple adjustments: if the response contains field-specific edits, note them
    // The agent will use the adjustment note to update the ICP in context
    const oarDesc =
      phase === "icp_builder_confirm"
        ? "ideal recruit"
        : phase === "icp_customer_confirm"
        ? "ideal customer"
        : `ideal ${oarLabel(state.flavor, "single")}`;

    // Stay in confirm phase — update adjustmentNote, let agent know to adjust
    saveState(workdir, state);
    return {
      ok: true,
      output: `Got it. I've noted your adjustment: "${response}"\n\nHere's the revised ${oarDesc} profile:\n\n${buildICPSummary(icpData, oarDesc)}\n\n(The above incorporates your note. Reply "yes" to confirm or tell me what else to change.)`,
      data: { phase, progressPercent: 40, adjustmentNote: response },
    };
  }

  // Question phases — collecting answers
  if (response !== undefined && state.questionIndex > 0) {
    const prevKey = ICP_QUESTION_KEYS[state.questionIndex - 1];
    (icpData as Record<string, string>)[prevKey] = response.trim();
  }

  if (state.questionIndex < ICP_QUESTION_KEYS.length) {
    const oar = isBuilder ? "builder" : isSingle ? "single" : "customer";
    const label = oarLabel(state.flavor, oar);
    const question = icpQuestion(ICP_QUESTION_KEYS[state.questionIndex], label);
    state.questionIndex++;
    saveState(workdir, state);
    return {
      ok: true,
      output: question,
      data: { phase, questionIndex: state.questionIndex, progressPercent: 35 },
    };
  }

  // All 5 ICP questions answered — move to confirmation
  const oarDesc =
    phase === "icp_builder"
      ? "ideal recruit"
      : phase === "icp_customer"
      ? "ideal customer"
      : `ideal ${oarLabel(state.flavor, "single")}`;

  state.phase = (phase + "_confirm") as OnboardPhase;
  state.questionIndex = 0;
  saveState(workdir, state);

  return {
    ok: true,
    output: buildICPSummary(icpData, oarDesc),
    data: { phase: state.phase, progressPercent: 38 },
  };
}

function transitionAfterICPConfirm(state: OnboardState, workdir: string): ToolResult {
  const phase = state.phase;

  if (phase === "icp_builder_confirm") {
    // Two-oar: move to customer ICP next
    state.phase = "icp_customer";
    state.questionIndex = 0;
    saveState(workdir, state);
    const label = oarLabel(state.flavor, "customer");
    return {
      ok: true,
      output: `Builder profile locked in. Now let's build your customer profile.\n\n${icpQuestion("idealPerson", label)}`,
      data: { phase: "icp_customer", questionIndex: 0, progressPercent: 45 },
    };
  }

  // Both ICP phases complete (customer_confirm or single_confirm) — move to key setup
  state.phase = "keys_primary";
  state.questionIndex = 0;
  saveState(workdir, state);

  return {
    ok: true,
    output: buildKeySetupIntro(),
    data: { phase: "keys_primary", progressPercent: 55 },
  };
}

// ---------------------------------------------------------------------------
// Phase 3 — Key Setup
// ---------------------------------------------------------------------------

function buildKeySetupIntro(): string {
  return [
    `Your profiles are set. Now let's power up your AI brain.`,
    ``,
    `You need an API key from an LLM provider. I recommend starting with Anthropic (Claude):`,
    `• Get your key here: https://console.anthropic.com/settings/keys`,
    `• Sign up is free. You only pay for what you use.`,
    ``,
    `Alternatively, you can use OpenAI:`,
    `• https://platform.openai.com/api-keys`,
    ``,
    `Once you have your key, paste it here and I'll validate it.`,
  ].join("\n");
}

// Detects the provider from the key prefix
function detectProvider(key: string): "anthropic" | "openai" | "unknown" {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  return "unknown";
}

// Makes a minimal HTTP POST to validate an API key
// Returns { valid: boolean, error?: string }
async function validateApiKey(
  key: string
): Promise<{ valid: boolean; error?: string }> {
  const provider = detectProvider(key);

  if (provider === "unknown") {
    return {
      valid: false,
      error:
        "I don't recognize that key format. Anthropic keys start with 'sk-ant-', OpenAI keys start with 'sk-'. Please double-check and try again.",
    };
  }

  try {
    if (provider === "anthropic") {
      return await validateAnthropicKey(key);
    } else {
      return await validateOpenAIKey(key);
    }
  } catch (err) {
    return {
      valid: false,
      error: `Validation failed with a network error: ${String(err)}. Please try again.`,
    };
  }
}

function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: process.env["PLATFORM_CHEAP_MODEL"] ?? "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({ valid: true });
          } else if (res.statusCode === 401) {
            resolve({ valid: false, error: "That key is invalid or has been revoked. Please check it and try again." });
          } else if (res.statusCode === 402) {
            resolve({ valid: false, error: "That key has a billing issue. Please add credits to your Anthropic account and try again." });
          } else if (res.statusCode === 403) {
            resolve({ valid: false, error: "That key doesn't have permission for this model. Please check your API key permissions." });
          } else {
            resolve({ valid: false, error: `Validation returned status ${res.statusCode}. Please try again.` });
          }
        });
      }
    );

    req.on("error", (err) => {
      resolve({ valid: false, error: `Network error during validation: ${err.message}` });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ valid: false, error: "Validation timed out. Please check your internet connection and try again." });
    });

    req.write(body);
    req.end();
  });
}

function validateOpenAIKey(key: string): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });

    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({ valid: true });
          } else if (res.statusCode === 401) {
            resolve({ valid: false, error: "That key is invalid or has been revoked. Please check it and try again." });
          } else if (res.statusCode === 429) {
            // Rate limited but key is valid
            resolve({ valid: true });
          } else {
            resolve({ valid: false, error: `Validation returned status ${res.statusCode}. Please try again.` });
          }
        });
      }
    );

    req.on("error", (err) => {
      resolve({ valid: false, error: `Network error during validation: ${err.message}` });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ valid: false, error: "Validation timed out. Please check your internet connection and try again." });
    });

    req.write(body);
    req.end();
  });
}

// Notifies Tiger Claw API to deactivate the platform onboarding key (Layer 1)
function notifyKeyActivation(tenantId: string): void {
  const apiUrl = process.env.TIGER_CLAW_API_URL ?? "http://localhost:4000";
  const url = new URL(`/tenants/${tenantId}/keys/activate`, apiUrl);
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;

  const body = JSON.stringify({ action: "deactivate_onboarding_key" });

  const req = lib.request(
    {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    },
    () => { /* fire and forget */ }
  );

  req.on("error", () => { /* non-fatal — log silently */ });
  req.write(body);
  req.end();
}

async function handleKeysPrimary(
  state: OnboardState,
  response: string | undefined,
  workdir: string
): Promise<ToolResult> {
  // First visit — no response yet, just show the intro
  if (response === undefined || state.phase === "keys_primary") {
    if (response === undefined) {
      saveState(workdir, state);
      return {
        ok: true,
        output: buildKeySetupIntro(),
        data: { phase: "keys_primary", progressPercent: 55 },
      };
    }
  }

  // Validate the key
  const key = (response ?? "").trim();
  const result = await validateApiKey(key);

  if (!result.valid) {
    state.phase = "keys_primary_retry";
    saveState(workdir, state);
    return {
      ok: true,
      output: `${result.error}\n\nPlease paste your primary API key again.`,
      data: { phase: "keys_primary_retry", progressPercent: 55 },
    };
  }

  // Primary key valid — persist the key value and move to fallback
  state.primaryKeyValidated = true;
  state.primaryKey = key;
  state.phase = "keys_fallback";
  saveState(workdir, state);

  return {
    ok: true,
    output: [
      `Primary key validated. Your smart brain is connected.`,
      ``,
      `Now I need a backup key. Here's why this matters:`,
      `If your primary key ever fails — billing issue, rate limit, revocation — I'll automatically`,
      `switch to your backup and keep running while you fix the problem.`,
      ``,
      `**This is required. I cannot activate without a backup key.**`,
      ``,
      `Get a second key from the same or a different provider and paste it here.`,
      `(It can be from the same account — just a second key is fine.)`,
    ].join("\n"),
    data: { phase: "keys_fallback", progressPercent: 65 },
  };
}

async function handleKeysFallback(
  state: OnboardState,
  response: string | undefined,
  workdir: string
): Promise<ToolResult> {
  if (response === undefined) {
    saveState(workdir, state);
    return {
      ok: true,
      output: "Please paste your backup API key.",
      data: { phase: "keys_fallback", progressPercent: 65 },
    };
  }

  const key = response.trim();

  // Reject if same as primary (we don't store the primary key, so we can't check,
  // but we can warn them it should ideally be a different key or at least a second key)
  const result = await validateApiKey(key);

  if (!result.valid) {
    state.phase = "keys_fallback_retry";
    saveState(workdir, state);
    return {
      ok: true,
      output: `${result.error}\n\nI need a valid backup key to continue. Please paste it again.`,
      data: { phase: "keys_fallback_retry", progressPercent: 65 },
    };
  }

  // Both keys validated — persist fallback key value
  state.fallbackKeyValidated = true;
  state.fallbackKey = key;

  // Write key_state.json so the entrypoint can resolve Layer 2/3 keys on restart.
  // Uses the same shape as tiger_keys.ts KeyState — kept in sync manually.
  // Tools don't import from each other, so we write the JSON directly.
  const today = new Date().toISOString().slice(0, 10);
  const keyStateData = {
    activeLayer: 2,
    layer2Key: state.primaryKey,
    layer3Key: state.fallbackKey,
    layer1MessageCount: 0,
    layer3MessageCountToday: 0,
    layer3CountDate: today,
    layer4TotalMessages: 0,
    tenantPaused: false,
    events: [
      {
        type: "rotation",
        timestamp: new Date().toISOString(),
        fromLayer: 1,
        toLayer: 2,
        message: "Onboarding complete — switched from platform onboarding key to tenant primary key.",
      },
    ],
    lastUpdated: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(
      path.join(workdir, "key_state.json"),
      JSON.stringify(keyStateData, null, 2),
      "utf8"
    );
  } catch {
    // Non-fatal — entrypoint will still load Layer 1 key as fallback, but
    // the tenant will need to re-enter keys. Better than crashing onboarding.
  }

  // Deactivate the platform onboarding key (Layer 1) on the Tiger Claw API
  notifyKeyActivation(state.tenantId);

  // Move to naming ceremony
  state.phase = "naming";
  saveState(workdir, state);

  return {
    ok: true,
    output: [
      `Backup key validated. You're fully protected now.`,
      ``,
      `Your platform onboarding key has been deactivated — you're running on your own keys.`,
      ``,
      `One last thing — what do you want to call me?`,
    ].join("\n"),
    data: { phase: "naming", progressPercent: 80 },
  };
}

// ---------------------------------------------------------------------------
// Phase 4 — Naming Ceremony + SOUL.md
// ---------------------------------------------------------------------------

function generateSOULmd(state: OnboardState): string {
  const botName = state.botName ?? "Tiger";
  const tenantName = state.identity.name ?? "your operator";
  const profession = professionLabel(state.flavor);

  // Use the four-layer config system (Base → Regional → Flavor → Tenant)
  const config = resolveConfig(state.flavor, state.region ?? process.env["REGION"] ?? "us-en");

  const tenantData: TenantData = {
    botName,
    name: tenantName,
    productOrOpportunity: state.identity.productOrOpportunity ?? profession,
    yearsInProfession: state.identity.yearsInProfession ?? "—",
    biggestWin: state.identity.biggestWin ?? "—",
    differentiator: state.identity.differentiator ?? "—",
    preferredLanguage: config.language,
    timezone: process.env["TZ"],
    monthlyIncomeGoal: state.identity.monthlyIncomeGoal,
  };

  // Config system generates: Identity, Macro Narrative, Tone, Language,
  // Never Do, Cultural Context, Scoring, Conversion Goal
  const configSoul = generateSoulMd(config, tenantData);

  // Append tenant-specific sections from onboarding interviews
  const tenantSections: string[] = [];

  // Operator edification (from Identity interview)
  tenantSections.push([
    `## Your Operator — ${tenantName}`,
    `- **Name:** ${tenantName}`,
    `- **Profession:** ${profession}`,
    `- **Years in profession:** ${state.identity.yearsInProfession ?? "—"}`,
    `- **What they represent:** ${state.identity.productOrOpportunity ?? "—"}`,
    `- **Their biggest win:** ${state.identity.biggestWin ?? "—"}`,
    `- **What makes them different:** ${state.identity.differentiator ?? "—"}`,
    `- **Monthly income goal:** ${state.identity.monthlyIncomeGoal ?? "—"}`,
  ].join("\n"));

  // ICP sections (from ICP interview)
  const builderICP = isTwoOarFlavor(state.flavor) ? state.icpBuilder : null;
  const customerICP = isTwoOarFlavor(state.flavor) ? state.icpCustomer : state.icpSingle;

  if (builderICP) {
    tenantSections.push([
      `## Ideal Business Builder (Recruit)`,
      `- Who they are: ${builderICP.idealPerson ?? "—"}`,
      `- Problem they face: ${builderICP.problemFaced ?? "—"}`,
      `- What's not working for them: ${builderICP.currentApproachFailing ?? "—"}`,
      `- Where they hang out online: ${builderICP.onlinePlatforms ?? "—"}`,
      `- Types to avoid: ${builderICP.typesToAvoid ?? "—"}`,
    ].join("\n"));
  }

  if (customerICP) {
    const label = state.flavor === "real-estate" ? "Ideal Client" : "Ideal Customer";
    tenantSections.push([
      `## ${label}`,
      `- Who they are: ${customerICP.idealPerson ?? "—"}`,
      `- Problem they face: ${customerICP.problemFaced ?? "—"}`,
      `- What's not working for them: ${customerICP.currentApproachFailing ?? "—"}`,
      `- Where they hang out online: ${customerICP.onlinePlatforms ?? "—"}`,
      `- Types to avoid: ${customerICP.typesToAvoid ?? "—"}`,
    ].join("\n"));
  }

  tenantSections.push(`## Onboarding Complete\nOnboarding completed: ${new Date().toISOString()}`);

  return configSoul + "\n\n---\n\n" + tenantSections.join("\n\n---\n\n");
}

function handleNaming(
  state: OnboardState,
  response: string | undefined,
  workdir: string
): ToolResult {
  if (response === undefined) {
    saveState(workdir, state);
    return {
      ok: true,
      output: "What do you want to call me?",
      data: { phase: "naming", progressPercent: 80 },
    };
  }

  const botName = response.trim();
  state.botName = botName;

  // Generate and write SOUL.md
  const soulContent = generateSOULmd(state);
  const soulPath = path.join(workdir, "SOUL.md");
  try {
    fs.writeFileSync(soulPath, soulContent, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: `Failed to write SOUL.md: ${String(err)}`,
    };
  }

  // Update the Telegram bot identity via Bot API — Block 5.3 Decision 4
  // The container has its assigned bot token in BOT_TOKEN env var.
  // This sets the display name and description the tenant's leads will see.
  const tgToken = process.env["BOT_TOKEN"] ?? process.env["TELEGRAM_BOT_TOKEN"];
  if (tgToken) {
    const tenantName = state.identity.name ?? "your operator";
    const description =
      `I'm ${botName}, an AI-powered sales and recruiting agent working with ${tenantName}. ` +
      `Powered by Tiger Claw technology.`;
    const shortDesc = `AI agent for ${tenantName}. Powered by Tiger Claw.`;

    // Fire-and-forget — don't fail onboarding if Telegram API is slow
    void updateTelegramBotIdentity(tgToken, botName, description, shortDesc);
  }

  // Transition to complete phase — flywheel start is triggered in handleComplete
  state.phase = "complete";
  state.completedAt = new Date().toISOString();
  saveState(workdir, state);

  return {
    ok: true,
    output: [
      `I'm ${botName} now. That's who I'll be.`,
      ``,
      `My identity has been updated. Here's who I am:`,
      ``,
      `"I'm ${botName}, built on Tiger Claw technology, powered by OpenClaw. I work for ${state.identity.name ?? "you"}."`,
      ``,
      `Starting your flywheel now...`,
    ].join("\n"),
    data: { phase: "complete", progressPercent: 90, botName },
  };
}

// ---------------------------------------------------------------------------
// Telegram bot identity update — called after naming ceremony (Block 5.3 Decision 4)
// Sets bot display name, description, and short description via Telegram Bot API.
// The bot updates ITSELF (uses its own token), so no special admin permission needed.
// ---------------------------------------------------------------------------

function updateTelegramBotIdentity(
  token: string,
  name: string,
  description: string,
  shortDescription: string
): Promise<void> {
  const calls: Array<[string, Record<string, string>]> = [
    ["setMyName", { name }],
    ["setMyDescription", { description }],
    ["setMyShortDescription", { short_description: shortDescription }],
  ];

  // Run all three calls in sequence; non-fatal if any fail
  return calls.reduce(
    (chain, [method, body]) =>
      chain.then(() =>
        new Promise<void>((resolve) => {
          const bodyStr = JSON.stringify(body);
          const req = https.request(
            {
              hostname: "api.telegram.org",
              path: `/bot${token}/${method}`,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyStr),
              },
            },
            () => resolve()
          );
          req.on("error", () => resolve()); // Non-fatal
          req.setTimeout(10000, () => { req.destroy(); resolve(); });
          req.write(bodyStr);
          req.end();
        })
      ),
    Promise.resolve()
  );
}

// ---------------------------------------------------------------------------
// Phase 5 — Flywheel Start
// ---------------------------------------------------------------------------

// Calls Tiger Claw API to set tenant status to "active"
function setTenantActive(tenantId: string): Promise<void> {
  return new Promise((resolve) => {
    const apiUrl = process.env.TIGER_CLAW_API_URL ?? "http://localhost:4000";
    const url = new URL(`/tenants/${tenantId}/status`, apiUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const body = JSON.stringify({ status: "active" });

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      () => resolve()
    );

    req.on("error", () => resolve()); // Non-fatal — resolve regardless
    req.setTimeout(10000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// Calls Tiger Claw API to trigger the first scout hunt immediately
function triggerFirstScout(tenantId: string): Promise<void> {
  return new Promise((resolve) => {
    const apiUrl = process.env.TIGER_CLAW_API_URL ?? "http://localhost:4000";
    const url = new URL(`/tenants/${tenantId}/scout`, apiUrl);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const body = JSON.stringify({ trigger: "onboarding_complete" });

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      () => resolve()
    );

    req.on("error", () => resolve());
    req.setTimeout(10000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

async function handleComplete(state: OnboardState): Promise<ToolResult> {
  // Fire API calls — non-blocking, failures are non-fatal
  await Promise.all([
    setTenantActive(state.tenantId),
    triggerFirstScout(state.tenantId),
  ]);

  return {
    ok: true,
    output: [
      `I'm on it.`,
      ``,
      `I've started your first prospect hunt right now. Check back tomorrow morning for your first daily briefing — I'll have leads ready.`,
      ``,
      `Here's what happens next:`,
      `• Every morning at 5 AM, I hunt for new prospects matching your ICP`,
      `• Every morning at 7 AM, I send you a briefing with leads, status updates, and actions`,
      `• I'll contact qualified prospects automatically and run 30-day nurture sequences`,
      `• When someone scores high enough, I'll set up your three-way close`,
      ``,
      `You're live. Let's get to work.`,
    ].join("\n"),
    data: {
      phase: "complete",
      progressPercent: 100,
      completedAt: state.completedAt,
      botName: state.botName,
    },
  };
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

function handleStatus(state: OnboardState | null): ToolResult {
  if (!state) {
    return {
      ok: true,
      output: "Onboarding has not started yet. Call with action: 'start' to begin.",
      data: { phase: null, progressPercent: 0 },
    };
  }

  const phaseDescriptions: Record<OnboardPhase, string> = {
    identity: "Phase 1 — Identity interview",
    icp_builder: "Phase 2 — Business Builder ICP interview",
    icp_builder_confirm: "Phase 2 — Business Builder ICP confirmation",
    icp_customer: "Phase 2 — Customer ICP interview",
    icp_customer_confirm: "Phase 2 — Customer ICP confirmation",
    icp_single: "Phase 2 — ICP interview",
    icp_single_confirm: "Phase 2 — ICP confirmation",
    keys_primary: "Phase 3 — Primary API key setup",
    keys_primary_retry: "Phase 3 — Primary API key (retry)",
    keys_fallback: "Phase 3 — Fallback API key setup",
    keys_fallback_retry: "Phase 3 — Fallback API key (retry)",
    naming: "Phase 4 — Bot naming ceremony",
    complete: "Phase 5 — Complete",
  };

  const description = phaseDescriptions[state.phase] ?? state.phase;
  const isComplete = state.phase === "complete";

  return {
    ok: true,
    output: isComplete
      ? `Onboarding complete. Bot name: ${state.botName ?? "—"}. Completed: ${state.completedAt ?? "—"}`
      : `Onboarding in progress: ${description}`,
    data: {
      phase: state.phase,
      isComplete,
      primaryKeyValidated: state.primaryKeyValidated,
      fallbackKeyValidated: state.fallbackKeyValidated,
      botName: state.botName,
      startedAt: state.startedAt,
      completedAt: state.completedAt ?? null,
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
  const { action, response } = params as OnboardParams;
  const { workdir, logger } = context;

  logger.info("tiger_onboard called", { action, phase: "loading state" });

  // Load persisted state (or null if first run)
  let state = loadState(workdir);

  // Status check — works at any time
  if (action === "status") {
    return handleStatus(state);
  }

  // Initialize state on first start
  if (action === "start" && !state) {
    state = initialState(workdir);
    saveState(workdir, state);
    logger.info("tiger_onboard: new onboarding session started");
  }

  if (!state) {
    return {
      ok: false,
      error: "Onboarding state not found. Call with action: 'start' to begin.",
    };
  }

  // Already complete
  if (state.phase === "complete" && action !== "status") {
    return {
      ok: true,
      output: `Onboarding is already complete. Your bot is ${state.botName ?? "active"} and the flywheel is running.`,
      data: { phase: "complete", complete: true },
    };
  }

  logger.info("tiger_onboard dispatch", { phase: state.phase, action });

  // Route to correct phase handler
  try {
    switch (state.phase) {
      case "identity":
        return handleIdentity(state, action === "start" ? undefined : response, workdir);

      case "icp_builder":
      case "icp_builder_confirm":
      case "icp_customer":
      case "icp_customer_confirm":
      case "icp_single":
      case "icp_single_confirm":
        return handleICP(state, response, workdir);

      case "keys_primary":
      case "keys_primary_retry":
        return await handleKeysPrimary(state, response, workdir);

      case "keys_fallback":
      case "keys_fallback_retry":
        return await handleKeysFallback(state, response, workdir);

      case "naming":
        return handleNaming(state, response, workdir);

      case "complete":
        return await handleComplete(state);

      default:
        return {
          ok: false,
          error: `Unknown onboarding phase: ${state.phase}`,
        };
    }
  } catch (err) {
    logger.error("tiger_onboard error", { phase: state.phase, err });
    return {
      ok: false,
      error: `Onboarding error in phase ${state.phase}: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_onboard = {
  name: "tiger_onboard",
  description:
    "Run the onboarding interview flow for a new tenant. Phases: Identity (who you are), ICP (who you're looking for), API Key Setup (primary + required fallback), Bot Naming, and Flywheel Start. Maintains state between calls. Call with action: 'start' to begin, action: 'respond' + response: '<answer>' for each subsequent step, or action: 'status' to check progress.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "respond", "status"],
        description:
          "'start' — begin or resume onboarding. 'respond' — provide tenant's answer to the current question (include response field). 'status' — check current phase and progress.",
      },
      response: {
        type: "string",
        description:
          "The tenant's answer to the current question. Required when action is 'respond'.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_onboard;
