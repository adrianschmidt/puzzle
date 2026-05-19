/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CUT_STYLE_OPTIONS,
    DEFAULT_CUT_STYLE_ID,
    CUT_STYLE_PREFERENCE_KEY,
    getCutStyleOption,
    saveCutStylePreference,
    loadCutStylePreference,
} from './cut-styles.js';

describe('CUT_STYLE_OPTIONS', () => {
    it('has at least two options', () => {
        expect(CUT_STYLE_OPTIONS.length).toBeGreaterThanOrEqual(2);
    });

    it('includes classic, fractal, composable', () => {
        const ids = CUT_STYLE_OPTIONS.map((o) => o.id);
        expect(ids).toContain('classic');
        expect(ids).toContain('fractal');
        expect(ids).toContain('composable');
    });

    it('default id is "classic"', () => {
        expect(DEFAULT_CUT_STYLE_ID).toBe('classic');
    });
});

describe('getCutStyleOption', () => {
    it('returns the option matching an id', () => {
        expect(getCutStyleOption('classic').id).toBe('classic');
        expect(getCutStyleOption('fractal').id).toBe('fractal');
    });

    it('returns the default for an unknown id', () => {
        expect(getCutStyleOption('not-a-style').id).toBe('classic');
    });
});

describe('saveCutStylePreference / loadCutStylePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns default when nothing is saved', () => {
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_ID);
    });

    it('round-trips an id', () => {
        saveCutStylePreference('fractal');
        expect(loadCutStylePreference()).toBe('fractal');
    });

    it('migrates legacy integer indices to ids', () => {
        // Pre-migration order: classic=0, fractal=1, composable=2.
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '0');
        expect(loadCutStylePreference()).toBe('classic');
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '1');
        expect(loadCutStylePreference()).toBe('fractal');
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, '2');
        expect(loadCutStylePreference()).toBe('composable');
    });

    it('returns default for unknown stored values', () => {
        localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, 'garbage');
        expect(loadCutStylePreference()).toBe(DEFAULT_CUT_STYLE_ID);
    });
});
