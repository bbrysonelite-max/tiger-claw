// Tiger Claw API — Multi-Tenant Provisioner Service
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.1 "60 seconds from payment to bot sending first message"
// RE-ARCHITECTED FOR MULTI-TENANCY: No container spinning. Just DB inserts and instant activation.

import {
  createTenant,
  getTenantBySlug,
  updateTenantStatus,
  logAdminEvent,
  listBotPool,
  assignBotToken,
  getPoolStats,
  getPool,
  getBotState,
  type Tenant,
} from "./db.js";
import { releaseBot, decryptToken } from "./pool.js";
import { sendAdminAlert } from "../routes/admin.js";

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
}

export interface ProvisionResult {
  success: boolean;
  waitlisted?: boolean;
  tenant?: Tenant;
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

  let resolvedBotToken = input.botToken;

  if (!resolvedBotToken) {
    const stats = await getPoolStats();
    if (stats.unassigned === 0) {
      // Pool empty — put tenant on waitlist, do NOT fail payment
      steps.push("Pool empty — tenant added to waitlist");

      let waitlistTenant: Tenant;
      try {
        waitlistTenant = await createTenant({
          slug: input.slug,
          name: input.name,
          email: input.email,
          flavor: input.flavor,
          region: input.region,
          language: input.language,
          preferredChannel: input.preferredChannel,
          botToken: undefined,
          port: undefined, // Port is deprecated in Multi-Tenancy
        });
        await updateTenantStatus(waitlistTenant.id, "pending");
      } catch (err) {
        return { success: false, error: `DB error: ${err instanceof Error ? err.message : String(err)}`, steps };
      }

      await sendAdminAlert("Bot token pool is empty. Add tokens via ops/botpool/create_bots.ts before provisioning.");
      await logAdminEvent("waitlist", waitlistTenant.id, { reason: "pool_empty", slug: input.slug });
      return {
        success: true,
        waitlisted: true,
        tenant: waitlistTenant,
        steps,
        error: undefined,
      };
    }
  } else {
    steps.push("Bot token provided directly (admin override)");
  }


  // 2. Create tenant record (status: pending)
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
      port: undefined, // Port deprecated
    });
    steps.push(`Tenant record created: ${tenant.id}`);
  } catch (err) {
    return { success: false, error: `DB error: ${err instanceof Error ? err.message : String(err)}`, steps };
  }

  // Assign bot token from pool 
  if (!input.botToken) {
    const assigned = await assignBotToken(tenant.id);
    if (!assigned) {
      await updateTenantStatus(tenant.id, "pending");
      await sendAdminAlert("Bot token pool is empty. Add tokens via ops/botpool/create_bots.ts before provisioning.");
      return { success: true, waitlisted: true, tenant, steps: [...steps, "Pool emptied during assignment — waitlisted"], error: undefined };
    }
    resolvedBotToken = decryptToken(assigned.botToken);

    // Update tenant record with the assigned bot token
    await getPool().query("UPDATE tenants SET bot_token = $1, updated_at = NOW() WHERE id = $2", [resolvedBotToken, tenant.id]);
    steps.push(`Bot assigned from pool: @${assigned.botUsername}`);

    // Low-pool alert
    const postStats = await getPoolStats();
    if (postStats.unassigned < 50) {
      await sendAdminAlert(`Bot token pool low: ${postStats.unassigned} tokens remaining. Add more via ops/botpool.`);
    }
  }

  // 3. Multi-Tenant Activation! No Docker containers to spin up. 
  // We simply register an active Webhook with Telegram for the newly assigned token bridging directly to this API cluster.

  try {
    const webhookUrl = `${process.env["TIGER_CLAW_API_URL"] ?? (() => { throw new Error("[FATAL] TIGER_CLAW_API_URL environment variable is required"); })()}/webhooks/telegram/${tenant.id}`;

    // Call Telegram API to set the webhook
    const tgResponse = await fetch(`https://api.telegram.org/bot${resolvedBotToken}/setWebhook?url=${webhookUrl}`);
    const tgData = await tgResponse.json();

    if (!tgData.ok) {
      throw new Error(`Telegram Webhook failed: ${tgData.description}`);
    }

    steps.push(`Telegram webhook attached to Master API router successfully.`);
  } catch (err) {
    await updateTenantStatus(tenant.id, "suspended", {
      suspendedReason: `Webhook attachment failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      success: false,
      error: `Webhook attach failed: ${err instanceof Error ? err.message : String(err)}`,
      steps,
      tenant,
    };
  }

  // 4. Status → onboarding (Bot is instantly LIVE and listening on the master router)
  await updateTenantStatus(tenant.id, "onboarding");
  steps.push("Status: onboarding");

  // Bot is live. Waiting for tenant to trigger it via Telegram.
  steps.push("Bot ready — awaiting tenant's first inbound message to start onboarding");

  await logAdminEvent("provision", tenant.id, {
    slug: input.slug,
    flavor: input.flavor,
    region: input.region,
  });

  return { success: true, tenant, steps };
}

// ---------------------------------------------------------------------------
// Suspend a tenant 
// ---------------------------------------------------------------------------

export async function suspendTenant(
  tenant: Tenant,
  reason = "Admin action"
): Promise<void> {
  // To suspend a multi-tenant bot, we just drop its webhook so it stops listening
  if (tenant.botToken) {
    await fetch(`https://api.telegram.org/bot${tenant.botToken}/deleteWebhook`);
  }
  await updateTenantStatus(tenant.id, "suspended", { suspendedReason: reason });
  await logAdminEvent("suspend", tenant.id, { reason });
}

// ---------------------------------------------------------------------------
// Resume a suspended tenant
// ---------------------------------------------------------------------------

export async function resumeTenant(tenant: Tenant): Promise<"active" | "onboarding"> {
  if (tenant.botToken) {
    const webhookUrl = `${process.env["TIGER_CLAW_API_URL"] ?? (() => { throw new Error("[FATAL] TIGER_CLAW_API_URL environment variable is required"); })()}/webhooks/telegram/${tenant.id}`;
    await fetch(`https://api.telegram.org/bot${tenant.botToken}/setWebhook?url=${webhookUrl}`);
  }
  // Determine correct status: check actual onboarding completion in bot_states.
  // onboardingKeyUsed is never incremented — use the onboarding phase state instead.
  let status: "active" | "onboarding" = "onboarding";
  try {
    const onboardState = await getBotState<{ phase?: string }>(tenant.id, "onboard_state.json");
    if (onboardState?.phase === "complete") {
      status = "active";
    }
  } catch {
    // Fall back to onboarding if state is unreadable
  }
  await updateTenantStatus(tenant.id, status);
  await logAdminEvent("resume", tenant.id, {});
  return status;
}

// ---------------------------------------------------------------------------
// Terminate a tenant 
// ---------------------------------------------------------------------------

export async function terminateTenant(tenant: Tenant): Promise<void> {
  if (tenant.botToken) {
    await fetch(`https://api.telegram.org/bot${tenant.botToken}/deleteWebhook`);
  }

  // Release the pool bot back so it can be reassigned to a future tenant
  try {
    const poolBots = await listBotPool("assigned");
    const assignedBot = poolBots.find((b) => b.tenantId === tenant.id);
    if (assignedBot) {
      await releaseBot(assignedBot.id);
    }
  } catch (err) {
    console.error(`[provisioner] terminateTenant: failed to release pool bot for ${tenant.id}:`, err);
  }

  await updateTenantStatus(tenant.id, "terminated");
  await logAdminEvent("terminate", tenant.id, {});
}

// ---------------------------------------------------------------------------
// Deprovision a tenant — full cleanup including bot recycling
// ---------------------------------------------------------------------------

export async function deprovisionTenant(tenant: Tenant): Promise<{ steps: string[] }> {
  const steps: string[] = [];

  if (tenant.botToken) {
    await fetch(`https://api.telegram.org/bot${tenant.botToken}/deleteWebhook`);
    steps.push("Telegram webhook deleted for Bot Token");
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
