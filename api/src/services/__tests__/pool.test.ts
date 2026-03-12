// Tiger Claw — pool.ts unit tests
// Covers AES-256-GCM encrypt/decrypt round-trip (pure functions, no DB/network needed)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptToken, decryptToken } from '../pool.js';

const PLAINTEXT = 'test-bot-token-123456:ABCDEFGHIJKLMNOP';
const TEST_ENC_KEY = 'tiger-claw-unit-test-encryption-key-only';

describe('encryptToken / decryptToken', () => {
  describe('without ENCRYPTION_KEY set', () => {
    beforeEach(() => {
      delete process.env['ENCRYPTION_KEY'];
    });

    it('encryptToken returns plaintext unchanged (dev passthrough)', () => {
      expect(encryptToken(PLAINTEXT)).toBe(PLAINTEXT);
    });

    it('decryptToken returns non-enc: strings unchanged (plaintext passthrough)', () => {
      expect(decryptToken(PLAINTEXT)).toBe(PLAINTEXT);
    });

    it('decryptToken returns plaintext for any non-enc: prefixed string', () => {
      expect(decryptToken('random-string-no-prefix')).toBe('random-string-no-prefix');
    });
  });

  describe('with ENCRYPTION_KEY set', () => {
    beforeEach(() => {
      process.env['ENCRYPTION_KEY'] = TEST_ENC_KEY;
    });

    afterEach(() => {
      delete process.env['ENCRYPTION_KEY'];
    });

    it('encryptToken produces an enc:-prefixed string', () => {
      const result = encryptToken(PLAINTEXT);
      expect(result).toMatch(/^enc:/);
    });

    it('encryptToken output contains 4 colon-separated segments (enc:iv:authtag:ciphertext)', () => {
      const result = encryptToken(PLAINTEXT);
      const parts = result.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('enc');
      expect(parts[1]).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(parts[2]).toHaveLength(32); // 16 byte authtag
    });

    it('round-trip: encrypt then decrypt returns original plaintext', () => {
      const encrypted = encryptToken(PLAINTEXT);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(PLAINTEXT);
    });

    it('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
      const e1 = encryptToken(PLAINTEXT);
      const e2 = encryptToken(PLAINTEXT);
      expect(e1).not.toBe(e2);
      // But both must decrypt to the same plaintext
      expect(decryptToken(e1)).toBe(PLAINTEXT);
      expect(decryptToken(e2)).toBe(PLAINTEXT);
    });

    it('round-trip works for Telegram bot token format', () => {
      const token = '7712345678:AAFakeTokenForTestingOnly-xyz123';
      expect(decryptToken(encryptToken(token))).toBe(token);
    });

    it('decryptToken throws when ENCRYPTION_KEY is not set but token is encrypted', () => {
      const encrypted = encryptToken(PLAINTEXT);
      delete process.env['ENCRYPTION_KEY'];
      expect(() => decryptToken(encrypted)).toThrow('ENCRYPTION_KEY not set but token is encrypted');
    });
  });

  describe('malformed encrypted tokens', () => {
    beforeEach(() => {
      process.env['ENCRYPTION_KEY'] = TEST_ENC_KEY;
    });
    afterEach(() => {
      delete process.env['ENCRYPTION_KEY'];
    });

    it('decryptToken throws on enc: token with missing segments', () => {
      expect(() => decryptToken('enc:badinput')).toThrow();
    });

    it('decryptToken throws on enc: token with invalid hex (corrupt ciphertext)', () => {
      expect(() => decryptToken('enc:00112233445566778899aabbccddeeff:00112233445566778899aabbccddeeff:NOTVALIDHEX')).toThrow();
    });

    it('decryptToken throws on auth tag mismatch (tampered ciphertext)', () => {
      const encrypted = encryptToken(PLAINTEXT);
      // Flip a character in the ciphertext segment
      const parts = encrypted.split(':');
      parts[3] = parts[3]!.slice(0, -2) + 'ff';
      const tampered = parts.join(':');
      expect(() => decryptToken(tampered)).toThrow();
    });
  });
});
