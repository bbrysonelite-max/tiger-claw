import { Anthropic } from '@anthropic-ai/sdk';
import { getTenant, getPool } from './db.js';
import TelegramBot from 'node-telegram-bot-api';
import IORedis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

// Load OpenClaw Tools
import { tiger_onboard } from '../tools/tiger_onboard.js';
import { tiger_scout } from '../tools/tiger_scout.js';
import { tiger_contact } from '../tools/tiger_contact.js';

// Convert Legacy OpenClaw Tools to Anthropic Tool Schema
const toolsMap = {
    "tiger_onboard": tiger_onboard,
    "tiger_scout": tiger_scout,
    "tiger_contact": tiger_contact
};

const anthropicTools = Object.values(toolsMap).map((tool: any) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
}));

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

async function getChatHistory(tenantId: string, chatId: number): Promise<Anthropic.MessageParam[]> {
    const raw = await redis.get(`chat_history:${tenantId}:${chatId}`);
    return raw ? JSON.parse(raw) : [];
}

async function saveChatHistory(tenantId: string, chatId: number, history: Anthropic.MessageParam[]): Promise<void> {
    await redis.set(`chat_history:${tenantId}:${chatId}`, JSON.stringify(history), 'EX', 86400 * 7);
}

export async function processTelegramMessage(tenantId: string, botToken: string, chatId: number, text: string) {
    // Note: Since OpenClaw container daemon was replaced by Serverless Multi-Tenancy,
    // this function is the new 'Stateless AI Gateway'.

    const bot = new TelegramBot(botToken);
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error("Tenant not found");

    // Fetch tenant AI configuration from the database (BYOK connection)
    const pool = getPool();
    const configRes = await pool.query("SELECT * FROM ai_configs WHERE bot_id = (SELECT id FROM bots WHERE tenant_id = $1 LIMIT 1)", [tenantId]);

    // Default to the central API key if no BYOK
    let anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (configRes.rows.length > 0) {
        const config = configRes.rows[0];
        if (config.provider === 'anthropic' && config.encrypted_key) {
            // Note: Use crypto decryption in production. We assume decryptToken works here.
            const { decryptToken } = await import('./pool.js');
            anthropicKey = decryptToken(config.encrypted_key);
        }
    }

    if (!anthropicKey) {
        await bot.sendMessage(chatId, "⚠️ No API key found. Please provide your BYOK to activate your Tiger Claw bot.");
        return;
    }

    // Spin up Stateless Context
    const anthropic = new Anthropic({
        apiKey: anthropicKey,
    });

    try {
        await bot.sendChatAction(chatId, "typing");

        // Maintain conversation history in memory for this stateless execution
        let history = await getChatHistory(tenantId, chatId);
        history.push({ role: "user", content: text });

        // Build the mock context expected by native OpenClaw tools
        const workdir = path.join(process.cwd(), 'data', tenantId);
        fs.mkdirSync(workdir, { recursive: true });

        const toolContext = {
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
            logger: console
        };

        let response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: `You are Tiger Claw, an elite AI assistant for network marketing. Your tenant name is ${tenant.name}. You are currently running on a fully Serverless Multi-Tenant architecture. Use your tools to execute commands and interact with the user or prospect.`,
            messages: history,
            tools: anthropicTools as any
        });

        // -------------------------------------------------------------
        // Tool Execution Loop
        // -------------------------------------------------------------
        while (response.stop_reason === "tool_use") {
            // Push Assistant's tool use request to history
            history.push({ role: "assistant", content: response.content });

            const toolCallBlock = response.content.find((b: any) => b.type === "tool_use");
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            if (toolCallBlock && toolCallBlock.type === "tool_use") {
                const toolName = toolCallBlock.name;
                const toolInput = toolCallBlock.input;

                console.log(`[AI] Tool Executing: ${toolName}`, toolInput);
                let toolExecResult;

                try {
                    // Execute the native legacy tool locally within the handler
                    // @ts-ignore
                    const legacyExecData = await toolsMap[toolName].execute(toolInput, toolContext);
                    toolExecResult = JSON.stringify(legacyExecData);
                } catch (toolErr: any) {
                    console.error(`[AI] Tool ${toolName} Failed:`, toolErr);
                    toolExecResult = JSON.stringify({ error: toolErr.message });
                }

                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolCallBlock.id,
                    content: toolExecResult
                });
            }

            // Push tool execution result to history
            history.push({ role: "user", content: toolResults });

            // Generate Next Response
            response = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1024,
                system: `You are Tiger Claw, an elite AI assistant for network marketing.`,
                messages: history,
                tools: anthropicTools as any
            });
        }

        // -------------------------------------------------------------
        // Final Output To User
        // -------------------------------------------------------------

        history.push({ role: "assistant", content: response.content });
        await saveChatHistory(tenantId, chatId, history);

        const replyBlock = response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
        const replyText = replyBlock?.text ?? "Done.";

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

    const pool = getPool();
    const configRes = await pool.query("SELECT * FROM ai_configs WHERE bot_id = (SELECT id FROM bots WHERE tenant_id = $1 LIMIT 1)", [tenantId]);
    let anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (configRes.rows.length > 0) {
        const config = configRes.rows[0];
        if (config.provider === 'anthropic' && config.encrypted_key) {
            const { decryptToken } = await import('./pool.js');
            anthropicKey = decryptToken(config.encrypted_key);
        }
    }

    if (!anthropicKey) {
        console.warn(`[AI Routine] No API key found for tenant ${tenantId}. Aborting ${routineType}.`);
        return;
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // We use a dedicated system 'chatId' for background thoughts (e.g. 0)
    const systemChatId = 0;

    try {
        let history = await getChatHistory(tenantId, systemChatId);

        let systemPrompt = "";
        if (routineType === 'daily_scout') {
            systemPrompt = "SYSTEM: It is time to run your Daily Scout routine. Find new leads to contact.";
        } else if (routineType === 'nurture_check') {
            systemPrompt = "SYSTEM: It is time to run your Nurture Check routine. Review follow-ups and reach out if necessary.";
        } else {
            systemPrompt = `SYSTEM: Execute routine: ${routineType}`;
        }

        history.push({ role: "user", content: systemPrompt });

        const workdir = path.join(process.cwd(), 'data', tenantId);
        fs.mkdirSync(workdir, { recursive: true });

        const toolContext = {
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
            logger: console
        };

        let response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1024,
            system: `You are Tiger Claw, an elite AI assistant for network marketing. Your tenant name is ${tenant.name}. You are currently running on a fully Serverless Multi-Tenant architecture. Use your tools to execute background commands.`,
            messages: history,
            tools: anthropicTools as any
        });

        while (response.stop_reason === "tool_use") {
            history.push({ role: "assistant", content: response.content });

            const toolCallBlock = response.content.find((b: any) => b.type === "tool_use");
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            if (toolCallBlock && toolCallBlock.type === "tool_use") {
                const toolName = toolCallBlock.name;
                const toolInput = toolCallBlock.input;
                console.log(`[AI Routine] Tool Executing: ${toolName}`, toolInput);
                let toolExecResult;

                try {
                    // @ts-ignore
                    const legacyExecData = await toolsMap[toolName].execute(toolInput, toolContext);
                    toolExecResult = JSON.stringify(legacyExecData);
                } catch (toolErr: any) {
                    console.error(`[AI Routine] Tool ${toolName} Failed:`, toolErr);
                    toolExecResult = JSON.stringify({ error: toolErr.message });
                }

                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolCallBlock.id,
                    content: toolExecResult
                });
            }

            history.push({ role: "user", content: toolResults });

            response = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1024,
                system: `You are Tiger Claw, an elite AI assistant for network marketing.`,
                messages: history,
                tools: anthropicTools as any
            });
        }

        history.push({ role: "assistant", content: response.content });
        await saveChatHistory(tenantId, systemChatId, history);

        console.log(`[AI Routine] Successfully evaluated ${routineType} for ${tenantId}.`);
    } catch (err: any) {
        console.error(`[AI Routine] Fatal error processing ${routineType} for tenant ${tenantId}:`, err);
    }
}
