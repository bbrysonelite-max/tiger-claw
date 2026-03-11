#!/usr/bin/env npx tsx
// Tiger Claw — MTProto Session String Generator
//
// Keeps a single live connection open. Polls /tmp/tc_auth_code.txt for the OTP
// so the code never expires between two separate process invocations.
//
// Usage:
//   npx tsx auth_session.ts --phone +16024157593
//   (In another terminal or from Claude): echo "12345" > /tmp/tc_auth_code.txt

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
function flag(name: string, fallback = ""): string {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1]! : fallback;
}

const apiId = parseInt(process.env["TELEGRAM_API_ID"] ?? "");
const apiHash = process.env["TELEGRAM_API_HASH"] ?? "";
const phone = flag("--phone");
const CODE_FILE = "/tmp/tc_auth_code.txt";
const SESSIONS_FILE = path.join(__dirname, "sessions.json");

if (!apiId || !apiHash) {
  console.error("TELEGRAM_API_ID and TELEGRAM_API_HASH env vars are required.");
  process.exit(1);
}
if (!phone) {
  console.error("--phone is required. Example: npx tsx auth_session.ts --phone +16024157593");
  process.exit(1);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function waitForCode(): Promise<string> {
  // Clear any old code file first
  if (fs.existsSync(CODE_FILE)) fs.unlinkSync(CODE_FILE);

  console.log(`\nWaiting for code... Write it to ${CODE_FILE}`);
  console.log("Example: echo \"12345\" > /tmp/tc_auth_code.txt\n");

  const deadline = Date.now() + 4 * 60 * 1000; // 4 minute timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(CODE_FILE)) {
      const code = fs.readFileSync(CODE_FILE, "utf8").trim();
      fs.unlinkSync(CODE_FILE);
      if (code) return code;
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for auth code (4 minutes)");
}

async function main(): Promise<void> {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log(`Connecting to Telegram for ${phone}...`);
  await client.connect();

  // Send code
  const sendResult = await client.invoke(new Api.auth.SendCode({
    phoneNumber: phone,
    apiId,
    apiHash,
    settings: new Api.CodeSettings({
      allowFlashcall: false,
      currentNumber: false,
      allowAppHash: false,
      allowMissedCall: false,
    }),
  }));

  let phoneCodeHash = sendResult.phoneCodeHash;
  const codeType = (sendResult.type as any)?.className ?? "unknown";
  console.log(`Code sent via: ${codeType}`);

  if (codeType.toLowerCase().includes("app")) {
    console.log(">>> Check your Telegram app for the code <<<");
  } else {
    // Try voice call resend for non-app delivery
    try {
      const r = await client.invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash }));
      phoneCodeHash = r.phoneCodeHash;
      console.log(`After resend: ${(r.type as any)?.className}`);
    } catch (e: any) {
      console.log(`Resend skipped: ${e.message}`);
    }
  }

  // Wait for code (stays connected the whole time)
  const code = await waitForCode();
  console.log(`Got code: ${code} — signing in...`);

  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: phone,
      phoneCodeHash,
      phoneCode: code,
    }));
  } catch (err: any) {
    if ((err?.message ?? "").includes("SESSION_PASSWORD_NEEDED")) {
      console.error("2FA is enabled on this number — cannot use for bot creation.");
      process.exit(1);
    }
    throw err;
  }

  const sessionString = client.session.save() as unknown as string;

  // Save to sessions.json
  const sessions: any[] = fs.existsSync(SESSIONS_FILE)
    ? JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"))
    : [];
  const label = `sim-${phone.replace(/\D/g, "").slice(-10)}`;
  const existing = sessions.findIndex((s: any) => s.accountLabel === label);
  if (existing >= 0) sessions[existing].sessionString = sessionString;
  else sessions.push({ accountLabel: label, sessionString });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));

  console.log(`\nSession saved to sessions.json as "${label}"`);
  console.log("\n=== SESSION STRING ===");
  console.log(sessionString);
  console.log("=== END SESSION STRING ===");

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
