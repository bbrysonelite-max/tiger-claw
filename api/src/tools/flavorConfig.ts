import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

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

// In ESM context, __dirname is not defined. We generate it:
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

export function loadFlavorConfig(flavor: string): FlavorConfig {
    const safeFlavor = flavor || "network-marketer";

    // Try to load from the flavors directory relative to this file
    const configPath = path.join(__dirname, "flavors", `${safeFlavor}.json`);

    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, "utf8")) as FlavorConfig;
        }
    } catch (e) {
        console.warn(`tiger_claw: Failed to load flavor config for ${safeFlavor}:`, e);
    }

    // Fallback to network-marketer if the requested one doesn't exist
    try {
        const fallbackPath = path.join(__dirname, "flavors", "network-marketer.json");
        if (fs.existsSync(fallbackPath)) {
            return JSON.parse(fs.readFileSync(fallbackPath, "utf8")) as FlavorConfig;
        }
    } catch (e) {
        // Ignore error and fall through to ultimate fallback
    }

    // Hardcoded absolute ultimate fallback (just to prevent crashing)
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
 * Replaces all occurrences of {{key}} with value in the given template string.
 */
export function fillTemplate(template: string, variables: Record<string, string | undefined>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        const safeValue = value ?? "";
        // Replace all occurrences of {{key}} globally
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), safeValue);
    }
    return result;
}
