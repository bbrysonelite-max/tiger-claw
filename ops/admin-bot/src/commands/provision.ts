// /provision — manual tenant provisioning from admin bot
// TIGERCLAW-MASTER-SPEC-v2.md Block 6.1
//
// Usage:
//   /provision --name "John Doe" --lang en --channel telegram --token BOT_TOKEN
//
// Optional flags:
//   --slug   john-doe        (auto-derived from name if omitted)
//   --flavor network-marketer|real-estate|health-wellness  (default: network-marketer)
//   --region us-en|th-th     (default: us-en; auto-set to th-th if --lang th)
//   --tz     America/Phoenix  (default: UTC)
//   --port   18803            (auto-assigned if omitted)

import { provisionTenant, type ProvisionInput } from "../api-client.js";
import { escMd } from "./fleet.js";

export async function handleProvision(argsText: string): Promise<string> {
  let input: ProvisionInput;
  try {
    input = parseProvisionArgs(argsText);
  } catch (err) {
    return (
      `❌ Parse error: ${err instanceof Error ? err.message : String(err)}\n\n` +
      `Usage:\n/provision \\-\\-name "John Doe" \\-\\-lang en \\-\\-channel telegram \\-\\-token BOT_TOKEN\n\n` +
      `Optional: \\-\\-slug, \\-\\-flavor, \\-\\-region, \\-\\-tz, \\-\\-port`
    );
  }

  const pending = `⏳ Provisioning *${escMd(input.name)}* \\(${escMd(input.slug)}\\)\\.\\.\\. This may take up to 30 seconds\\.`;

  // Return pending message immediately; caller will handle the async result
  // via a follow-up message. We return pending here and the caller awaits the result.
  // (See index.ts — it sends the pending message then awaits handleProvisionAsync)
  return pending;
}

export async function handleProvisionAsync(argsText: string): Promise<string> {
  const input = parseProvisionArgs(argsText);
  const result = await provisionTenant(input);

  if (result.success) {
    return (
      `✅ *${escMd(result.tenant?.name ?? input.name)}* provisioned\\!\n\n` +
      `Slug: \`${escMd(result.tenant?.slug ?? input.slug)}\`\n` +
      `Port: ${result.port}\n` +
      `Flavor: ${result.tenant?.flavor ?? input.flavor}\n` +
      `Region: ${result.tenant?.region ?? input.region}\n\n` +
      `Steps:\n${result.steps.map((s) => `  • ${escMd(s)}`).join("\n")}\n\n` +
      `Tell them to message their bot on Telegram to begin onboarding\\.`
    );
  } else {
    return (
      `❌ Provisioning failed for *${escMd(input.name)}*\n\n` +
      `Error: ${escMd(result.error ?? "unknown")}\n` +
      (result.steps.length > 0 ? `Steps completed: ${result.steps.map(escMd).join(", ")}` : "")
    );
  }
}

// ---------------------------------------------------------------------------
// Arg parser for /provision flags
// ---------------------------------------------------------------------------

function parseProvisionArgs(text: string): ProvisionInput {
  const flags = parseFlags(text);

  const name = flags["name"];
  if (!name) throw new Error("--name is required");

  const lang = flags["lang"] ?? "en";
  const channel = flags["channel"] ?? "telegram";
  const token = flags["token"];
  const flavor = flags["flavor"] ?? "network-marketer";
  const region = flags["region"] ?? (lang === "th" ? "th-th" : "us-en");
  const slug = flags["slug"] ?? slugify(name);
  const timezone = flags["tz"] ?? "UTC";
  const port = flags["port"] ? Number(flags["port"]) : undefined;

  return {
    slug,
    name,
    flavor,
    region,
    language: lang,
    preferredChannel: channel,
    botToken: token,
    timezone,
    port,
  };
}

// Minimal flag parser: --key value or --key "value with spaces"
function parseFlags(text: string): Record<string, string> {
  const flags: Record<string, string> = {};
  // Match --key "quoted value" or --key unquoted-value
  const pattern = /--(\w+)\s+(?:"([^"]+)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    flags[m[1]!] = m[2] ?? m[3] ?? "";
  }
  return flags;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}
