/**
 * @vitest-environment jsdom
 */

/**
 * Tests for cut style options and preference persistence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CUT_STYLE_OPTIONS,
    DEFAULT_CUT_STYLE_INDEX,
    CUT_STYLE_PREFERENCE_KEY,
    COMPOSABLE_CONFIG_KEY,
    getCutStyleOption,
    findCutStyleIndex,
    saveCutStylePreference,
    loadCutStylePreference,
    saveComposableConfigPreference,
    loadComposableConfigPreference,
} from './cut-styles.js';

describe('CUT_STYLE_OPTIONS', () => {
    it('has at least two options', () => {
        expect(CUT_STYLE_OPTIONS.length).toBeGreaterThanOrEqual(2);
    });

    it('includes classic and fractal', () => {
        const ids = CUT_STYLE_OPTIONS.map((o) => o.id);
        expect(ids).toContain('classic');
        expect(ids).toContain('fractal');
    });
});

describe('getCutStyleOption', () => {
    it('returns the option at a valid index', () => {
        expect(getCutStyleOption(0).id).toBe('classic');
        expect(getCutStyleOption(1).id).toBe('fractal');
    });

    it('returns the default for out-of-range index', () => {
        expect(getCutStyleOption(-1).id).toBe('classic');
        expect(getCutStyleOption(99).id).toBe('classic');
    });
});

describe('findCutStyleIndex', () => {
    it('finds classic at index 0', () => {
        expect(findCutStyleIndex('classic')).toBe(0);
    });

    it('finds fractal at index 1', () => {
        expect(findCutStyleIndex('fractal')).toBe(1);
    });

    it('returns default for unknown style', () => {
        expect(findCutStyleIndex('unknown' as any)).toBe(DEFAULT_CUT_STYLE_INDEX);
    });
});

describe('saveCutStylePreference / loadCutStylePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns default when nothing is saved', () => {
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_INDEX);
    });

    it('round-trips a saved preference', () => {
        saveCutStylePreference(1);
        expect(loadCutStylePreference()).toBe(1);
    });

    it('returns default for invalid stored value', () => {
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, 'garbage');
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_INDEX);
    });

    it('returns default for out-of-range stored value', () => {
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '99');
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_INDEX);
    });
});

describe('saveComposableConfigPreference / loadComposableConfigPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    const sampleConfig = {
        horizontalAmplitude: 0.25,
        horizontalFrequency: 3.0,
        verticalAmplitude: 0.1,
        verticalFrequency: 5.0,
        disableTabs: true,
    };

    it('returns undefined when nothing is saved', () => {
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('round-trips a saved config', () => {
        saveComposableConfigPreference(sampleConfig);
        expect(loadComposableConfigPreference()).toEqual(sampleConfig);
    });

    it('returns undefined for invalid JSON', () => {
        localStorage.setItem(COMPOSABLE_CONFIG_KEY, 'not-json');
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('returns undefined for JSON missing required fields', () => {
        localStorage.setItem(
            COMPOSABLE_CONFIG_KEY,
            JSON.stringify({ horizontalAmplitude: 0.5 }),
        );
        expect(loadComposableConfigPreference()).toBeUndefined();
    });

    it('coerces numeric string values to numbers', () => {
        localStorage.setItem(
            COMPOSABLE_CONFIG_KEY,
            JSON.stringify({
                horizontalAmplitude: '0.2',
                horizontalFrequency: '1.5',
                verticalAmplitude: '0.3',
                verticalFrequency: '2.0',
                disableTabs: false,
            }),
        );
        const loaded = loadComposableConfigPreference();
        expect(loaded?.horizontalAmplitude).toBe(0.2);
        expect(typeof loaded?.horizontalAmplitude).toBe('number');
    });
});
