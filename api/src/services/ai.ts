import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import { getTenant, getPool, getBotState, setBotState } from './db.js';
import TelegramBot from 'node-telegram-bot-api';
import IORedis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

// Load OpenClaw Tools
import { tiger_onboard } from '../tools/tiger_onboard.js';
import { tiger_scout } from '../tools/tiger_scout.js';
import { tiger_contact } from '../tools/tiger_contact.js';
import { tiger_aftercare } from '../tools/tiger_aftercare.js';
import { tiger_briefing } from '../tools/tiger_briefing.js';
import { tiger_convert } from '../tools/tiger_convert.js';
import { tiger_export } from '../tools/tiger_export.js';
import { tiger_hive } from '../tools/tiger_hive.js';
import { tiger_import } from '../tools/tiger_import.js';
import { tiger_keys } from '../tools/tiger_keys.js';
import { tiger_lead } from '../tools/tiger_lead.js';
import { tiger_move } from '../tools/tiger_move.js';
import { tiger_note } from '../tools/tiger_note.js';
import { tiger_nurture } from '../tools/tiger_nurture.js';
import { tiger_objection } from '../tools/tiger_objection.js';
import { tiger_score } from '../tools/tiger_score.js';
import { tiger_score_1to10 } from '../tools/tiger_score_1to10.js';
import { tiger_search } from '../tools/tiger_search.js';
import { tiger_settings } from '../tools/tiger_settings.js';

const toolsMap = {
    "tiger_onboard": tiger_onboard,
    "tiger_scout": tiger_scout,
    "tiger_contact": tiger_contact,
    "tiger_aftercare": tiger_aftercare,
    "tiger_briefing": tiger_briefing,
    "tiger_convert": tiger_convert,
    "tiger_export": tiger_export,
    "tiger_hive": tiger_hive,
    "tiger_import": tiger_import,
    "tiger_keys": tiger_keys,
    "tiger_lead": tiger_lead,
    "tiger_move": tiger_move,
    "tiger_note": tiger_note,
    "tiger_nurture": tiger_nurture,
    "tiger_objection": tiger_objection,
    "tiger_score": tiger_score,
    "tiger_score_1to10": tiger_score_1to10,
    "tiger_search": tiger_search,
    "tiger_settings": tiger_settings,
};

// Convert tools to Gemini function declaration format
const geminiTools = [{
    functionDeclarations: Object.values(toolsMap).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
    }))
}];

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

async function getChatHistory(tenantId: string, chatId: number): Promise<Content[]> {
    const raw = await redis.get(`chat_history:${tenantId}:${chatId}`);
    return raw ? JSON.parse(raw) : [];
}

async function saveChatHistory(tenantId: string, chatId: number, history: Content[]): Promise<void> {
    await redis.set(`chat_history:${tenantId}:${chatId}`, JSON.stringify(history), 'EX', 86400 * 7);
}

async function resolveGoogleKey(tenantId: string): Promise<string | undefined> {
    let googleKey = process.env.GOOGLE_API_KEY;

    // Attempt BYOK lookup
    try {
        const pool = getPool();
        const configRes = await pool.query(
            "SELECT * FROM bot_ai_config WHERE bot_id = (SELECT id FROM bots WHERE user_id = (SELECT id FROM users WHERE email = (SELECT email FROM tenants WHERE id = $1)) LIMIT 1)",
            [tenantId]
        );
        if (configRes.rows.length > 0) {
            const config = configRes.rows[0];
            if (config.provider === 'google' && config.encrypted_key) {
                const { decryptToken } = await import('./pool.js');
                googleKey = decryptToken(config.encrypted_key);
            }
        }
    } catch (_) {
        // No BYOK config — use platform key
    }

    return googleKey;
}

function buildToolContext(tenantId: string, tenant: any) {
    const workdir = path.join(process.cwd(), 'data', tenantId);
    fs.mkdirSync(workdir, { recursive: true });
    return {
        sessionKey: tenantId,
        agentId: tenantId,
        workdir,
        config: {
            TIGER_CLAW_TENANT_ID: tenantId,
            BOT_FLAVOR: tenant.flavor,
            REGION: tenant.region,
            PREFERRED_LANGUAGE: tenant.language,
            TIGER_CLAW_API_URL: process.env.TIGER_CLAW_API_URL ?? 'http://localhost:4000',
        },
        abortSignal: new AbortController().signal,
        logger: console,
        storage: {
            get: (key: string) => getBotState(tenantId, key),
            set: (key: string, value: any) => setBotState(tenantId, key, value)
        }
    };
}


export async function processTelegramMessage(tenantId: string, botToken: string, chatId: number, text: string) {
    const bot = new TelegramBot(botToken);
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error("Tenant not found");

    const googleKey = await resolveGoogleKey(tenantId);
    if (!googleKey) {
        await bot.sendMessage(chatId, "⚠️ No API key configured. Contact support to activate your Tiger Claw bot.");
        return;
    }

    try {
        await bot.sendChatAction(chatId, "typing");

        const history = await getChatHistory(tenantId, chatId);
        const toolContext = buildToolContext(tenantId, tenant);

        const genAI = new GoogleGenerativeAI(googleKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: `You are Tiger Claw, an elite AI assistant for ${tenant.flavor ?? 'network marketing'}. Your operator is ${tenant.name}. Use your tools to help manage prospects, leads, and follow-ups.`,
            tools: geminiTools as any,
        });

        const chat = model.startChat({ history });

        let result = await chat.sendMessage(text);
        let response = result.response;

        while ((response.functionCalls?.() ?? []).length > 0) {
            const calls = response.functionCalls()!;
            const functionResponses: Part[] = [];

            for (const fc of calls) {
                console.log(`[AI] Tool Executing: ${fc.name}`, fc.args);
                let toolResult: any;
                try {
                    // @ts-ignore
                    toolResult = await toolsMap[fc.name].execute(fc.args, toolContext);
                } catch (toolErr: any) {
                    console.error(`[AI] Tool ${fc.name} Failed:`, toolErr);
                    toolResult = { error: toolErr.message };
                }
                functionResponses.push({
                    functionResponse: { name: fc.name, response: toolResult }
                } as any);
            }

            result = await chat.sendMessage(functionResponses);
            response = result.response;
        }

        // Save updated history
        const updatedHistory = await chat.getHistory();
        await saveChatHistory(tenantId, chatId, updatedHistory);

        const replyText = response.text() ?? '';
        if (replyText.trim().length > 0) {
            await bot.sendMessage(chatId, replyText);
        }
    } catch (err: any) {
        console.error(`[AI] Error processing message for tenant ${tenantId}:`, err);
        await bot.sendMessage(chatId, `❌ AI Error: ${err.message}`);
    }
}

export async function processSystemRoutine(tenantId: string, routineType: string) {
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error("Tenant not found");

    const googleKey = await resolveGoogleKey(tenantId);
    if (!googleKey) {
        console.warn(`[AI Routine] No API key for tenant ${tenantId}. Aborting ${routineType}.`);
        return;
    }

    const systemChatId = 0;

    try {
        const history = await getChatHistory(tenantId, systemChatId);
        const toolContext = buildToolContext(tenantId, tenant);

        let systemPrompt: string;
        if (routineType === 'daily_scout') {
            systemPrompt = "SYSTEM: Run your Daily Scout routine. Find new leads to contact.";
        } else if (routineType === 'nurture_check') {
            systemPrompt = "SYSTEM: Run your Nurture Check. Review follow-ups and reach out if necessary.";
        } else {
            systemPrompt = `SYSTEM: Execute routine: ${routineType}`;
        }

        const genAI = new GoogleGenerativeAI(googleKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: `You are Tiger Claw, an elite AI assistant for ${tenant.flavor ?? 'network marketing'}. Your operator is ${tenant.name}. Execute background routines using your tools.`,
            tools: geminiTools as any,
        });

        const chat = model.startChat({ history });

        let result = await chat.sendMessage(systemPrompt);
        let response = result.response;

        while ((response.functionCalls?.() ?? []).length > 0) {
            const calls = response.functionCalls()!;
            const functionResponses: Part[] = [];

            for (const fc of calls) {
                console.log(`[AI Routine] Tool Executing: ${fc.name}`, fc.args);
                let toolResult: any;
                try {
                    // @ts-ignore
                    toolResult = await toolsMap[fc.name].execute(fc.args, toolContext);
                } catch (toolErr: any) {
                    console.error(`[AI Routine] Tool ${fc.name} Failed:`, toolErr);
                    toolResult = { error: toolErr.message };
                }
                functionResponses.push({
                    functionResponse: { name: fc.name, response: toolResult }
                } as any);
            }

            result = await chat.sendMessage(functionResponses);
            response = result.response;
        }

        const updatedHistory = await chat.getHistory();
        await saveChatHistory(tenantId, systemChatId, updatedHistory);

        console.log(`[AI Routine] Successfully evaluated ${routineType} for ${tenantId}.`);
    } catch (err: any) {
        console.error(`[AI Routine] Fatal error: ${routineType} for tenant ${tenantId}:`, err);
    }
}
