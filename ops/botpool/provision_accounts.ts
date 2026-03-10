#!/usr/bin/env npx tsx
// Tiger Claw — Fully Automated Account Provisioning
//
// End-to-end pipeline: buy SMS-MAN numbers → poll for OTP → authenticate
// with Telegram via GramJS → save session strings. Zero human interaction.
//
// Usage:
//   npx tsx ops/botpool/provision_accounts.ts --count 13 --country 7
//
// Environment variables:
//   SMSMAN_API_KEY        — SMS-MAN API token
//   TELEGRAM_API_ID       — from https://my.telegram.org/apps
//   TELEGRAM_API_HASH     — from https://my.telegram.org/apps
//
// Outputs:
//   ops/botpool/sms_numbers.json   — purchased phone numbers + request IDs
//   ops/botpool/sessions.json      — authenticated session strings
//
// Both files are append-safe: the script reads existing entries on start and
// only adds new ones. Survives restarts cleanly.

import * as fs from "fs";
import * as path from "path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SMSMAN_BASE = "https://api.sms-man.com/control";
const TELEGRAM_APP_ID = 3; // SMS-MAN application_id for Telegram
const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes
const INTER_NUMBER_DELAY_MS = 2_000; // breathing room between purchases
const HTTP_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const SMS_NUMBERS_PATH = path.join(SCRIPT_DIR, "sms_numbers.json");
const SESSIONS_PATH = path.join(SCRIPT_DIR, "sessions.json");

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2);

function flag(name: string, fallback: string): string {
    const i = rawArgs.indexOf(name);
    return i !== -1 && rawArgs[i + 1] ? rawArgs[i + 1]! : fallback;
}

const COUNT = parseInt(flag("--count", "13"), 10);
const COUNTRY_ID = parseInt(flag("--country", "7"), 10);

const SMSMAN_API_KEY = process.env["SMSMAN_API_KEY"] ?? "";
const TELEGRAM_API_ID = parseInt(process.env["TELEGRAM_API_ID"] ?? "", 10);
const TELEGRAM_API_HASH = process.env["TELEGRAM_API_HASH"] ?? "";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEnv(): void {
    const missing: string[] = [];
    if (!SMSMAN_API_KEY) missing.push("SMSMAN_API_KEY");
    if (!TELEGRAM_API_ID || isNaN(TELEGRAM_API_ID)) missing.push("TELEGRAM_API_ID");
    if (!TELEGRAM_API_HASH) missing.push("TELEGRAM_API_HASH");

    if (missing.length > 0) {
        console.error("ERROR: Missing required environment variables:");
        missing.forEach((v) => console.error(`  - ${v}`));
        console.error("\nExport them before running:");
        console.error('  export SMSMAN_API_KEY="your_key"');
        console.error('  export TELEGRAM_API_ID="12345"');
        console.error('  export TELEGRAM_API_HASH="abc123"');
        process.exit(1);
    }

    if (isNaN(COUNT) || COUNT < 1) {
        console.error("ERROR: --count must be a positive integer");
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ts(): string {
    return new Date().toISOString().slice(11, 19);
}

function log(msg: string): void {
    console.log(`[${ts()}] ${msg}`);
}

function logError(msg: string): void {
    console.error(`[${ts()}] ERROR: ${msg}`);
}

function logWarn(msg: string): void {
    console.warn(`[${ts()}] WARN: ${msg}`);
}

// ---------------------------------------------------------------------------
// Persistent JSON helpers (append-safe, survives restarts)
// ---------------------------------------------------------------------------

interface SmsNumberEntry {
    phone: string;
    request_id: number;
    country_id: number;
    purchased_at: string;
}

interface SessionEntry {
    accountLabel: string;
    sessionString: string;
    phone: string;
    authenticated_at: string;
}

function readJsonArray<T>(filePath: string): T[] {
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            if (Array.isArray(data)) return data as T[];
        }
    } catch (err) {
        logWarn(`Could not parse ${path.basename(filePath)}, starting fresh: ${err}`);
    }
    return [];
}

function writeJsonArray<T>(filePath: string, data: T[]): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function appendEntry<T>(filePath: string, entry: T): void {
    const arr = readJsonArray<T>(filePath);
    arr.push(entry);
    writeJsonArray(filePath, arr);
}

// ---------------------------------------------------------------------------
// HTTP helper (fetch with timeout + retries)
// ---------------------------------------------------------------------------

async function fetchJson(url: string, params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams(params).toString();
    const fullUrl = `${url}?${qs}`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

            const resp = await fetch(fullUrl, { signal: controller.signal });
            clearTimeout(timer);

            if (!resp.ok) {
                const body = await resp.text().catch(() => "");
                throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
            }

            const data = await resp.json();

            // SMS-MAN returns { success: false, error_code, error_msg } on failure
            if (typeof data === "object" && data !== null && data.success === false) {
                const code = data.error_code ?? "unknown";
                const msg = data.error_msg ?? "";
                throw new SmsManError(code, msg);
            }

            return data;
        } catch (err) {
            if (err instanceof SmsManError) throw err; // don't retry API-level errors
            if (attempt === MAX_RETRIES) throw err;
            logWarn(`Request failed (attempt ${attempt}/${MAX_RETRIES}): ${err}. Retrying...`);
            await sleep(RETRY_DELAY_MS);
        }
    }
}

class SmsManError extends Error {
    code: string;
    constructor(code: string, msg: string) {
        super(`[${code}] ${msg}`);
        this.code = code;
    }
}

// ---------------------------------------------------------------------------
// SMS-MAN API
// ---------------------------------------------------------------------------

async function getBalance(): Promise<number> {
    const data = await fetchJson(`${SMSMAN_BASE}/get-balance`, { token: SMSMAN_API_KEY });
    return parseFloat(data.balance);
}

async function getStock(): Promise<number> {
    const data = await fetchJson(`${SMSMAN_BASE}/limits`, {
        token: SMSMAN_API_KEY,
        country_id: String(COUNTRY_ID),
        application_id: String(TELEGRAM_APP_ID),
    });
    // SMS-MAN returns {"3": {numbers: N}} (object keyed by application_id)
    if (Array.isArray(data) && data.length > 0) {
        return parseInt(data[0].numbers ?? "0", 10);
    }
    if (typeof data === "object" && data !== null) {
        const entry = data[String(TELEGRAM_APP_ID)] ?? Object.values(data)[0];
        if (entry?.numbers != null) return parseInt(entry.numbers, 10);
    }
    return 0;
}

async function buyNumber(): Promise<{ phone: string; request_id: number }> {
    const data = await fetchJson(`${SMSMAN_BASE}/get-number`, {
        token: SMSMAN_API_KEY,
        country_id: String(COUNTRY_ID),
        application_id: String(TELEGRAM_APP_ID),
    });
    log(`  [debug] get-number response: ${JSON.stringify(data)}`);
    if (!data || !data.number || !data.request_id) {
        throw new Error(`Unexpected get-number response: ${JSON.stringify(data)}`);
    }
    return {
        phone: `+${data.number}`,
        request_id: data.request_id,
    };
}

async function pollForOtp(requestId: number, phone: string): Promise<string | null> {
    const start = Date.now();
    log(`  Polling for OTP on ${phone} (timeout ${POLL_TIMEOUT_MS / 1000}s)...`);

    while (Date.now() - start < POLL_TIMEOUT_MS) {
        try {
            const data = await fetchJson(`${SMSMAN_BASE}/get-sms`, {
                token: SMSMAN_API_KEY,
                request_id: String(requestId),
            });

            const code = data.sms_code;
            if (code) return String(code);
        } catch (err) {
            if (err instanceof SmsManError && err.code === "wait_sms") {
                // Expected — no SMS yet
            } else {
                logError(`  Unexpected error polling ${phone}: ${err}`);
                return null;
            }
        }

        await sleep(POLL_INTERVAL_MS);
    }

    return null;
}

async function closeRequest(requestId: number): Promise<void> {
    try {
        await fetchJson(`${SMSMAN_BASE}/set-status`, {
            token: SMSMAN_API_KEY,
            request_id: String(requestId),
            status: "close",
        });
    } catch {
        // Best effort — don't crash if close fails
    }
}

async function rejectRequest(requestId: number): Promise<void> {
    try {
        await fetchJson(`${SMSMAN_BASE}/set-status`, {
            token: SMSMAN_API_KEY,
            request_id: String(requestId),
            status: "reject",
        });
    } catch {
        // Best effort
    }
}

// ---------------------------------------------------------------------------
// Telegram Authentication via GramJS (low-level, forces SMS delivery)
// ---------------------------------------------------------------------------

async function authenticateWithTelegram(
    phone: string,
    requestId: number,
): Promise<{ sessionString: string } | { error: string }> {
    const session = new StringSession("");
    const client = new TelegramClient(session, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
        connectionRetries: 5,
        retryDelay: 2000,
    });

    try {
        await client.connect();

        // Step 1: Request code — Telegram may send to existing app if account exists
        log(`  Requesting OTP for ${phone}...`);
        const sendResult = await client.invoke(new Api.auth.SendCode({
            phoneNumber: phone,
            apiId: TELEGRAM_API_ID,
            apiHash: TELEGRAM_API_HASH,
            settings: new Api.CodeSettings({
                allowFlashcall: false,
                currentNumber: false,
                allowAppHash: false,
                allowMissedCall: false,
            }),
        }));

        let phoneCodeHash = sendResult.phoneCodeHash;
        const codeType = (sendResult.type as any)?.className ?? "unknown";
        log(`  Initial code type: ${codeType}`);

        // Step 2: If code went to the app (not SMS), force resend as SMS
        if (!codeType.toLowerCase().includes("sms")) {
            log(`  Code routed to Telegram app — forcing SMS resend...`);
            try {
                const resendResult = await client.invoke(new Api.auth.ResendCode({
                    phoneNumber: phone,
                    phoneCodeHash: phoneCodeHash,
                }));
                phoneCodeHash = resendResult.phoneCodeHash;
                const newType = (resendResult.type as any)?.className ?? "unknown";
                log(`  Resent as: ${newType}`);
            } catch (resendErr) {
                logWarn(`  Resend failed: ${resendErr} — continuing with original hash`);
            }
        }

        // Step 3: Wait for SMS delivery then poll SMS-MAN
        // 20s gives the carrier time to route the SMS after the resend
        log(`  Waiting 20s for SMS delivery...`);
        await sleep(20_000);
        log(`  Polling SMS-MAN for OTP on ${phone}...`);
        const otp = await pollForOtp(requestId, phone);

        if (!otp) {
            await client.disconnect();
            return { error: "OTP_TIMEOUT — no code received" };
        }

        log(`  OTP received: ${otp} — signing in...`);

        // Step 4: Sign in with code
        try {
            await client.invoke(new Api.auth.SignIn({
                phoneNumber: phone,
                phoneCodeHash: phoneCodeHash,
                phoneCode: otp,
            }));
        } catch (signInErr: any) {
            const msg = signInErr?.message ?? String(signInErr);
            if (msg.includes("SESSION_PASSWORD_NEEDED")) {
                await client.disconnect();
                return { error: "2FA is enabled on this number — skipping" };
            }
            if (msg.includes("PHONE_CODE_INVALID") || msg.includes("PHONE_CODE_EXPIRED")) {
                await client.disconnect();
                return { error: `Code invalid/expired: ${msg}` };
            }
            throw signInErr;
        }

        const sessionString = client.session.save() as unknown as string;
        await client.disconnect();
        return { sessionString };

    } catch (err) {
        try { await client.disconnect(); } catch { /* ignore */ }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("SESSION_PASSWORD_NEEDED") || msg.includes("2FA")) {
            return { error: "2FA is enabled on this number — skipping" };
        }
        return { error: msg };
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function padIndex(i: number, total: number): string {
    const width = String(total).length;
    return String(i).padStart(width, "0");
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    validateEnv();

    log("=".repeat(60));
    log("Tiger Claw — Automated Account Provisioner");
    log(`  Numbers to buy:  ${COUNT}`);
    log(`  Country ID:      ${COUNTRY_ID}`);
    log(`  Numbers file:    ${SMS_NUMBERS_PATH}`);
    log(`  Sessions file:   ${SESSIONS_PATH}`);
    log("=".repeat(60));

    // Pre-flight checks
    const balance = await getBalance();
    log(`SMS-MAN balance: $${balance.toFixed(2)}`);

    const stock = await getStock();
    log(`Telegram numbers in stock (country ${COUNTRY_ID}): ${stock}`);

    const actualCount = Math.min(COUNT, stock);
    if (actualCount === 0) {
        logError("No numbers available. Try a different --country value.");
        process.exit(1);
    }
    if (actualCount < COUNT) {
        logWarn(`Only ${stock} numbers available — will buy ${actualCount} instead of ${COUNT}`);
    }

    // Determine starting index from existing sessions
    const existingSessions = readJsonArray<SessionEntry>(SESSIONS_PATH);
    let nextIndex = existingSessions.length + 1;

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < actualCount; i++) {
        const simLabel = `sim-${padIndex(nextIndex, nextIndex + actualCount)}`;
        log("");
        log(`--- [${i + 1}/${actualCount}] Provisioning ${simLabel} ---`);

        // Step 1: Buy number
        let phone: string;
        let requestId: number;
        try {
            const purchase = await buyNumber();
            phone = purchase.phone;
            requestId = purchase.request_id;
            log(`  Purchased: ${phone} (request_id=${requestId})`);
        } catch (err) {
            logError(`  Failed to buy number: ${err}`);
            failedCount++;
            await sleep(INTER_NUMBER_DELAY_MS);
            continue;
        }

        // Save to sms_numbers.json immediately (survive restarts)
        appendEntry<SmsNumberEntry>(SMS_NUMBERS_PATH, {
            phone,
            request_id: requestId,
            country_id: COUNTRY_ID,
            purchased_at: new Date().toISOString(),
        });

        // Step 2: Authenticate with Telegram
        // GramJS connects, sends phone to Telegram, Telegram dispatches OTP SMS,
        // then our phoneCode callback polls SMS-MAN and returns the code.
        log(`  Connecting to Telegram for ${phone}...`);
        const result = await authenticateWithTelegram(phone, requestId);

        if ("error" in result) {
            logWarn(`  ${result.error}`);
            if (result.error.includes("2FA")) {
                await closeRequest(requestId);
                skippedCount++;
            } else {
                await rejectRequest(requestId); // get refund on all other failures
                failedCount++;
            }
            await sleep(INTER_NUMBER_DELAY_MS);
            continue;
        }

        // Step 4: Save session string
        appendEntry<SessionEntry>(SESSIONS_PATH, {
            accountLabel: simLabel,
            sessionString: result.sessionString,
            phone,
            authenticated_at: new Date().toISOString(),
        });

        // Step 5: Close SMS-MAN request
        await closeRequest(requestId);

        successCount++;
        nextIndex++;
        log(`  ✓ ${simLabel} authenticated (${phone})`);

        // Brief pause between numbers
        if (i < actualCount - 1) {
            await sleep(INTER_NUMBER_DELAY_MS);
        }
    }

    // Final report
    const finalBalance = await getBalance().catch(() => -1);
    log("");
    log("=".repeat(60));
    log("PROVISIONING COMPLETE");
    log(`  ✓ Authenticated: ${successCount}`);
    log(`  ✗ Failed:        ${failedCount}`);
    log(`  ⚠ Skipped (2FA): ${skippedCount}`);
    log(`  Total processed: ${successCount + failedCount + skippedCount}`);
    log("");
    log(`  Sessions file:   ${SESSIONS_PATH}`);
    log(`  Numbers file:    ${SMS_NUMBERS_PATH}`);
    if (finalBalance >= 0) {
        log(`  SMS-MAN balance: $${finalBalance.toFixed(2)}`);
    }
    log("");
    if (successCount > 0) {
        log("Next step:");
        log("  npx tsx ops/botpool/create_bots.ts --mtproto --sessions ops/botpool/sessions.json --count 50");
    }
    log("=".repeat(60));
}

main().catch((err) => {
    logError(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
