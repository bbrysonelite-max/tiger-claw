// Tiger Claw API — Provisioner Service
// Implements the full 8-step payment → live bot pipeline
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.1 "60 seconds from payment to bot sending first message"
//
// Pipeline steps:
//  1. Create tenant record in PostgreSQL (status: pending)
//  2. Spin up Docker container with correct env vars
//  3. Health check: /health responds within 30s
//  4. Update status → onboarding
//  5. Bot sends first greeting message via Telegram
//  6. Onboarding interview begins (tiger_onboard skill inside container)
//
// For suspend/resume:
//   stopContainer  → update status: suspended
//   startContainer → update status: active (or onboarding if incomplete)

import TelegramBot from "node-telegram-bot-api";
import {
  createTenant,
  getTenantBySlug,
  updateTenantStatus,
  getNextAvailablePort,
  logAdminEvent,
  type Tenant,
} from "./db.js";
import {
  startContainer,
  stopContainer,
  startExistingContainer,
  removeContainer,
  getContainerHealth,
} from "./docker.js";

// ---------------------------------------------------------------------------
// Provision input
// ---------------------------------------------------------------------------

export interface ProvisionInput {
  slug: string;
  name: string;
  email?: string;
  flavor: string;
  region: string;
  language: string;
  preferredChannel: string;
  botToken?: string;
  timezone?: string;
  port?: number;          // if omitted, auto-assigned
  tenantId?: string;      // if omitted, generated
}

export interface ProvisionResult {
  success: boolean;
  tenant?: Tenant;
  port?: number;
  error?: string;
  steps: string[];
}

// ---------------------------------------------------------------------------
// Main provisioner
// ---------------------------------------------------------------------------

export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const steps: string[] = [];

  // 1. Guard: duplicate slug
  const existing = await getTenantBySlug(input.slug);
  if (existing) {
    return { success: false, error: `Slug '${input.slug}' already in use.`, steps };
  }

  // 2. Auto-assign port if not provided
  const port = input.port ?? await getNextAvailablePort();
  steps.push(`Port assigned: ${port}`);

  // 3. Create tenant record (status: pending)
  let tenant: Tenant;
  try {
    tenant = await createTenant({
      slug: input.slug,
      name: input.name,
      email: input.email,
      flavor: input.flavor,
      region: input.region,
      language: input.language,
      preferredChannel: input.preferredChannel,
      botToken: input.botToken,
      port,
    });
    steps.push(`Tenant record created: ${tenant.id}`);
  } catch (err) {
    return { success: false, error: `DB error: ${err instanceof Error ? err.message : String(err)}`, steps };
  }

  // 4. Start Docker container
  try {
    const containerId = await startContainer({
      slug: input.slug,
      tenantId: tenant.id,
      name: input.name,
      port,
      language: input.language,
      flavor: input.flavor,
      region: input.region,
      botToken: input.botToken,
      timezone: input.timezone,
      platformOnboardingKey: process.env["PLATFORM_ONBOARDING_KEY"],
      tigerClawApiUrl: process.env["TIGER_CLAW_API_URL"] ?? `http://host.docker.internal:4000`,
      databaseUrl: process.env["DATABASE_URL"],
      redisUrl: process.env["REDIS_URL"],
      encryptionKey: process.env["ENCRYPTION_KEY"],
    });
    await updateTenantStatus(tenant.id, "pending", { containerId });
    steps.push(`Container started: ${containerId.slice(0, 12)}`);
  } catch (err) {
    await updateTenantStatus(tenant.id, "suspended", {
      suspendedReason: `Container start failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      success: false,
      error: `Docker start failed: ${err instanceof Error ? err.message : String(err)}`,
      steps,
      tenant,
    };
  }

  // 5. Health check: wait up to 30 seconds for container to respond
  const healthy = await waitForHealth(input.slug, port, 30);
  if (!healthy) {
    await updateTenantStatus(tenant.id, "suspended", {
      suspendedReason: "Health check timed out (30s)",
    });
    return {
      success: false,
      error: "Container did not respond to health check within 30 seconds.",
      steps: [...steps, "Health check FAILED (30s timeout)"],
      tenant,
    };
  }
  steps.push("Health check PASSED");

  // 6. Status → onboarding
  await updateTenantStatus(tenant.id, "onboarding");
  steps.push("Status: onboarding");

  // 7. Send greeting via tenant's Telegram bot (if token available)
  if (input.botToken && input.preferredChannel === "telegram") {
    try {
      await sendOnboardingGreeting(input.botToken, input.name, input.language);
      steps.push("Greeting message sent via Telegram");
    } catch (err) {
      // Non-fatal — bot may not have a chat to send to yet at this point
      steps.push(`Greeting skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await logAdminEvent("provision", tenant.id, {
    slug: input.slug,
    port,
    flavor: input.flavor,
    region: input.region,
  });

  return { success: true, tenant, port, steps };
}

// ---------------------------------------------------------------------------
// Suspend a tenant (stop container, update DB)
// ---------------------------------------------------------------------------

export async function suspendTenant(
  tenant: Tenant,
  reason = "Admin action"
): Promise<void> {
  await stopContainer(tenant.slug);
  await updateTenantStatus(tenant.id, "suspended", { suspendedReason: reason });
  await logAdminEvent("suspend", tenant.id, { reason });
}

// ---------------------------------------------------------------------------
// Resume a suspended tenant
// ---------------------------------------------------------------------------

export async function resumeTenant(tenant: Tenant): Promise<void> {
  await startExistingContainer(tenant.slug);
  // Restore to last meaningful status before suspension
  const status = tenant.onboardingKeyUsed > 0 ? "active" : "onboarding";
  await updateTenantStatus(tenant.id, status);
  await logAdminEvent("resume", tenant.id, {});
}

// ---------------------------------------------------------------------------
// Terminate a tenant (remove container + update DB)
// ---------------------------------------------------------------------------

export async function terminateTenant(tenant: Tenant): Promise<void> {
  try {
    await stopContainer(tenant.slug);
    await removeContainer(tenant.slug, true);
  } catch {
    // Best-effort
  }
  await updateTenantStatus(tenant.id, "terminated");
  await logAdminEvent("terminate", tenant.id, {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForHealth(slug: string, port: number, timeoutSeconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const h = await getContainerHealth(slug, port);
    if (h.httpReachable) return true;
    await sleep(2000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendOnboardingGreeting(
  botToken: string,
  tenantName: string,
  _language: string
): Promise<void> {
  // The bot can only message a chat it has already seen. For a brand-new
  // bot token, there may be no chat yet. This is a best-effort send; the
  // onboarding flow via tiger_onboard will drive conversation from there.
  //
  // In practice, the tenant has just paid on Stan Store / Stripe checkout,
  // so they are instructed to start the bot before payment completes, which
  // creates the initial chat session. We send to a placeholder update queue
  // via getUpdates to find the first chat_id.

  const bot = new TelegramBot(botToken);
  try {
    const updates = await bot.getUpdates({ limit: 1, timeout: 2 });
    const chatId = updates[0]?.message?.chat?.id;
    if (chatId) {
      const greeting =
        `Hi ${tenantName}! I'm your Tiger Claw agent. I'm ready to get you set up. ` +
        `Just say "hi" or "start" to begin your onboarding interview.`;
      await bot.sendMessage(chatId, greeting);
    }
  } catch {
    // Non-fatal — tenant will initiate the conversation themselves
  }
}
