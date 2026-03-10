#!/usr/bin/env npx tsx
// Tiger Claw — MTProto Session String Generator (Voice Call OTP)
//
// Uses the low-level GramJS MTProto API to request a code, then
// immediately resends via voice call to bypass carrier short-code
// blocking. Prompts the user for phone number and OTP via stdin.
//
// Usage:
//   npx tsx ops/botpool/auth_session.ts --api-id 12345 --api-hash abc123
//
// Or via env vars:
//   TELEGRAM_API_ID=12345 TELEGRAM_API_HASH=abc123 npx tsx ops/botpool/auth_session.ts
//
// Output: a single session string that can be pasted into sessions.json.

import { TelegramClient, Api } from "telegram";
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

  console.log("Starting Telegram authentication (voice call OTP)...\n");

  await client.connect();

  const phone = await input.text("Phone number (with country code, e.g. +1234567890): ");

  // Step 1: Request code via SendCode (low-level MTProto API)
  console.log(`\nRequesting initial OTP for ${phone}...`);
  const sendResult = await client.invoke(new Api.auth.SendCode({
    phoneNumber: phone,
    apiId: apiId,
    apiHash: apiHash,
    settings: new Api.CodeSettings({
      allowFlashcall: false,
      currentNumber: false,
      allowAppHash: false,
      allowMissedCall: false,
    }),
  }));

  let phoneCodeHash = sendResult.phoneCodeHash;
  const initialType = (sendResult.type as any)?.className ?? "unknown";
  console.log(`Initial code delivery type: ${initialType}`);

  // Step 2: Force resend as voice call — always resend to switch to voice
  console.log("Requesting voice call resend...");
  try {
    const resendResult = await client.invoke(new Api.auth.ResendCode({
      phoneNumber: phone,
      phoneCodeHash: phoneCodeHash,
    }));
    phoneCodeHash = resendResult.phoneCodeHash;
    const resendType = (resendResult.type as any)?.className ?? "unknown";
    console.log(`Resend delivery type: ${resendType}`);

    // If the first resend didn't produce a voice call, try once more
    if (!resendType.toLowerCase().includes("call")) {
      console.log("Not a voice call yet — requesting another resend...");
      try {
        const resend2 = await client.invoke(new Api.auth.ResendCode({
          phoneNumber: phone,
          phoneCodeHash: phoneCodeHash,
        }));
        phoneCodeHash = resend2.phoneCodeHash;
        const type2 = (resend2.type as any)?.className ?? "unknown";
        console.log(`Second resend delivery type: ${type2}`);
      } catch (err2: any) {
        console.warn(`Second resend failed: ${err2.message ?? err2} — proceeding with previous hash`);
      }
    }
  } catch (err: any) {
    console.warn(`Resend failed: ${err.message ?? err} — proceeding with original hash`);
  }

  console.log("\n🔔 WAITING FOR VOICE CALL — Telegram will call your phone and read a code.\n");

  const code = await input.text("Verification code from Telegram: ");

  // Step 3: Sign in
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: phone,
      phoneCodeHash: phoneCodeHash,
      phoneCode: code,
    }));
  } catch (signInErr: any) {
    const msg = signInErr?.message ?? String(signInErr);
    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      console.log("\n2FA is enabled — entering password...");
      const password = await input.text("2FA password: ");
      // Use client's built-in 2FA handling
      await client.signInWithPassword(
        { apiId, apiHash },
        { password: async () => password, onError: (e: Error) => { throw e; } },
      );
    } else {
      throw signInErr;
    }
  }

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
