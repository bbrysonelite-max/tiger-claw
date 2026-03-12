// Tiger Claw — Config-Driven Flavor System
// GAP 1: Adding a new flavor requires only dropping a JSON file — zero code changes.
// 11 required flavors validated at boot time.

import * as fs from "fs";
import * as path from "path";

export interface FlavorConfig {
    id: string;
    name: string;
    professionLabel: string;
    defaultKeywords: string[];
    nurtureTemplates: {
        value_drop: string;
        testimonial: string;
        authority_transfer: string;
        personal_checkin: string;
        one_to_ten_part1: string;
        one_to_ten_part2: string;
        gap_closing: string;
        scarcity_takeaway: string;
        pattern_interrupt: string;
        final_takeaway: string;
        slow_drip_value: string;
        default_fallback: string;
    };
}

// All 11 required flavors — adding a new flavor = add JSON file + add slug here
const REQUIRED_FLAVORS = [
    "network-marketer",
    "real-estate",
    "health-wellness",
    "airbnb-host",
    "baker",
    "candle-maker",
    "doctor",
    "gig-economy",
    "lawyer",
    "plumber",
    "sales-tiger",
] as const;

// Resolve the flavors directory — check tools/flavors first (where they live), then config/flavors
function resolveFlavorsDir(): string {
    // Primary: tools/flavors (same directory as this file)
    const toolsDir = path.join(__dirname, "flavors");
    if (fs.existsSync(toolsDir)) return toolsDir;
    // Fallback: config/flavors (spec-preferred location)
    const configDir = path.join(__dirname, "..", "config", "flavors");
    if (fs.existsSync(configDir)) return configDir;
    return toolsDir; // default even if it doesn't exist yet
}

const FLAVORS_DIR = resolveFlavorsDir();

// In-memory cache — loaded once at boot
const flavorCache = new Map<string, FlavorConfig>();

export function loadFlavorConfig(flavor: string): FlavorConfig {
    const safeFlavor = flavor || "network-marketer";

    // Check cache first
    if (flavorCache.has(safeFlavor)) {
        return flavorCache.get(safeFlavor)!;
    }

    // Try to load from JSON
    const configPath = path.join(FLAVORS_DIR, `${safeFlavor}.json`);
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as FlavorConfig;
            flavorCache.set(safeFlavor, config);
            return config;
        }
    } catch (e) {
        console.error(`[flavor] Failed to load ${safeFlavor}:`, e);
    }

    // Fallback to network-marketer
    if (safeFlavor !== "network-marketer") {
        console.warn(`[flavor] ${safeFlavor} not found, falling back to network-marketer`);
        return loadFlavorConfig("network-marketer");
    }

    // Hardcoded ultimate fallback (prevents crash if all files are missing)
    return {
        id: "fallback",
        name: "Fallback Agent",
        professionLabel: "their field",
        defaultKeywords: ["opportunity", "income"],
        nurtureTemplates: {
            value_drop: "Hey {{name}},\n\nJust checking in. — {{botName}}",
            testimonial: "Hey {{name}},\n\nJust checking in. — {{botName}}",
            authority_transfer: "Hey {{name}},\n\nJust checking in. — {{botName}}",
            personal_checkin: "Hey {{name}},\n\nJust checking in. — {{botName}}",
            one_to_ten_part1: "Hey {{name}},\n\nOn a scale of 1-10... — {{botName}}",
            one_to_ten_part2: "Hey {{name}},\n\nWhat would make it a 10? — {{botName}}",
            gap_closing: "Got it, {{answer}}.\n\n— {{botName}}",
            scarcity_takeaway: "Hey {{name}},\n\nMoving on... — {{botName}}",
            pattern_interrupt: "Hey {{name}},\n\nBefore I go... — {{botName}}",
            final_takeaway: "Hey {{name}},\n\nTake care. — {{botName}}",
            slow_drip_value: "Hey {{name}},\n\nJust share this. — {{botName}}",
            default_fallback: "Hey {{name}}, just checking in. — {{botName}}"
        }
    };
}

/**
 * Boot-time validation: ensures all 11 required flavors are loadable.
 * Logs errors loudly (Locked Decision #10: no silent failures).
 */
export function validateAllFlavors(): { valid: boolean; missing: string[]; loaded: string[] } {
    const missing: string[] = [];
    const loaded: string[] = [];

    for (const flavor of REQUIRED_FLAVORS) {
        const configPath = path.join(FLAVORS_DIR, `${flavor}.json`);
        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as FlavorConfig;
                flavorCache.set(flavor, config);
                loaded.push(flavor);
            } catch (e) {
                console.error(`[flavor] ❌ ${flavor}.json exists but failed to parse:`, e);
                missing.push(flavor);
            }
        } else {
            console.error(`[flavor] ❌ Missing required flavor file: ${configPath}`);
            missing.push(flavor);
        }
    }

    if (missing.length > 0) {
        console.error(`[flavor] ⚠️ ${missing.length} flavor(s) missing: ${missing.join(", ")}`);
    } else {
        console.log(`[flavor] ✅ All ${REQUIRED_FLAVORS.length} flavors loaded from ${FLAVORS_DIR}`);
    }

    return { valid: missing.length === 0, missing, loaded };
}

/** Get list of all available flavor IDs */
export function listFlavors(): string[] {
    return [...REQUIRED_FLAVORS];
}

/**
 * Replaces all occurrences of {{key}} with value in the given template string.
 */
export function fillTemplate(template: string, variables: Record<string, string | undefined>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        const safeValue = value ?? "";
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), safeValue);
    }
    return result;
}
