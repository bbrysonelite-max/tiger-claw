import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { loadFlavorConfig } from '../flavorConfig';
import { NETWORK_MARKETER_FLAVOR } from '../../config/index';

// Mock fs to avoid reading real files during unit testing
vi.mock('fs', () => {
    return {
        ...vi.importActual('fs'),
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    };
});

describe('flavorConfig loader', () => {

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should load a valid flavor JSON successfully', () => {
        const mockConfig = {
            botName: 'Test Bot',
            niche: 'Testing',
            systemPrompt: 'You are a test.',
            triggerWords: ['test', 'check'],
            nurtureSequence: []
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

        const result = loadFlavorConfig('valid-flavor');

        expect(result.botName).toBe('Test Bot');
        expect(result.niche).toBe('Testing');
        expect(result.triggerWords).toContain('test');
    });

    it('should fallback to Network Marketer config if flavor file does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = loadFlavorConfig('missing-flavor');

        expect(result.botName).toBe(NETWORK_MARKETER_FLAVOR.botName);
        expect(result.niche).toBe(NETWORK_MARKETER_FLAVOR.niche);
    });

    it('should fallback to Network Marketer config if flavor file contains invalid JSON', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json ');

        const result = loadFlavorConfig('corrupt-flavor');

        expect(result.botName).toBe(NETWORK_MARKETER_FLAVOR.botName);
        expect(result.niche).toBe(NETWORK_MARKETER_FLAVOR.niche);
    });

    it('should return valid configuration for an empty flavor argument (defaults to network-marketer fallback)', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = loadFlavorConfig('');

        expect(result.botName).toBe(NETWORK_MARKETER_FLAVOR.botName);
    });
});
