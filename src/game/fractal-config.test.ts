/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    FRACTAL_CONFIG_KEY,
    saveFractalConfigPreference,
    loadFractalConfigPreference,
} from './fractal-config.js';

describe('saveFractalConfigPreference / loadFractalConfigPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns undefined when nothing is saved', () => {
        expect(loadFractalConfigPreference()).toBeUndefined();
    });

    it('round-trips a saved config with borderless: true', () => {
        saveFractalConfigPreference({ borderless: true });
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });

    it('round-trips a saved config with borderless: false', () => {
        saveFractalConfigPreference({ borderless: false });
        expect(loadFractalConfigPreference()).toEqual({ borderless: false });
    });

    it('returns undefined for invalid JSON', () => {
        localStorage.setItem(FRACTAL_CONFIG_KEY, 'not-json');
        expect(loadFractalConfigPreference()).toBeUndefined();
    });

    it('returns undefined for JSON missing borderless field', () => {
        localStorage.setItem(FRACTAL_CONFIG_KEY, JSON.stringify({ other: true }));
        expect(loadFractalConfigPreference()).toBeUndefined();
    });

    it('coerces truthy non-boolean borderless values to true', () => {
        localStorage.setItem(
            FRACTAL_CONFIG_KEY,
            JSON.stringify({ borderless: 1 }),
        );
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });

    it('silently ignores legacy rotationEnabled field on stored JSON', () => {
        localStorage.setItem(
            FRACTAL_CONFIG_KEY,
            JSON.stringify({ borderless: true, rotationEnabled: true }),
        );
        expect(loadFractalConfigPreference()).toEqual({ borderless: true });
    });
});
