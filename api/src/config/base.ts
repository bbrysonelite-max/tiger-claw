// Tiger Claw — Base Config
// Universal locked flywheel mechanics — TIGERCLAW-MASTER-SPEC-v2.md Block 2.3
//
// ALL VALUES HERE ARE LOCKED. Do not modify without updating the spec checksum.
// Regional and flavor configs may extend but never override core locked values.

import type { BaseConfig } from "./types.js";

export const BASE_CONFIG: BaseConfig = {
  version: "2.0",

  // -------------------------------------------------------------------------
  // Scoring (Block 3.2 — ALL LOCKED)
  // -------------------------------------------------------------------------
  scoring: {
    // Business Builder weights: 30/45/25 (LOCKED)
    builderWeights: {
      profileFit: 0.30,
      intentSignals: 0.45,
      engagement: 0.25,
    },
    // Customer weights: 25/50/25 (LOCKED)
    customerWeights: {
      profileFit: 0.25,
      intentSignals: 0.50,
      engagement: 0.25,
    },
    // Hard threshold: 80, platform-fixed (LOCKED — CORRECTION from v1 which said 70)
    qualificationThreshold: 80,
    // Unicorn bonus for dual-oar leads (LOCKED)
    unicornBonus: 15,
    // Intent signal recency decay — signals older than this decay by half
    engagementDecayDays: 30,
  },

  // -------------------------------------------------------------------------
  // Nurture (Block 3.6 — ALL LOCKED)
  // -------------------------------------------------------------------------
  nurture: {
    sequenceDays: 30,
    touchCount: 8,
    defaultCadenceDays: 3,
    // Day offsets from enrollment (LOCKED)
    touchDayOffsets: [0, 3, 7, 10, 14, 18, 22, 26],
    // Adaptive acceleration on positive response (LOCKED)
    accelerationHours: 24,
    // Slow drip: 1/month (LOCKED)
    slowDripIntervalDays: 30,
    // Slow drip: 3 months max, then archive (LOCKED)
    slowDripMaxCount: 3,
    // Max gap-closing rounds: 2 (LOCKED)
    maxGapClosingRounds: 2,
  },

  // -------------------------------------------------------------------------
  // Contact (Block 3.5 — ALL LOCKED)
  // -------------------------------------------------------------------------
  contact: {
    // Randomized 1-4 hour delay (LOCKED)
    minDelayHours: 1,
    maxDelayHours: 4,
    // Reasonable hours window (LOCKED)
    windowStartHour: 9,
    windowEndHour: 20,
    // Default daily cap (adjustable via tiger_settings)
    maxDailyContacts: 10,
    // Never Chase: one follow-up max (LOCKED)
    followUpDelayNeutralHours: 48,
    followUpDelayNoResponseHours: 72,
  },
};
