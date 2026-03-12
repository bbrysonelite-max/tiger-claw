// Tiger Claw — provisioner.ts unit tests
// Covers tenant lifecycle: provision, suspend, resume, terminate, deprovision

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mock factories ─────────────────────────────────────────────────────

const mockGetTenantBySlug = vi.hoisted(() => vi.fn());
const mockGetPoolStats = vi.hoisted(() => vi.fn());
const mockCreateTenant = vi.hoisted(() => vi.fn());
const mockUpdateTenantStatus = vi.hoisted(() => vi.fn());
const mockLogAdminEvent = vi.hoisted(() => vi.fn());
const mockListBotPool = vi.hoisted(() => vi.fn());
const mockAssignBotToken = vi.hoisted(() => vi.fn());
const mockGetPoolQuery = vi.hoisted(() => vi.fn());
const mockDecryptToken = vi.hoisted(() => vi.fn((s: string) => `plaintext-${s}`));
const mockReleaseBot = vi.hoisted(() => vi.fn());
const mockSendAdminAlert = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockGetBotState = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  getTenantBySlug: mockGetTenantBySlug,
  getPoolStats: mockGetPoolStats,
  createTenant: mockCreateTenant,
  updateTenantStatus: mockUpdateTenantStatus,
  logAdminEvent: mockLogAdminEvent,
  listBotPool: mockListBotPool,
  assignBotToken: mockAssignBotToken,
  getBotState: mockGetBotState,
  getPool: vi.fn(() => ({ query: mockGetPoolQuery })),
}));

vi.mock('../pool.js', () => ({
  getNextAvailable: vi.fn(),
  assignToTenant: vi.fn(),
  releaseBot: mockReleaseBot,
  decryptToken: mockDecryptToken,
}));

vi.mock('../../routes/admin.js', () => ({
  sendAdminAlert: mockSendAdminAlert,
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import {
  provisionTenant,
  suspendTenant,
  resumeTenant,
  terminateTenant,
  deprovisionTenant,
} from '../provisioner.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_INPUT = {
  slug: 'test-tenant',
  name: 'Test Tenant',
  email: 'test@example.com',
  flavor: 'network-marketer',
  region: 'us-en',
  language: 'en',
  preferredChannel: 'telegram',
};

const MOCK_TENANT = {
  id: 'tenant-uuid-1234',
  slug: 'test-tenant',
  name: 'Test Tenant',
  email: 'test@example.com',
  status: 'onboarding',
  flavor: 'network-marketer',
  region: 'us-en',
  language: 'en',
  preferredChannel: 'telegram',
  botToken: 'bot-token-123',
  onboardingKeyUsed: 0,
  canaryGroup: false,
  whatsappEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── provisionTenant ──────────────────────────────────────────────────────────

describe('provisionTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing tenant with this slug
    mockGetTenantBySlug.mockResolvedValue(null);
    // Default: pool has tokens
    mockGetPoolStats.mockResolvedValue({ total: 31, assigned: 5, unassigned: 26 });
    // Default: tenant created successfully
    mockCreateTenant.mockResolvedValue(MOCK_TENANT);
    // Default: bot token assigned successfully
    mockAssignBotToken.mockResolvedValue({ botToken: 'enc:bot-token', botUsername: 'TestBot' });
    // Default: pool stats after assignment (still above 50)
    mockGetPoolQuery.mockResolvedValue({ rows: [] });
    // Default: Telegram webhook call succeeds
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  it('returns error when slug is already in use', async () => {
    mockGetTenantBySlug.mockResolvedValue(MOCK_TENANT);

    const result = await provisionTenant(BASE_INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain("already in use");
    expect(result.error).toContain(BASE_INPUT.slug);
  });

  it('waitlists tenant when bot pool is empty (success=true, waitlisted=true)', async () => {
    mockGetPoolStats.mockResolvedValue({ total: 0, assigned: 0, unassigned: 0 });

    const result = await provisionTenant(BASE_INPUT);

    expect(result.success).toBe(true);
    expect(result.waitlisted).toBe(true);
    expect(result.tenant).toBeDefined();
    expect(mockSendAdminAlert).toHaveBeenCalledWith(expect.stringContaining('pool is empty'));
    expect(mockLogAdminEvent).toHaveBeenCalledWith('waitlist', expect.any(String), expect.objectContaining({ reason: 'pool_empty' }));
  });

  it('succeeds with direct botToken (admin override — skips pool)', async () => {
    const result = await provisionTenant({
      ...BASE_INPUT,
      botToken: 'admin-provided-token-123',
    });

    expect(result.success).toBe(true);
    expect(result.waitlisted).toBeFalsy();
    expect(mockAssignBotToken).not.toHaveBeenCalled();
    expect(result.steps).toContain('Bot token provided directly (admin override)');
  });

  it('sets Telegram webhook and moves status to onboarding on success', async () => {
    const result = await provisionTenant({ ...BASE_INPUT, botToken: 'direct-token' });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('setWebhook'));
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'onboarding');
    expect(result.steps.some((s) => s.includes('onboarding'))).toBe(true);
    expect(mockLogAdminEvent).toHaveBeenCalledWith('provision', MOCK_TENANT.id, expect.any(Object));
  });

  it('suspends tenant and returns error when Telegram webhook fails', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: 'Bad webhook url' }),
    });

    const result = await provisionTenant({ ...BASE_INPUT, botToken: 'direct-token' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Webhook attach failed');
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(
      MOCK_TENANT.id,
      'suspended',
      expect.objectContaining({ suspendedReason: expect.stringContaining('Webhook') }),
    );
  });

  it('returns DB error when createTenant throws', async () => {
    mockCreateTenant.mockRejectedValue(new Error('unique constraint violated'));

    const result = await provisionTenant({ ...BASE_INPUT, botToken: 'direct-token' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB error');
    expect(result.error).toContain('unique constraint violated');
  });

  it('waitlists when pool runs out during assignment (race condition)', async () => {
    mockAssignBotToken.mockResolvedValue(null); // pool emptied between check and assign

    const result = await provisionTenant(BASE_INPUT);

    expect(result.success).toBe(true);
    expect(result.waitlisted).toBe(true);
    expect(mockSendAdminAlert).toHaveBeenCalled();
  });
});

// ─── suspendTenant ────────────────────────────────────────────────────────────

describe('suspendTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    mockUpdateTenantStatus.mockResolvedValue(undefined);
    mockLogAdminEvent.mockResolvedValue(undefined);
  });

  it('calls deleteWebhook on Telegram when tenant has a botToken', async () => {
    await suspendTenant(MOCK_TENANT as any, 'Test suspension');

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('deleteWebhook'));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining(MOCK_TENANT.botToken!));
  });

  it('skips Telegram call when tenant has no botToken', async () => {
    const tenantNoToken = { ...MOCK_TENANT, botToken: undefined };
    await suspendTenant(tenantNoToken as any, 'No bot');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('updates status to suspended with the provided reason', async () => {
    const reason = 'Payment failed';
    await suspendTenant(MOCK_TENANT as any, reason);

    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'suspended', { suspendedReason: reason });
  });

  it('logs a suspend admin event', async () => {
    await suspendTenant(MOCK_TENANT as any, 'Admin action');

    expect(mockLogAdminEvent).toHaveBeenCalledWith('suspend', MOCK_TENANT.id, expect.any(Object));
  });
});

// ─── resumeTenant ─────────────────────────────────────────────────────────────

describe('resumeTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    mockUpdateTenantStatus.mockResolvedValue(undefined);
    mockLogAdminEvent.mockResolvedValue(undefined);
    mockGetBotState.mockResolvedValue(null); // default: no onboarding state
  });

  it('re-registers Telegram webhook on resume', async () => {
    await resumeTenant(MOCK_TENANT as any);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('setWebhook'));
  });

  it('restores to onboarding when onboarding phase is not complete', async () => {
    mockGetBotState.mockResolvedValue({ phase: 'icp_builder' });
    const result = await resumeTenant(MOCK_TENANT as any);

    expect(result).toBe('onboarding');
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'onboarding');
  });

  it('restores to onboarding when no onboarding state exists', async () => {
    mockGetBotState.mockResolvedValue(null);
    const result = await resumeTenant(MOCK_TENANT as any);

    expect(result).toBe('onboarding');
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'onboarding');
  });

  it('restores to active when onboarding phase is complete', async () => {
    mockGetBotState.mockResolvedValue({ phase: 'complete' });
    const result = await resumeTenant(MOCK_TENANT as any);

    expect(result).toBe('active');
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'active');
  });

  it('falls back to onboarding if getBotState throws', async () => {
    mockGetBotState.mockRejectedValue(new Error('DB error'));
    const result = await resumeTenant(MOCK_TENANT as any);

    expect(result).toBe('onboarding');
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'onboarding');
  });

  it('logs a resume admin event', async () => {
    await resumeTenant(MOCK_TENANT as any);

    expect(mockLogAdminEvent).toHaveBeenCalledWith('resume', MOCK_TENANT.id, {});
  });
});

// ─── terminateTenant ──────────────────────────────────────────────────────────

describe('terminateTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    mockUpdateTenantStatus.mockResolvedValue(undefined);
    mockLogAdminEvent.mockResolvedValue(undefined);
  });

  it('calls deleteWebhook then sets status to terminated', async () => {
    await terminateTenant(MOCK_TENANT as any);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('deleteWebhook'));
    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'terminated');
  });

  it('logs a terminate admin event', async () => {
    await terminateTenant(MOCK_TENANT as any);

    expect(mockLogAdminEvent).toHaveBeenCalledWith('terminate', MOCK_TENANT.id, {});
  });
});

// ─── deprovisionTenant ────────────────────────────────────────────────────────

describe('deprovisionTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ ok: true }) });
    mockUpdateTenantStatus.mockResolvedValue(undefined);
    mockLogAdminEvent.mockResolvedValue(undefined);
    mockReleaseBot.mockResolvedValue(undefined);
  });

  it('finds the assigned pool bot and releases it', async () => {
    const poolBot = { id: 'pool-bot-id', botUsername: 'PoolBot', tenantId: MOCK_TENANT.id };
    mockListBotPool.mockResolvedValue([poolBot]);

    const result = await deprovisionTenant(MOCK_TENANT as any);

    expect(mockReleaseBot).toHaveBeenCalledWith('pool-bot-id');
    expect(result.steps.some((s) => s.includes('@PoolBot'))).toBe(true);
  });

  it('records step when no pool bot is found for tenant', async () => {
    mockListBotPool.mockResolvedValue([]); // no assigned bots

    const result = await deprovisionTenant(MOCK_TENANT as any);

    expect(mockReleaseBot).not.toHaveBeenCalled();
    expect(result.steps.some((s) => s.includes('No pool bot found'))).toBe(true);
  });

  it('sets tenant status to terminated', async () => {
    mockListBotPool.mockResolvedValue([]);

    await deprovisionTenant(MOCK_TENANT as any);

    expect(mockUpdateTenantStatus).toHaveBeenCalledWith(MOCK_TENANT.id, 'terminated');
  });

  it('deletes Telegram webhook before termination', async () => {
    mockListBotPool.mockResolvedValue([]);

    await deprovisionTenant(MOCK_TENANT as any);

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('deleteWebhook'));
  });
});
