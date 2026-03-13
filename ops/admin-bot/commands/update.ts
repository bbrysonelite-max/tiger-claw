// Tiger Claw — Admin Bot /update Command Handler
// TIGERCLAW-BLUEPRINT-v3.md §4.3 "Admin Telegram Commands (Update Pipeline)"
//
// Parses /update subcommands from Telegram, calls the provisioner API,
// and returns formatted results. Does NOT run ops scripts directly.
//
// Commands:
//   /update status                              — deployment overview
//   /update build [oc-version]                  — trigger image build
//   /update canary start                        — deploy to canary group
//   /update canary advance                      — advance rollout stage
//   /update fleet                               — skip to 100% (requires confirm)
//   /update rollback                            — rollback current stage
//   /update canary set slug1,slug2,...,slug5     — set canary group

const API_BASE = process.env["TIGER_CLAW_API_URL"] ?? (() => { throw new Error("[FATAL] TIGER_CLAW_API_URL environment variable is required"); })();
const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

interface ApiResponse {
  [key: string]: unknown;
  error?: string;
}

async function apiCall(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const url = `${API_BASE}/admin/update${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as ApiResponse;
}

// Fleet confirm state: track pending /update fleet confirmations per chat
const pendingFleetConfirm = new Map<number, number>();
const FLEET_CONFIRM_TIMEOUT_MS = 60_000;

export async function handleUpdateCommand(
  chatId: number,
  text: string,
  sendMessage: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  const parts = text.trim().split(/\s+/);
  // parts[0] = "/update", parts[1] = subcommand, parts[2+] = args
  const sub = parts[1]?.toLowerCase() ?? "status";

  try {
    switch (sub) {
      case "status":
        await handleStatus(chatId, sendMessage);
        break;

      case "build":
        await handleBuild(chatId, parts[2], sendMessage);
        break;

      case "canary":
        await handleCanary(chatId, parts[2]?.toLowerCase(), parts.slice(3), sendMessage);
        break;

      case "fleet":
        await handleFleet(chatId, parts[2]?.toLowerCase(), sendMessage);
        break;

      case "rollback":
        await handleRollback(chatId, sendMessage);
        break;

      default:
        await sendMessage(chatId, [
          "Unknown subcommand. Available:",
          "  /update status",
          "  /update build [oc-version]",
          "  /update canary start",
          "  /update canary advance",
          "  /update canary set slug1,slug2,...",
          "  /update fleet",
          "  /update rollback",
        ].join("\n"));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Update command failed: ${msg}`);
  }
}

async function handleStatus(
  chatId: number,
  sendMessage: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  const data = await apiCall("GET", "/status");
  if (data.error) {
    await sendMessage(chatId, `Error: ${data.error}`);
    return;
  }

  const tc = data.tigerClaw as { current?: string } | undefined;
  const oc = data.openClaw as { current?: string } | undefined;
  const canary = data.canary as { group?: string[]; stage?: string; startedAt?: string } | undefined;
  const rollout = data.rollout as { stage?: string; percentage?: number } | undefined;

  const lines = [
    "Deployment Status",
    `  TC Version:  ${tc?.current ?? "unknown"}`,
    `  OC Version:  ${oc?.current ?? "unknown"}`,
    `  Image Tag:   ${(data.imageTag as string) ?? "unknown"}`,
    `  Last Build:  ${(data.lastBuildAt as string) ?? "never"}`,
    "",
    "Canary",
    `  Group: ${canary?.group?.join(", ") ?? "not set"}`,
    `  Stage: ${canary?.stage ?? "none"}`,
    `  Started: ${canary?.startedAt ?? "—"}`,
    "",
    "Rollout",
    `  Stage: ${rollout?.stage ?? "none"}`,
    `  Percentage: ${rollout?.percentage ?? 0}%`,
  ];

  await sendMessage(chatId, lines.join("\n"));
}

async function handleBuild(
  chatId: number,
  ocVersion: string | undefined,
  sendMessage: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  await sendMessage(chatId, `Building image${ocVersion ? ` with OC ${ocVersion}` : " (current OC version)"}...`);

  const data = await apiCall("POST", "/build", {
    ocVersion: ocVersion || undefined,
  });

  if (data.error) {
    await sendMessage(chatId, `Build FAILED: ${data.error}`);
    return;
  }

  await sendMessage(chatId, [
    "Build complete.",
    `  Image: ${data.imageTag ?? "unknown"}`,
    `  TC: ${data.tcVersion ?? "unknown"}`,
    `  OC: ${data.ocVersion ?? "unknown"}`,
    "",
    "Next: /update canary start",
  ].join("\n"));
}

async function handleCanary(
  chatId: number,
  action: string | undefined,
  args: string[],
  sendMessage: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  switch (action) {
    case "start": {
      const data = await apiCall("POST", "/canary/start");
      if (data.error) {
        await sendMessage(chatId, `Canary start FAILED: ${data.error}`);
        return;
      }
      const slugs = (data.slugs as string[]) ?? [];
      const soakEnd = data.soakEndAt as string | undefined;
      await sendMessage(chatId, [
        "Canary deployment started.",
        `  Group: ${slugs.join(", ")}`,
        `  Soak until: ${soakEnd ?? "now + 24h"}`,
        `  Containers: ${data.containerCount ?? slugs.length}`,
        "",
        "Wait 24h, then: /update canary advance",
      ].join("\n"));
      break;
    }

    case "advance": {
      const data = await apiCall("POST", "/canary/advance");
      if (data.error) {
        await sendMessage(chatId, `Canary advance FAILED: ${data.error}`);
        return;
      }
      await sendMessage(chatId, [
        "Rollout advanced.",
        `  New stage: ${data.stage ?? "unknown"}`,
        `  Percentage: ${data.percentage ?? "?"}%`,
        `  Containers updating: ${data.containerCount ?? "?"}`,
      ].join("\n"));
      break;
    }

    case "set": {
      const slugStr = args.join(" ").replace(/\s+/g, ",");
      const slugs = slugStr.split(",").map((s) => s.trim()).filter(Boolean);
      if (slugs.length !== 5) {
        await sendMessage(chatId, `Canary group must be exactly 5 slugs, got ${slugs.length}.\nUsage: /update canary set slug1,slug2,slug3,slug4,slug5`);
        return;
      }
      const data = await apiCall("POST", "/canary/set", { slugs });
      if (data.error) {
        await sendMessage(chatId, `Set canary FAILED: ${data.error}`);
        return;
      }
      await sendMessage(chatId, `Canary group updated: ${slugs.join(", ")}`);
      break;
    }

    default:
      await sendMessage(chatId, [
        "Usage:",
        "  /update canary start",
        "  /update canary advance",
        "  /update canary set slug1,slug2,slug3,slug4,slug5",
      ].join("\n"));
  }
}

async function handleFleet(
  chatId: number,
  confirmArg: string | undefined,
  sendMessage: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  const pending = pendingFleetConfirm.get(chatId);
  const now = Date.now();

  if (confirmArg === "confirm" && pending && now - pending < FLEET_CONFIRM_TIMEOUT_MS) {
    pendingFleetConfirm.delete(chatId);
    const data = await apiCall("POST", "/fleet");
    if (data.error) {
      await sendMessage(chatId, `Fleet rollout FAILED: ${data.error}`);
      return;
    }
    await sendMessage(chatId, [
      "Fleet rollout to 100% started.",
      `  Containers updating: ${data.containerCount ?? "all"}`,
    ].join("\n"));
    return;
  }

  pendingFleetConfirm.set(chatId, now);
  await sendMessage(chatId, [
    "This will deploy to 100% of the fleet immediately.",
    "Reply /update fleet confirm within 60 seconds to proceed.",
  ].join("\n"));
}

async function handleRollback(
  chatId: number,
  sendMessage: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  const data = await apiCall("POST", "/rollback");
  if (data.error) {
    await sendMessage(chatId, `Rollback FAILED: ${data.error}`);
    return;
  }
  await sendMessage(chatId, [
    "Rollback complete.",
    `  Rolled back to: ${data.previousImageTag ?? "unknown"}`,
    `  Containers affected: ${data.containerCount ?? "?"}`,
  ].join("\n"));
}

export default handleUpdateCommand;
