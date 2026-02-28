// Tiger Claw — Flavor & Regional Config Type Definitions
// TIGERCLAW-MASTER-SPEC-v2.md Block 2
//
// Four-layer architecture (LOCKED):
//   Base → Regional → Flavor → Tenant
//
// Each layer is a partial of FlavorConfig.
// The loader deep-merges all layers into a ResolvedConfig.

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoringWeights {
  profileFit: number;   // 0-1
  intentSignals: number;
  engagement: number;
}

export interface ScoringConfig {
  builderWeights: ScoringWeights;
  customerWeights: ScoringWeights;
  qualificationThreshold: number;    // Hard threshold — 80, platform-fixed
  unicornBonus: number;              // +15 for dual-oar leads
  engagementDecayDays: number;       // Days before intent signal recency decay kicks in
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export type DiscoverySource =
  | "reddit"
  | "facebook_groups"
  | "telegram"
  | "line_openchat"
  | "linkedin"
  | "twitter";

export interface DiscoveryConfig {
  activeSources: DiscoverySource[];
  dailyLeadTarget: number;
  scanSchedule: string;       // Cron expression — default: "0 5 * * *" (5 AM)
  rateLimitPerSource: number; // Max profiles fetched per source per run
}

// ---------------------------------------------------------------------------
// Nurture
// ---------------------------------------------------------------------------

export interface NurtureConfig {
  sequenceDays: number;          // 30
  touchCount: number;            // 7-8
  defaultCadenceDays: number;    // 3-5 day default
  touchDayOffsets: number[];     // Exact day schedule — locked
  accelerationHours: number;     // 24h on positive response
  slowDripIntervalDays: number;  // 30
  slowDripMaxCount: number;      // 3
  maxGapClosingRounds: number;   // 2
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export interface ContactConfig {
  minDelayHours: number;         // 1
  maxDelayHours: number;         // 4
  windowStartHour: number;       // 9 AM
  windowEndHour: number;         // 8 PM
  maxDailyContacts: number;      // 10 default
  followUpDelayNeutralHours: number;   // 48h
  followUpDelayNoResponseHours: number; // 72h
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export type Oar = "builder" | "customer" | "single";

export interface ConversionConfig {
  oars: Oar[];                        // Which oars this flavor uses
  builderConversionGoal?: string;     // "sign up as a distributor"
  customerConversionGoal?: string;    // "place their first order"
  singleConversionGoal?: string;      // RE/HW flavors
}

// ---------------------------------------------------------------------------
// Objection buckets
// ---------------------------------------------------------------------------

export interface ObjectionBucket {
  key: string;
  label: string;
  keywords: string[];
  responseTemplate: string;      // Uses {tenantName} {years} {biggestWin} {product} tokens
  followUpQuestion: string;
}

// ---------------------------------------------------------------------------
// Pattern interrupt stories
// ---------------------------------------------------------------------------

export type PatternInterruptMoment = "stall" | "pre_takeaway" | "general";

export interface PatternInterruptStory {
  name: string;
  moments: PatternInterruptMoment[];
  storyTemplate: string;         // Uses {tenantName} {botName} {product} tokens
}

// ---------------------------------------------------------------------------
// Onboarding questions
// ---------------------------------------------------------------------------

export interface OnboardingQuestion {
  key: string;
  question: string;
  required: boolean;
  hint?: string;                  // Shown if tenant asks "what do you mean?"
}

export interface OnboardingConfig {
  identityQuestions: OnboardingQuestion[];
  icpBuilderQuestions?: OnboardingQuestion[];   // NM only
  icpCustomerQuestions?: OnboardingQuestion[];  // NM only
  icpSingleQuestions?: OnboardingQuestion[];    // RE / HW
}

// ---------------------------------------------------------------------------
// SOUL.md template
// ---------------------------------------------------------------------------

export interface SoulConfig {
  systemPromptPreamble: string;      // Flavor-specific system prompt opening
  macroNarrative?: string;           // NM: AI displacement frame
  toneDirectives: string[];          // "Direct", "Warm", "Confident", etc.
  languageDirective: string;         // "Always respond in {preferredLanguage}."
  neverDoList: string[];             // Hard prohibitions
}

// ---------------------------------------------------------------------------
// Regional
// ---------------------------------------------------------------------------

export interface RegionalConfig {
  code: string;                       // "us-en", "th-th"
  language: string;                   // "en", "th"
  languageName: string;               // "English", "Thai"
  primaryChannels: string[];          // ["telegram", "whatsapp"]
  discovery: Partial<DiscoveryConfig>;
  timingNorms: {
    businessHourStart: number;        // 9
    businessHourEnd: number;          // 20
    preferredContactDays: string[];   // ["Mon","Tue","Wed","Thu","Fri"]
  };
  patternInterrupts: PatternInterruptStory[];
  complianceNotes: string[];          // CAN-SPAM, PDPA, etc.
  culturalNotes: string;              // Brief framing note for LLM
}

// ---------------------------------------------------------------------------
// Flavor
// ---------------------------------------------------------------------------

export interface FlavorConfig {
  key: string;                        // "network-marketer", "real-estate", "health-wellness"
  displayName: string;
  description: string;
  conversion: ConversionConfig;
  objectionBuckets: ObjectionBucket[];
  patternInterrupts: PatternInterruptStory[];
  onboarding: OnboardingConfig;
  soul: SoulConfig;
  discovery: Partial<DiscoveryConfig>;
}

// ---------------------------------------------------------------------------
// Base (universal locked mechanics)
// ---------------------------------------------------------------------------

export interface BaseConfig {
  version: string;
  scoring: ScoringConfig;
  nurture: NurtureConfig;
  contact: ContactConfig;
}

// ---------------------------------------------------------------------------
// Fully resolved config (what tools actually use)
// ---------------------------------------------------------------------------

export interface ResolvedConfig {
  flavor: string;
  region: string;
  language: string;
  base: BaseConfig;
  regional: RegionalConfig;
  flavorConfig: FlavorConfig;
}
