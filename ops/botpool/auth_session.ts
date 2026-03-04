#!/usr/bin/env npx tsx
// Tiger Claw — MTProto Session String Generator
//
// Walks through the GramJS interactive login (phone number -> OTP -> 2FA)
// and prints the session string to stdout for saving into sessions.json.
//
// Usage:
//   npx tsx ops/botpool/auth_session.ts --api-id 12345 --api-hash abc123
//
// Or via env vars:
//   TELEGRAM_API_ID=12345 TELEGRAM_API_HASH=abc123 npx tsx ops/botpool/auth_session.ts
//
// Output: a single session string that can be pasted into sessions.json.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import input from "input";

const args = process.argv.slice(2);

function flag(name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1]! : fallback;
}

const apiId = parseInt(flag("--api-id", process.env["TELEGRAM_API_ID"] ?? ""));
const apiHash = flag("--api-hash", process.env["TELEGRAM_API_HASH"] ?? "");

if (!apiId || !apiHash) {
  console.error("TELEGRAM_API_ID and TELEGRAM_API_HASH are required.");
  console.error("Get them from https://my.telegram.org/apps");
  console.error("");
  console.error("Usage:");
  console.error("  npx tsx ops/botpool/auth_session.ts --api-id 12345 --api-hash abc123");
  process.exit(1);
}

async function main(): Promise<void> {
  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log("Starting Telegram authentication...\n");

  await client.start({
    phoneNumber: async () => input.text("Phone number (with country code, e.g. +1234567890): "),
    password: async () => input.text("2FA password (if enabled): "),
    phoneCode: async () => input.text("Verification code from Telegram: "),
    onError: (err: Error) => {
      console.error("Auth error:", err.message);
    },
  });

  const sessionString = client.session.save() as unknown as string;

  console.log("\n=== SESSION STRING ===");
  console.log(sessionString);
  console.log("=== END SESSION STRING ===\n");
  console.log("Add this to your sessions.json file:");
  console.log(`  { "accountLabel": "sim-XXX", "sessionString": "${sessionString.slice(0, 20)}..." }`);
  console.log("");
  console.log("The full string is printed above. Copy the entire value between the === markers.");

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
