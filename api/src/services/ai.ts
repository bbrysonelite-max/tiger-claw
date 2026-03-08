import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { getTenant, getPool, getBotState, setBotState } from './db.js';
import TelegramBot from 'node-telegram-bot-api';
import IORedis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { loadFlavorConfig } from '../tools/flavorConfig.js';
import { decryptToken } from './pool.js';

// Load all 19 tools — ALL must remain registered. Missing tool = infinite loop.
import { tiger_onboard }     from '../tools/tiger_onboard.js';
import { tiger_scout }       from '../tools/tiger_scout.js';
import { tiger_contact }     from '../tools/tiger_contact.js';
import { tiger_aftercare }   from '../tools/tiger_aftercare.js';
import { tiger_briefing }    from '../tools/tiger_briefing.js';
import { tiger_convert }     from '../tools/tiger_convert.js';
import { tiger_export }      from '../tools/tiger_export.js';
import { tiger_hive }        from '../tools/tiger_hive.js';
import { tiger_import }      from '../tools/tiger_import.js';
import { tiger_keys }        from '../tools/tiger_keys.js';
import { tiger_lead }        from '../tools/tiger_lead.js';
import { tiger_move }        from '../tools/tiger_move.js';
import { tiger_note }        from '../tools/tiger_note.js';
import { tiger_nurture }     from '../tools/tiger_nurture.js';
import { tiger_objection }   from '../tools/tiger_objection.js';
import { tiger_score }       from '../tools/tiger_score.js';
import { tiger_score_1to10 } from '../tools/tiger_score_1to10.js';
import { tiger_search }      from '../tools/tiger_search.js';
import { tiger_settings }    from '../tools/tiger_settings.js';

// ─── Safety constants ────────────────────────────────────────────────────────
// BUG 1 FIX: circuit breaker — prevents infinite tool loop if Gemini misbehaves
const MAX_TOOL_CALLS = 10;

// BUG 5 FIX: cap history size — prevents context window overflow for long-running tenants
// Each turn = 2 entries (user + model). 20 turns = 40 entries.
const MAX_HISTORY_TURNS = 20;

// ─── Tool registry ───────────────────────────────────────────────────────────
const toolsMap = {
    tiger_onboard,
    tiger_scout,
    tiger_contact,
    tiger_aftercare,
    tiger_briefing,
    tiger_convert,
    tiger_export,
    tiger_hive,
    tiger_import,
    tiger_keys,
    tiger_lead,
    tiger_move,
    tiger_note,
    tiger_nurture,
    tiger_objection,
    tiger_score,
    tiger_score_1to10,
    tiger_search,
    tiger_settings,
};

const geminiTools = [{
    functionDeclarations: Object.values(toolsMap).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
    })),
}];

// ─── Redis ───────────────────────────────────────────────────────────────────
const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

// ─── Chat history ────────────────────────────────────────────────────────────
async function getChatHistory(tenantId: string, chatId: number): Promise<Content[]> {
    try {
        const raw = await redis.get(`chat_history:${tenantId}:${chatId}`);
        return raw ? JSON.parse(raw) : [];
    } catch (err: any) {
        // BUG 3 FIX: loud failure — do not silently ignore
        console.error(`[AI] [ALERT] Failed to load chat history for tenant ${tenantId}:`, err.message);
        return []; // start fresh rather than crash
    }
}

async function saveChatHistory(tenantId: string, chatId: number, history: Content[]): Promise<void> {
    // BUG 5 FIX: trim before saving — last MAX_HISTORY_TURNS turns kept
    const trimmed = history.slice(-(MAX_HISTORY_TURNS * 2));
    await redis.set(
        `chat_history:${tenantId}:${chatId}`,
        JSON.stringify(trimmed),
        'EX',
        86400 * 7,
    );
}

// ─── Key resolution ──────────────────────────────────────────────────────────
/**
 * BUG 2 FIX: Resolves the active Google API key using the 4-layer system.
 *
 * Priority:
 *   1. key_state.json in tenant workdir (managed by tiger_keys tool) — authoritative
 *   2. DB bot_ai_config (BYOK set during onboarding, before key_state exists)
 *   3. Platform Layer 1 default (PLATFORM_ONBOARDING_KEY or GOOGLE_API_KEY)
 *
 * All failures are logged loudly with [ALERT] tag.
 * Wire [ALERT] logs to admin Telegram bot for production monitoring.
 */
async function resolveGoogleKey(tenantId: string, workdir: string): Promise<string | undefined> {
    // Step 1 — tiger_keys state file (4-layer system source of truth)
    const keyStatePath = path.join(workdir, 'key_state.json');
    try {
        if (fs.existsSync(keyStatePath)) {
            const state = JSON.parse(fs.readFileSync(keyStatePath, 'utf8'));

            if (state.tenantPaused) {
                console.warn(`[AI] [ALERT] Tenant ${tenantId} is paused (key_state.json tenantPaused=true). No key issued.`);
                return undefined;
            }

            const activeLayer: number = state.activeLayer ?? 1;

            switch (activeLayer) {
                case 1:
                    return process.env.PLATFORM_ONBOARDING_KEY ?? process.env.GOOGLE_API_KEY;

                case 2:
                    if (!state.layer2Key) {
                        console.error(`[AI] [ALERT] Tenant ${tenantId} is on Layer 2 but layer2Key is missing from key_state.json.`);
                    }
                    return state.layer2Key ? decryptToken(state.layer2Key) : undefined;

                case 3:
                    if (!state.layer3Key) {
                        console.error(`[AI] [ALERT] Tenant ${tenantId} is on Layer 3 but layer3Key is missing from key_state.json.`);
                    }
                    return state.layer3Key ? decryptToken(state.layer3Key) : undefined;

                case 4:
                    console.warn(`[AI] [ALERT] Tenant ${tenantId} on Layer 4 (platform emergency key). Operator action required.`);
                    return process.env.PLATFORM_EMERGENCY_KEY ?? process.env.GOOGLE_API_KEY;

                default:
                    console.error(`[AI] [ALERT] Tenant ${tenantId} has unknown activeLayer=${activeLayer} in key_state.json.`);
            }
        }
    } catch (err: any) {
        // BUG 3 FIX: was `catch (_)` — now loud
        console.error(`[AI] [ALERT] Failed to read key_state.json for tenant ${tenantId}:`, err.message);
    }

    // Step 2 — DB BYOK lookup (new tenant whose key_state hasn't been initialized yet)
    try {
        const pool = getPool();
        const configRes = await pool.query(
            `SELECT * FROM bot_ai_config
             WHERE bot_id = (
               SELECT id FROM bots
               WHERE user_id = (
                 SELECT id FROM users
                 WHERE email = (SELECT email FROM tenants WHERE id = $1)
               ) LIMIT 1
             )`,
            [tenantId],
        );
        if (configRes.rows.length > 0) {
            const config = configRes.rows[0];
            if (config.provider === 'google' && config.encrypted_key) {
                const { decryptToken } = await import('./pool.js');
                return decryptToken(config.encrypted_key);
            }
        }
    } catch (err: any) {
        // BUG 3 FIX: was `catch (_)` — now loud
        console.error(`[AI] [ALERT] BYOK DB lookup failed for tenant ${tenantId}:`, err.message);
    }

    // Step 3 — Platform Layer 1 fallback (onboarding / new tenant)
    return process.env.PLATFORM_ONBOARDING_KEY ?? process.env.GOOGLE_API_KEY;
}

// ─── Tool context ─────────────────────────────────────────────────────────────
function buildToolContext(tenantId: string, tenant: any) {
    const workdir = path.join(process.cwd(), 'data', tenantId);
    fs.mkdirSync(workdir, { recursive: true });
    return {
        sessionKey: tenantId,
        agentId: tenantId,
        workdir,
        config: {
            TIGER_CLAW_TENANT_ID: tenantId,
            TIGER_CLAW_TENANT_SLUG: tenant.slug,   // slug for tools that build API URLs
            BOT_FLAVOR: tenant.flavor,
            REGION: tenant.region,
            PREFERRED_LANGUAGE: tenant.language,
            TIGER_CLAW_API_URL: process.env.TIGER_CLAW_API_URL ?? 'http://localhost:4000',
        },
        abortSignal: new AbortController().signal,
        logger: console,
        storage: {
            get: (key: string) => getBotState(tenantId, key),
            set: (key: string, value: any) => setBotState(tenantId, key, value),
        },
    };
}

// ─── System prompt ────────────────────────────────────────────────────────────
/**
 * BUG 4 FIX: Injects flavor config into the system prompt.
 * Previously: 2-sentence generic prompt. Now: flavor persona, keywords, compliance.
 */
function buildSystemPrompt(tenant: any): string {
    const flavor = loadFlavorConfig(tenant.flavor);
    return [
        `You are Tiger Claw, an elite AI sales and recruiting agent operating for ${tenant.name}.`,
        `Industry flavor: ${flavor.name} (${flavor.professionLabel}).`,
        `Respond in: ${tenant.language ?? 'English'}.`,
        `Lead scoring threshold: 80 (LOCKED — never contact a prospect scoring below 80).`,
        `Key prospect keywords: ${flavor.defaultKeywords.slice(0, 8).join(', ')}.`,
        `Use your 19 registered tools to manage prospects, leads, nurture sequences, objections, and follow-ups.`,
        `After every outbound message or AI response, call tiger_keys with action="record_message" to track layer usage.`,
        `If you receive an API error, call tiger_keys with action="report_error" and the HTTP status immediately.`,
        `Never fabricate contact information. Never claim income. Always include an opt-out in outreach.`,
    ].join('\n');
}

// ─── Tool execution loop ─────────────────────────────────────────────────────
async function runToolLoop(
    chat: any,
    initialResponse: any,
    toolContext: any,
    logPrefix: string,
): Promise<any> {
    let response = initialResponse;
    let toolCallCount = 0;

    while ((response.functionCalls?.() ?? []).length > 0) {
        // BUG 1 FIX: circuit breaker
        if (toolCallCount >= MAX_TOOL_CALLS) {
            console.error(
                `[${logPrefix}] [ALERT] Circuit breaker: ${toolCallCount} tool calls reached for tenant ${toolContext.agentId}. Aborting loop.`,
            );
            break;
        }

        const calls = response.functionCalls()!;
        const functionResponses: Part[] = [];

        for (const fc of calls) {
            toolCallCount++;
            console.log(`[${logPrefix}] Tool (${toolCallCount}/${MAX_TOOL_CALLS}): ${fc.name}`);

            const tool = toolsMap[fc.name as keyof typeof toolsMap];
            let toolResult: any;

            if (!tool) {
                // Unknown tool — Gemini hallucinated a tool name
                console.error(`[${logPrefix}] [ALERT] Unknown tool called: "${fc.name}" — not in toolsMap`);
                toolResult = { error: `Unknown tool "${fc.name}". Only registered tools may be called.` };
            } else {
                try {
                    toolResult = await tool.execute(fc.args, toolContext);
                } catch (toolErr: any) {
                    console.error(`[${logPrefix}] Tool ${fc.name} threw:`, toolErr.message);
                    toolResult = { error: toolErr.message };
                }
            }

            functionResponses.push({
                functionResponse: { name: fc.name, response: toolResult },
            } as any);
        }

        const nextResult = await chat.sendMessage(functionResponses);
        response = nextResult.response;
    }

    return response;
}

// ─── Public: process a Telegram user message ─────────────────────────────────
export async function processTelegramMessage(
    tenantId: string,
    botToken: string,
    chatId: number,
    text: string,
) {
    const bot = new TelegramBot(botToken);
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const toolContext = buildToolContext(tenantId, tenant);
    const googleKey = await resolveGoogleKey(tenantId, toolContext.workdir);

    if (!googleKey) {
        await bot.sendMessage(
            chatId,
            '⚠️ Your bot is paused. Please contact support or add your API key to reactivate.',
        );
        return;
    }

    try {
        await bot.sendChatAction(chatId, 'typing');

        const history = await getChatHistory(tenantId, chatId);
        const genAI = new GoogleGenerativeAI(googleKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: buildSystemPrompt(tenant),
            tools: geminiTools as any,
        });

        const chat = model.startChat({ history });
        const initial = await chat.sendMessage(text);
        const finalResponse = await runToolLoop(chat, initial.response, toolContext, 'AI');

        const updatedHistory = await chat.getHistory();
        await saveChatHistory(tenantId, chatId, updatedHistory);

        const replyText = finalResponse.text?.() ?? '';
        if (replyText.trim().length > 0) {
            await bot.sendMessage(chatId, replyText);
        }
    } catch (err: any) {
        console.error(`[AI] [ALERT] processTelegramMessage failed for tenant ${tenantId}:`, err.message);
        // Do not expose internal error details to the customer
        await bot.sendMessage(
            chatId,
            '❌ Something went wrong. The operator has been notified. Please try again in a moment.',
        );
    }
}

// ─── Public: process a background system routine ──────────────────────────────
export async function processSystemRoutine(tenantId: string, routineType: string) {
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const toolContext = buildToolContext(tenantId, tenant);
    const googleKey = await resolveGoogleKey(tenantId, toolContext.workdir);

    if (!googleKey) {
        console.warn(`[AI Routine] [ALERT] No API key for tenant ${tenantId}. Aborting ${routineType}.`);
        return;
    }

    try {
        // System routines always start with a clean history. Persisting routine
        // chat history causes the next run to start with a 'function' role message
        // (from the previous run's tool responses), which Gemini rejects.
        const genAI = new GoogleGenerativeAI(googleKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: buildSystemPrompt(tenant),
            tools: geminiTools as any,
        });

        const systemPrompts: Record<string, string> = {
            daily_scout:   'SYSTEM: Run your Daily Scout routine. Find new leads to contact.',
            nurture_check: 'SYSTEM: Run your Nurture Check. Review follow-ups and reach out where due.',
        };
        const prompt = systemPrompts[routineType] ?? `SYSTEM: Execute routine: ${routineType}`;

        const chat = model.startChat({ history: [] });
        const initial = await chat.sendMessage(prompt);
        await runToolLoop(chat, initial.response, toolContext, `AI Routine:${routineType}`);

        console.log(`[AI Routine] ${routineType} complete for tenant ${tenantId}.`);
    } catch (err: any) {
        console.error(`[AI Routine] [ALERT] ${routineType} failed for tenant ${tenantId}:`, err.message);
    }
}

// ─── Public: process a LINE user message ─────────────────────────────────────
// LINE Push API is used (not Reply API) because the message is processed
// asynchronously via BullMQ — the 30-second replyToken window is too short.
export async function processLINEMessage(
    tenantId: string,
    encryptedChannelAccessToken: string,
    userId: string,
    text: string,
) {
    const channelAccessToken = decryptToken(encryptedChannelAccessToken);

    const sendLineMessage = async (message: string) => {
        try {
            const resp = await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${channelAccessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: userId,
                    messages: [{ type: 'text', text: message.slice(0, 5000) }],
                }),
            });
            if (!resp.ok) {
                console.error(`[AI] LINE push API error ${resp.status} for tenant ${tenantId}:`, await resp.text());
            }
        } catch (err) {
            console.error(`[AI] Failed to send LINE message to ${userId}:`, err);
        }
    };

    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

    const toolContext = buildToolContext(tenantId, tenant);
    const googleKey = await resolveGoogleKey(tenantId, toolContext.workdir);

    if (!googleKey) {
        await sendLineMessage('⚠️ Your bot is paused. Please contact support or add your API key to reactivate.');
        return;
    }

    // Use LINE userId as chatId for per-user history (stored as string in Redis key)
    const chatId = userId as unknown as number;

    try {
        const history = await getChatHistory(tenantId, chatId);
        const genAI = new GoogleGenerativeAI(googleKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: buildSystemPrompt(tenant),
            tools: geminiTools as any,
        });

        const chat = model.startChat({ history });
        const initial = await chat.sendMessage(text);
        const finalResponse = await runToolLoop(chat, initial.response, toolContext, 'AI');

        const updatedHistory = await chat.getHistory();
        await saveChatHistory(tenantId, chatId, updatedHistory);

        const replyText = finalResponse.text?.() ?? '';
        if (replyText.trim().length > 0) {
            await sendLineMessage(replyText);
        }
    } catch (err: any) {
        console.error(`[AI] [ALERT] processLINEMessage failed for tenant ${tenantId}:`, err.message);
        await sendLineMessage('❌ Something went wrong. The operator has been notified. Please try again in a moment.');
    }
}
