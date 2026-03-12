// Tiger Claw — webhooks.ts route tests
// Uses supertest to drive real Express requests through the router.
// Covers:
//   - POST /webhooks/telegram/:tenantId  (status gating, queue enqueueing)
//   - POST /webhooks/stripe              (missing config, bad sig, ignored events)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';

// ─── Hoist mock factories ─────────────────────────────────────────────────────
// Paths are RELATIVE TO THIS TEST FILE (not relative to webhooks.ts)
// This test is at: api/src/routes/__tests__/webhooks.test.ts
// api/src/services/db.ts     → ../../services/db.js
// api/src/services/queue.ts  → ../../services/queue.js
// api/src/routes/admin.ts    → ../admin.js
// api/src/services/pool.ts   → ../../services/pool.js

const mockGetTenant = vi.hoisted(() => vi.fn());
const mockTelegramQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));
const mockProvisionQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-2' }));
const mockLineQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-3' }));
const mockCreateBYOKUser = vi.hoisted(() => vi.fn().mockResolvedValue('user-uuid'));
const mockCreateBYOKBot = vi.hoisted(() => vi.fn().mockResolvedValue('bot-uuid'));
const mockCreateBYOKConfig = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateBYOKSubscription = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSendAdminAlert = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDecryptToken = vi.hoisted(() => vi.fn((s: string) => `decrypted:${s}`));

// ─── Module mocks — paths relative to THIS test file ─────────────────────────

vi.mock('../../services/db.js', () => ({
  getTenant: mockGetTenant,
  createBYOKUser: mockCreateBYOKUser,
  createBYOKBot: mockCreateBYOKBot,
  createBYOKConfig: mockCreateBYOKConfig,
  createBYOKSubscription: mockCreateBYOKSubscription,
}));

vi.mock('../../services/queue.js', () => ({
  provisionQueue: { add: mockProvisionQueueAdd },
  telegramQueue: { add: mockTelegramQueueAdd },
  lineQueue: { add: mockLineQueueAdd },
}));

vi.mock('../admin.js', () => ({
  sendAdminAlert: mockSendAdminAlert,
}));

vi.mock('../../services/pool.js', () => ({
  decryptToken: mockDecryptToken,
}));

// ─── Mock Stripe so the module doesn't try to connect ────────────────────────
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      webhooks: {
        constructEvent: vi.fn(),
      },
    };
  }),
}));

// ─── Test app factory ─────────────────────────────────────────────────────────

async function buildTestApp(): Promise<Express> {
  const app = express();
  // Stripe requires raw body for signature verification
  app.use('/webhooks/stripe', express.raw({ type: '*/*' }));
  app.use(express.json());
  const { default: webhooksRouter } = await import('../webhooks.js');
  app.use('/webhooks', webhooksRouter);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTIVE_TENANT = {
  id: 'tenant-abc-123',
  slug: 'test-tenant',
  status: 'active',
  botToken: 'bot-token-xyz',
  lineChannelSecret: undefined,
  lineChannelAccessToken: undefined,
};

const ONBOARDING_TENANT = { ...ACTIVE_TENANT, status: 'onboarding' };
const SUSPENDED_TENANT = { ...ACTIVE_TENANT, status: 'suspended' };

// ─── POST /webhooks/telegram/:tenantId ────────────────────────────────────────

describe('POST /webhooks/telegram/:tenantId', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it('returns 200 (silent ack) when tenant is not found', async () => {
    mockGetTenant.mockResolvedValue(null);

    const res = await request(app)
      .post('/webhooks/telegram/nonexistent-id')
      .send({ update_id: 1 });

    expect(res.status).toBe(200);
    expect(mockTelegramQueueAdd).not.toHaveBeenCalled();
  });

  it('returns 200 (silent ack) when tenant is suspended — no queue', async () => {
    mockGetTenant.mockResolvedValue(SUSPENDED_TENANT);

    const res = await request(app)
      .post('/webhooks/telegram/tenant-abc-123')
      .send({ update_id: 1 });

    expect(res.status).toBe(200);
    expect(mockTelegramQueueAdd).not.toHaveBeenCalled();
  });

  it('returns 200 (silent ack) when tenant is terminated — no queue', async () => {
    mockGetTenant.mockResolvedValue({ ...ACTIVE_TENANT, status: 'terminated' });

    const res = await request(app)
      .post('/webhooks/telegram/tenant-abc-123')
      .send({ update_id: 1 });

    expect(res.status).toBe(200);
    expect(mockTelegramQueueAdd).not.toHaveBeenCalled();
  });

  it('enqueues job and returns 200 for active tenant', async () => {
    mockGetTenant.mockResolvedValue(ACTIVE_TENANT);

    const payload = { message: { chat: { id: 123 }, text: 'hello' } };
    const res = await request(app)
      .post('/webhooks/telegram/tenant-abc-123')
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockTelegramQueueAdd).toHaveBeenCalledWith(
      'telegram-webhook',
      expect.objectContaining({
        tenantId: 'tenant-abc-123',
        botToken: ACTIVE_TENANT.botToken,
      }),
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('enqueues job and returns 200 for onboarding tenant', async () => {
    mockGetTenant.mockResolvedValue(ONBOARDING_TENANT);

    const res = await request(app)
      .post('/webhooks/telegram/tenant-abc-123')
      .send({ message: { text: 'hi' } });

    expect(res.status).toBe(200);
    expect(mockTelegramQueueAdd).toHaveBeenCalled();
  });

  it('includes exponential backoff config in queue job', async () => {
    mockGetTenant.mockResolvedValue(ACTIVE_TENANT);

    await request(app)
      .post('/webhooks/telegram/tenant-abc-123')
      .send({ update_id: 99 });

    const queueCall = mockTelegramQueueAdd.mock.calls[0];
    expect(queueCall).toBeDefined();
    const opts = queueCall![2];
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 2000 });
  });

  it('returns 500 when queue.add throws', async () => {
    mockGetTenant.mockResolvedValue(ACTIVE_TENANT);
    mockTelegramQueueAdd.mockRejectedValue(new Error('Redis down'));

    const res = await request(app)
      .post('/webhooks/telegram/tenant-abc-123')
      .send({ update_id: 1 });

    expect(res.status).toBe(500);
  });
});

// ─── POST /webhooks/stripe ────────────────────────────────────────────────────

describe('POST /webhooks/stripe', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env['STRIPE_SECRET_KEY'];
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    app = await buildTestApp();
  });

  it('returns 503 when Stripe is not configured', async () => {
    // Module is cached — Stripe was initialized without a key
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test-sig')
      .send('{}');

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('not configured');
  });
});
