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

import {
  createTenant,
  getTenantBySlug,
  updateTenantStatus,
  getNextAvailablePort,
  logAdminEvent,
  listBotPool,
  type Tenant,
} from "./db.js";
import {
  startContainer,
  stopContainer,
  startExistingContainer,
  removeContainer,
  getContainerHealth,
} from "./docker.js";
import { getNextAvailable, assignToTenant, releaseBot } from "./pool.js";

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
  // botToken is no longer required from Stripe metadata — sourced from pool.
  // Admin manual provisioning can still pass one explicitly to bypass pool.
  botToken?: string;
  timezone?: string;
  port?: number;          // if omitted, auto-assigned
  tenantId?: string;      // if omitted, generated
}

export interface ProvisionResult {
  success: boolean;
  waitlisted?: boolean;   // true when pool was empty — tenant queued, not failed
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

  // 2. Resolve bot token: explicit override → pool → waitlist
  // Bot assigned at payment time, NEVER at onboarding (Block 5.3 Decision 3)
  let resolvedBotToken = input.botToken;
  let assignedBotId: string | undefined;

  if (!resolvedBotToken) {
    const poolBot = await getNextAvailable();
    if (!poolBot) {
      // Pool empty — put tenant on waitlist, do NOT fail payment
      // Block 5.3 Decision 7: Pool empty = waitlist mode, not failed payment
      steps.push("Pool empty — tenant added to waitlist");

      // Create a minimal tenant record in waitlist status
      let waitlistTenant: Tenant;
      try {
        const wPort = input.port ?? await getNextAvailablePort();
        waitlistTenant = await createTenant({
          slug: input.slug,
          name: input.name,
          email: input.email,
          flavor: input.flavor,
          region: input.region,
          language: input.language,
          preferredChannel: input.preferredChannel,
          botToken: undefined,
          port: wPort,
        });
        await updateTenantStatus(waitlistTenant.id, "pending");
      } catch (err) {
        return { success: false, error: `DB error: ${err instanceof Error ? err.message : String(err)}`, steps };
      }

      await logAdminEvent("waitlist", waitlistTenant.id, { reason: "pool_empty", slug: input.slug });
      return {
        success: true,
        waitlisted: true,
        tenant: waitlistTenant,
        steps,
        error: undefined,
      };
    }

    // Decrypt pool bot token for container use
    const { decryptToken } = await import("./pool.js");
    resolvedBotToken = decryptToken(poolBot.botToken);
    assignedBotId = poolBot.id;
    steps.push(`Bot assigned from pool: @${poolBot.botUsername}`);
  } else {
    steps.push("Bot token provided directly (admin override)");
  }

  // 3. Auto-assign port if not provided
  const port = input.port ?? await getNextAvailablePort();
  steps.push(`Port assigned: ${port}`);

  // 4. Create tenant record (status: pending)
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
      botToken: resolvedBotToken,
      port,
    });
    steps.push(`Tenant record created: ${tenant.id}`);
  } catch (err) {
    return { success: false, error: `DB error: ${err instanceof Error ? err.message : String(err)}`, steps };
  }

  // Mark the pool bot as assigned (after tenant record exists for FK)
  if (assignedBotId) {
    await assignToTenant(assignedBotId, tenant.id);
    steps.push(`Pool bot marked assigned (pool_id: ${assignedBotId})`);
  }

  // 5. Start Docker container
  try {
    const containerId = await startContainer({
      slug: input.slug,
      tenantId: tenant.id,
      name: input.name,
      port,
      language: input.language,
      flavor: input.flavor,
      region: input.region,
      botToken: resolvedBotToken,
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

  // 6. Health check: wait up to 30 seconds for container to respond
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

  // 7. Status → onboarding
  await updateTenantStatus(tenant.id, "onboarding");
  steps.push("Status: onboarding");

  // 7. Bot is live. tiger_onboard.ts will send the first greeting when the
  //    tenant's first inbound message arrives — no proactive send here because
  //    a brand-new bot has no chat_id until the tenant initiates contact.
  steps.push("Bot ready — awaiting tenant's first inbound message to start onboarding");

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
// Deprovision a tenant — full cleanup including bot recycling
// Called after 30-day retention period per Block 5.3 Decision 8.
// Steps:
//   1. Stop and remove Docker container
//   2. Find the assigned pool bot for this tenant and release it
//   3. Release resets bot identity via Telegram API and returns it to available pool
//   4. Log the recycling event
// ---------------------------------------------------------------------------

export async function deprovisionTenant(tenant: Tenant): Promise<{ steps: string[] }> {
  const steps: string[] = [];

  // 1. Stop and remove container
  try {
    await stopContainer(tenant.slug);
    steps.push("Container stopped");
    await removeContainer(tenant.slug, true);
    steps.push("Container removed");
  } catch (err) {
    steps.push(`Container cleanup warning: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Find assigned pool bot for this tenant and release it
  try {
    const poolBots = await listBotPool("assigned");
    const assignedBot = poolBots.find((b) => b.tenantId === tenant.id);
    if (assignedBot) {
      await releaseBot(assignedBot.id);
      steps.push(`Pool bot @${assignedBot.botUsername} released and reset`);
    } else {
      steps.push("No pool bot found for tenant (may have been manually assigned)");
    }
  } catch (err) {
    steps.push(`Bot release warning: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Update status
  await updateTenantStatus(tenant.id, "terminated");
  steps.push("Tenant status: terminated");

  await logAdminEvent("deprovision", tenant.id, { slug: tenant.slug, steps });
  return { steps };
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

