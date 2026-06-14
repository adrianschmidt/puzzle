/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    WAVY_CONFIG_KEY,
    loadWavyConfigPreference,
    saveWavyConfigPreference,
} from './wavy-config.js';

describe('wavy-config preference', () => {
    beforeEach(() => localStorage.clear());

    it('returns undefined when nothing is saved', () => {
        expect(loadWavyConfigPreference()).toBeUndefined();
    });

    it('round-trips borderless: true', () => {
        saveWavyConfigPreference({ borderless: true });
        expect(loadWavyConfigPreference()).toEqual({ borderless: true });
    });

    it('round-trips borderless: false', () => {
        saveWavyConfigPreference({ borderless: false });
        expect(loadWavyConfigPreference()).toEqual({ borderless: false });
    });

    it('coerces a non-boolean stored borderless to a boolean', () => {
        localStorage.setItem(WAVY_CONFIG_KEY, JSON.stringify({ borderless: 1 }));
        expect(loadWavyConfigPreference()).toEqual({ borderless: true });
    });

    it('returns undefined for a malformed stored value (no borderless key)', () => {
        localStorage.setItem(WAVY_CONFIG_KEY, JSON.stringify({ nope: true }));
        expect(loadWavyConfigPreference()).toBeUndefined();
    });
});
