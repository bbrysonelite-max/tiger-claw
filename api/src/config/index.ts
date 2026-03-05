// Tiger Claw — Config Loader
// Four-layer deep merge: Base → Regional → Flavor → Tenant
// TIGERCLAW-MASTER-SPEC-v2.md Block 2.3
//
// Usage:
//   import { resolveConfig, generateSoulMd } from "./config/index.js";
//   const config = resolveConfig("network-marketer", "us-en");
//   const soul = generateSoulMd(config, tenantData);

import type { ResolvedConfig, FlavorConfig, RegionalConfig } from "./types.js";
import { BASE_CONFIG } from "./base.js";
import { US_EN_CONFIG } from "./regions/us-en.js";
import { TH_TH_CONFIG } from "./regions/th-th.js";
import { NETWORK_MARKETER_FLAVOR } from "./flavors/network-marketer.js";
import { REAL_ESTATE_FLAVOR } from "./flavors/real-estate.js";
import { HEALTH_WELLNESS_FLAVOR } from "./flavors/health-wellness.js";

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

const REGIONS: Record<string, RegionalConfig> = {
  "us-en": US_EN_CONFIG,
  "th-th": TH_TH_CONFIG,
};

const FLAVORS: Record<string, FlavorConfig> = {
  "network-marketer": NETWORK_MARKETER_FLAVOR,
  "real-estate": REAL_ESTATE_FLAVOR,
  "health-wellness": HEALTH_WELLNESS_FLAVOR,
};

// ---------------------------------------------------------------------------
// Deep merge utility (plain objects only — no array merging)
// Arrays are replaced by the later layer, not concatenated.
// ---------------------------------------------------------------------------

function deepMerge<T extends object>(...layers: Array<Partial<T> | T>): T {
  const result: Record<string, unknown> = {};

  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (
        value !== undefined &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  return result as T;
}

// ---------------------------------------------------------------------------
// resolveConfig — main entry point for tools
// ---------------------------------------------------------------------------

export function resolveConfig(
  flavorKey: string,
  regionCode?: string
): ResolvedConfig {
  const flavor = FLAVORS[flavorKey] ?? FLAVORS["network-marketer"];
  const region = REGIONS[regionCode ?? "us-en"] ?? REGIONS["us-en"];

  // Merge discovery: base → regional → flavor (later wins)
  const mergedDiscovery = deepMerge(
    { activeSources: [], dailyLeadTarget: 10, rateLimitPerSource: 20 },
    region.discovery ?? {},
    flavor.discovery ?? {}
  );

  return {
    flavor: flavor.key,
    region: region.code,
    language: region.language,
    base: BASE_CONFIG,
    regional: {
      ...region,
      discovery: mergedDiscovery,
    },
    flavorConfig: flavor,
  };
}

// ---------------------------------------------------------------------------
// resolveConfigFromEnv — reads BOT_FLAVOR and REGION env vars
// ---------------------------------------------------------------------------

export function resolveConfigFromEnv(): ResolvedConfig {
  const flavor = process.env["BOT_FLAVOR"] ?? "network-marketer";
  const region = process.env["REGION"] ?? "us-en";
  return resolveConfig(flavor, region);
}

// ---------------------------------------------------------------------------
// listFlavors / listRegions — for admin / onboarding use
// ---------------------------------------------------------------------------

export function listFlavors(): Array<{ key: string; displayName: string; description: string }> {
  return Object.values(FLAVORS).map((f) => ({
    key: f.key,
    displayName: f.displayName,
    description: f.description,
  }));
}

export function listRegions(): Array<{ code: string; language: string; languageName: string }> {
  return Object.values(REGIONS).map((r) => ({
    code: r.code,
    language: r.language,
    languageName: r.languageName,
  }));
}

// ---------------------------------------------------------------------------
// generateSoulMd — produces the per-tenant SOUL.md content
//
// Called at the end of onboarding (Phase 4 — Bot Naming Ceremony).
// Written to {workdir}/SOUL.md.
// ---------------------------------------------------------------------------

export interface TenantData {
  botName: string;
  name: string;
  productOrOpportunity: string;
  yearsInProfession: string;
  biggestWin: string;
  differentiator: string;
  preferredLanguage: string;
  timezone?: string;
  monthlyIncomeGoal?: string;
}

function fillTokens(template: string, tenant: TenantData): string {
  return template
    .replace(/\{botName\}/g, tenant.botName)
    .replace(/\{tenantName\}/g, tenant.name)
    .replace(/\{product\}/g, tenant.productOrOpportunity)
    .replace(/\{productOrOpportunity\}/g, tenant.productOrOpportunity)
    .replace(/\{years\}/g, tenant.yearsInProfession)
    .replace(/\{biggestWin\}/g, tenant.biggestWin)
    .replace(/\{differentiator\}/g, tenant.differentiator)
    .replace(/\{preferredLanguage\}/g, tenant.preferredLanguage);
}

export function generateSoulMd(config: ResolvedConfig, tenant: TenantData): string {
  const { flavorConfig, regional, base } = config;
  const soul = flavorConfig.soul;

  const sections: string[] = [];

  // Header
  sections.push([
    `# SOUL.md — ${tenant.botName}`,
    `Generated: ${new Date().toISOString()}`,
    `Flavor: ${flavorConfig.displayName} | Region: ${regional.code} | Language: ${regional.languageName}`,
  ].join("\n"));

  // Identity
  sections.push([
    `## Identity`,
    fillTokens(soul.systemPromptPreamble, tenant),
  ].join("\n"));

  // Macro narrative (NM only, but defined per flavor)
  if (soul.macroNarrative) {
    sections.push([
      `## Macro Narrative`,
      fillTokens(soul.macroNarrative, tenant),
    ].join("\n"));
  }

  // Tone directives
  sections.push([
    `## Tone`,
    soul.toneDirectives.map((d) => `- ${fillTokens(d, tenant)}`).join("\n"),
  ].join("\n"));

  // Language directive
  sections.push([
    `## Language`,
    fillTokens(soul.languageDirective, tenant),
    `Preferred language: ${tenant.preferredLanguage}`,
  ].join("\n"));

  // Hard rules
  sections.push([
    `## Never Do`,
    soul.neverDoList.map((r) => `- ${r}`).join("\n"),
  ].join("\n"));

  // Cultural context (from regional)
  sections.push([
    `## Cultural Context (${regional.languageName} / ${regional.code})`,
    regional.culturalNotes,
  ].join("\n"));

  // Scoring quick reference
  sections.push([
    `## Scoring (Quick Reference)`,
    `Qualification threshold: ${base.scoring.qualificationThreshold} points`,
    `Builder weights: Profile Fit ${base.scoring.builderWeights.profileFit * 100}% / Intent ${base.scoring.builderWeights.intentSignals * 100}% / Engagement ${base.scoring.builderWeights.engagement * 100}%`,
    `Customer weights: Profile Fit ${base.scoring.customerWeights.profileFit * 100}% / Intent ${base.scoring.customerWeights.intentSignals * 100}% / Engagement ${base.scoring.customerWeights.engagement * 100}%`,
    `Unicorn bonus (dual-oar): +${base.scoring.unicornBonus} points`,
  ].join("\n"));

  // Conversion goal
  const conversionGoal = flavorConfig.conversion.builderConversionGoal
    ? `Builder: ${flavorConfig.conversion.builderConversionGoal} | Customer: ${flavorConfig.conversion.customerConversionGoal}`
    : flavorConfig.conversion.singleConversionGoal ?? "book appointment or take next step";

  sections.push([
    `## Conversion Goal`,
    conversionGoal,
  ].join("\n"));

  return sections.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------

export type { ResolvedConfig, FlavorConfig, RegionalConfig };
export { BASE_CONFIG, US_EN_CONFIG, TH_TH_CONFIG };
export { NETWORK_MARKETER_FLAVOR, REAL_ESTATE_FLAVOR, HEALTH_WELLNESS_FLAVOR };
