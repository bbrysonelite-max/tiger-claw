// Tiger Claw — ai.ts unit tests
// Covers the critical bugs that caused production failures:
//   1. History role invariant (getChatHistory / saveChatHistory)
//   2. System prompt content (buildSystemPrompt)
//   3. Key resolution (resolveGoogleKey)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoist mock factories so vi.mock factories can reference them ─────────────
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSet = vi.hoisted(() => vi.fn());
const mockFsExistsSync = vi.hoisted(() => vi.fn());
const mockFsReadFileSync = vi.hoisted(() => vi.fn());
const mockFsMkdirSync = vi.hoisted(() => vi.fn());
const mockDbQuery = vi.hoisted(() => vi.fn());
const mockDecryptToken = vi.hoisted(() => vi.fn((s: string) => `decrypted:${s}`));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(function () {
    return { get: mockRedisGet, set: mockRedisSet };
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    mkdirSync: mockFsMkdirSync,
  };
});

vi.mock('../db.js', () => ({
  getTenant: vi.fn(),
  getPool: vi.fn(() => ({ query: mockDbQuery })),
  getBotState: vi.fn(),
  setBotState: vi.fn(),
}));

vi.mock('../pool.js', () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock('../../tools/flavorConfig.js', () => ({
  loadFlavorConfig: vi.fn(() => ({
    name: 'Network Marketer',
    professionLabel: 'Independent Distributor',
    defaultKeywords: ['MLM', 'network', 'recruiter', 'business', 'opportunity', 'team', 'grow', 'leader'],
  })),
}));

// Mock all 19 tools so the module loads without error
vi.mock('../../tools/tiger_onboard.js', () => ({ tiger_onboard: { name: 'tiger_onboard', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_scout.js', () => ({ tiger_scout: { name: 'tiger_scout', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_contact.js', () => ({ tiger_contact: { name: 'tiger_contact', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_aftercare.js', () => ({ tiger_aftercare: { name: 'tiger_aftercare', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_briefing.js', () => ({ tiger_briefing: { name: 'tiger_briefing', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_convert.js', () => ({ tiger_convert: { name: 'tiger_convert', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_export.js', () => ({ tiger_export: { name: 'tiger_export', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_hive.js', () => ({ tiger_hive: { name: 'tiger_hive', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_import.js', () => ({ tiger_import: { name: 'tiger_import', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_keys.js', () => ({ tiger_keys: { name: 'tiger_keys', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_lead.js', () => ({ tiger_lead: { name: 'tiger_lead', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_move.js', () => ({ tiger_move: { name: 'tiger_move', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_note.js', () => ({ tiger_note: { name: 'tiger_note', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_nurture.js', () => ({ tiger_nurture: { name: 'tiger_nurture', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_objection.js', () => ({ tiger_objection: { name: 'tiger_objection', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_score.js', () => ({ tiger_score: { name: 'tiger_score', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_score_1to10.js', () => ({ tiger_score_1to10: { name: 'tiger_score_1to10', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_search.js', () => ({ tiger_search: { name: 'tiger_search', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('../../tools/tiger_settings.js', () => ({ tiger_settings: { name: 'tiger_settings', description: '', parameters: {}, execute: vi.fn() } }));
vi.mock('node-telegram-bot-api', () => ({ default: vi.fn(() => ({ sendMessage: vi.fn(), sendChatAction: vi.fn() })) }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      startChat: vi.fn(() => ({
        sendMessage: vi.fn().mockResolvedValue({ response: { text: () => 'ok', functionCalls: () => [], candidates: [] } }),
        getHistory: vi.fn().mockResolvedValue([]),
      })),
    })),
  })),
}));

// Import AFTER all mocks are defined
import { getChatHistory, saveChatHistory, buildSystemPrompt, resolveGoogleKey } from '../ai.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'test-tenant-uuid-1234';
const CHAT_ID = 9999;
const WORKDIR = '/tmp/test-workdir';

function makeHistory(roles: string[]) {
  return roles.map((role) => ({
    role,
    parts: [{ text: `message from ${role}` }],
  }));
}

// ─── getChatHistory ───────────────────────────────────────────────────────────

describe('getChatHistory', () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
  });

  it('returns [] when Redis has no entry (null)', async () => {
    mockRedisGet.mockResolvedValue(null);
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result).toEqual([]);
  });

  it('returns history as-is when it starts with user role', async () => {
    const history = makeHistory(['user', 'model', 'user', 'model']);
    mockRedisGet.mockResolvedValue(JSON.stringify(history));
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result).toHaveLength(4);
    expect(result[0]!.role).toBe('user');
  });

  it('trims leading model entries until first user role', async () => {
    const history = makeHistory(['model', 'user', 'model']);
    mockRedisGet.mockResolvedValue(JSON.stringify(history));
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe('user');
  });

  it('trims leading function entries until first user role (the production bug)', async () => {
    // This is the exact bug: after 20-turn trim, function role could appear at index 0
    // Gemini throws: "First content should be with role 'user', got function"
    const history = makeHistory(['function', 'model', 'user', 'model', 'user']);
    mockRedisGet.mockResolvedValue(JSON.stringify(history));
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result[0]!.role).toBe('user');
    expect(result).toHaveLength(3);
  });

  it('returns [] when history has no user entry at all', async () => {
    const history = makeHistory(['model', 'function', 'model']);
    mockRedisGet.mockResolvedValue(JSON.stringify(history));
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result).toEqual([]);
  });

  it('returns [] and does not throw on malformed JSON in Redis', async () => {
    mockRedisGet.mockResolvedValue('THIS IS NOT JSON{{{');
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result).toEqual([]);
  });

  it('returns [] and does not throw when Redis.get rejects', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis connection refused'));
    const result = await getChatHistory(TENANT_ID, CHAT_ID);
    expect(result).toEqual([]);
  });
});

// ─── saveChatHistory ─────────────────────────────────────────────────────────

describe('saveChatHistory', () => {
  const MAX_TURNS = 20; // MAX_HISTORY_TURNS constant from ai.ts

  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisSet.mockReset().mockResolvedValue('OK');
  });

  it('calls Redis set with 7-day TTL', async () => {
    const history = makeHistory(['user', 'model']);
    await saveChatHistory(TENANT_ID, CHAT_ID, history);
    expect(mockRedisSet).toHaveBeenCalledWith(
      `chat_history:${TENANT_ID}:${CHAT_ID}`,
      expect.any(String),
      'EX',
      86400 * 7,
    );
  });

  it('stores the correct key pattern', async () => {
    const history = makeHistory(['user', 'model']);
    await saveChatHistory(TENANT_ID, CHAT_ID, history);
    const [key] = mockRedisSet.mock.calls[0]!;
    expect(key).toBe(`chat_history:${TENANT_ID}:${CHAT_ID}`);
  });

  it('keeps last MAX_TURNS * 2 entries when history is long', async () => {
    // Create 50 entries (25 user + 25 model alternating)
    const roles = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 'user' : 'model'));
    const history = makeHistory(roles);
    await saveChatHistory(TENANT_ID, CHAT_ID, history);

    const saved = JSON.parse(mockRedisSet.mock.calls[0]![1] as string);
    expect(saved.length).toBeLessThanOrEqual(MAX_TURNS * 2);
  });

  it('ensures trimmed history starts at a user role boundary (prevents Gemini role error)', async () => {
    // Build a history of 45 entries where the 26th entry from the end is 'model'
    // This simulates what happens after a 20-turn trim cuts mid-exchange.
    const roles = [
      'user', 'model', 'function', 'model', // some tool exchange
      ...Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'user' : 'model')),
    ];
    const history = makeHistory(roles);
    await saveChatHistory(TENANT_ID, CHAT_ID, history);

    const saved = JSON.parse(mockRedisSet.mock.calls[0]![1] as string);
    expect(saved[0].role).toBe('user');
  });
});

// ─── buildSystemPrompt ────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  const mockTenant = {
    id: TENANT_ID,
    name: 'Brent Bryson',
    flavor: 'network-marketer',
    language: 'English',
  };

  it('includes the tenant name', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('Brent Bryson');
  });

  it('includes the LOCKED lead scoring threshold of 80', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('80');
    expect(prompt).toContain('LOCKED');
  });

  it('includes the ONBOARDING RULE section', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('ONBOARDING RULE');
  });

  it('requires tiger_onboard action=status on EVERY message', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('tiger_onboard');
    expect(prompt).toContain('status');
    expect(prompt).toContain('EVERY incoming user message');
  });

  it('contains CRITICAL verbatim relay instruction (prevents ICP summary paraphrase bug)', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('WORD FOR WORD');
  });

  it('includes flavor name from loadFlavorConfig', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('Network Marketer');
  });

  it('includes the tenant language', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('English');
  });

  it('blocks switching to normal operation before onboarding is complete', () => {
    const prompt = buildSystemPrompt(mockTenant);
    expect(prompt).toContain('Do NOT switch to prospecting');
    expect(prompt).toContain('isComplete=true');
  });
});

// ─── resolveGoogleKey ─────────────────────────────────────────────────────────

describe('resolveGoogleKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFsMkdirSync.mockReturnValue(undefined);
    // Default: no DB BYOK config found
    mockDbQuery.mockResolvedValue({ rows: [] });
    // Default env
    process.env['PLATFORM_ONBOARDING_KEY'] = 'platform-layer1-key';
    process.env['PLATFORM_EMERGENCY_KEY'] = 'platform-layer4-key';
    process.env['GOOGLE_API_KEY'] = 'google-fallback-key';
  });

  afterEach(() => {
    delete process.env['PLATFORM_ONBOARDING_KEY'];
    delete process.env['PLATFORM_EMERGENCY_KEY'];
    delete process.env['GOOGLE_API_KEY'];
  });

  it('returns PLATFORM_ONBOARDING_KEY for layer 1', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(JSON.stringify({ activeLayer: 1 }));

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(key).toBe('platform-layer1-key');
  });

  it('returns PLATFORM_EMERGENCY_KEY for layer 4 (emergency fallback)', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(JSON.stringify({ activeLayer: 4 }));

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(key).toBe('platform-layer4-key');
  });

  it('decrypts and returns layer2Key for layer 2', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(JSON.stringify({
      activeLayer: 2,
      layer2Key: 'enc:some-encrypted-key',
    }));

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(mockDecryptToken).toHaveBeenCalledWith('enc:some-encrypted-key');
    expect(key).toBe('decrypted:enc:some-encrypted-key');
  });

  it('returns undefined and does not throw when layer2Key is missing (logs ALERT)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(JSON.stringify({ activeLayer: 2 })); // no layer2Key

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(key).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('layer2Key'),
    );
    consoleSpy.mockRestore();
  });

  it('returns undefined when tenantPaused=true in key_state', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue(JSON.stringify({ activeLayer: 1, tenantPaused: true }));

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(key).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('paused'));
    consoleSpy.mockRestore();
  });

  it('falls back to PLATFORM_ONBOARDING_KEY when no key_state.json exists', async () => {
    mockFsExistsSync.mockReturnValue(false); // no key_state.json

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(key).toBe('platform-layer1-key');
  });

  it('falls back to GOOGLE_API_KEY when PLATFORM_ONBOARDING_KEY not set', async () => {
    delete process.env['PLATFORM_ONBOARDING_KEY'];
    mockFsExistsSync.mockReturnValue(false);

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    expect(key).toBe('google-fallback-key');
  });

  it('does not throw and logs alert when key_state.json has invalid JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFsExistsSync.mockReturnValue(true);
    mockFsReadFileSync.mockReturnValue('NOT_VALID_JSON{{{');

    const key = await resolveGoogleKey(TENANT_ID, WORKDIR);
    // Falls through to env var after failed parse
    expect(key).toBe('platform-layer1-key');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[AI] [ALERT]'), expect.any(String));
    consoleSpy.mockRestore();
  });
});
