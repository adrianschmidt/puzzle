/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    BACKGROUND_COLOUR_PRESETS,
    DEFAULT_COLOUR_ID,
    COLOUR_PREFERENCE_KEY,
    CSS_CUSTOM_PROPERTY,
    getColourPreset,
    saveColourPreference,
    loadColourPreference,
    applyBackgroundColour,
    isLightColour,
} from './background-colour.js';

describe('BACKGROUND_COLOUR_PRESETS', () => {
    it('exposes the full palette (140 presets)', () => {
        expect(BACKGROUND_COLOUR_PRESETS.length).toBe(140);
    });

    it('each preset colour is a var(--color-…) reference', () => {
        for (const p of BACKGROUND_COLOUR_PRESETS) {
            expect(p.colour).toMatch(/^var\(--color-[a-z]+-[a-z0-9-]+\)$/);
        }
    });

    it('default id resolves to a preset', () => {
        expect(
            BACKGROUND_COLOUR_PRESETS.some((p) => p.id === DEFAULT_COLOUR_ID),
        ).toBe(true);
    });
});

describe('getColourPreset', () => {
    it('returns the matching preset', () => {
        const preset = getColourPreset('blue-default');
        expect(preset.id).toBe('blue-default');
        expect(preset.colour).toBe('var(--color-blue-default)');
    });

    it('falls back to the default for an unknown id', () => {
        expect(getColourPreset('nope').id).toBe(DEFAULT_COLOUR_ID);
    });
});

describe('loadColourPreference', () => {
    beforeEach(() => localStorage.clear());

    it('returns the default when nothing is saved', () => {
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('round-trips a valid id', () => {
        saveColourPreference('green-dark');
        expect(loadColourPreference()).toBe('green-dark');
    });

    it('falls back to default for a legacy numeric index', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '3');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('falls back to default for an old string id', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, 'midnight');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });
});

describe('isLightColour', () => {
    it('classifies rgb() strings (from getComputedStyle)', () => {
        expect(isLightColour('rgb(245, 245, 245)')).toBe(true);
        expect(isLightColour('rgb(26, 35, 126)')).toBe(false);
    });

    it('classifies hex strings', () => {
        expect(isLightColour('#ffffff')).toBe(true);
        expect(isLightColour('#000000')).toBe(false);
    });

    it('treats an unparseable colour as dark', () => {
        expect(isLightColour('')).toBe(false);
    });

    it('classifies space-separated rgb() (CSS Color L4)', () => {
        expect(isLightColour('rgb(245 245 245)')).toBe(true);
        expect(isLightColour('rgb(26 35 126)')).toBe(false);
    });
});

describe('applyBackgroundColour', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
        document.body.style.backgroundColor = '';
        delete document.documentElement.dataset.uiScheme;
    });
    afterEach(() => vi.restoreAllMocks());

    it('sets the custom property to the variable reference', () => {
        applyBackgroundColour('blue-default');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('var(--color-blue-default)');
        expect(document.documentElement.dataset.uiScheme).toBe('dark');
    });

    it('sets a light ui-scheme when the resolved colour is light', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            backgroundColor: 'rgb(245, 245, 245)',
        } as CSSStyleDeclaration);
        applyBackgroundColour('gray-lighter');
        expect(document.documentElement.dataset.uiScheme).toBe('light');
    });

    it('sets a dark ui-scheme when the resolved colour is dark', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            backgroundColor: 'rgb(26, 35, 126)',
        } as CSSStyleDeclaration);
        applyBackgroundColour('indigo-darker');
        expect(document.documentElement.dataset.uiScheme).toBe('dark');
    });

    it('falls back to the default preset for an unknown id', () => {
        applyBackgroundColour('not-a-colour');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe(`var(--color-${DEFAULT_COLOUR_ID})`);
    });
});
