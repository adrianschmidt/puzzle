/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { diagnostics } from '../diagnostics.js';
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

    it('migrates each old string id to its specific nearest swatch', () => {
        // Asserts the exact target for all 12 old presets, so a typo in any
        // one is caught (not just "resolves to some real swatch", which the
        // default fallback would also satisfy).
        const expected: Record<string, string> = {
            midnight: 'indigo-darker',
            charcoal: 'gray-darker',
            slate: 'glaucous-dark',
            light: 'gray-light',
            wood: 'brown-dark',
            'green-felt': 'green-darker',
            'hot-pink': 'magenta-default',
            blush: 'red-lighter',
            peach: 'orange-lighter',
            sage: 'green-lighter',
            sky: 'blue-lighter',
            lavender: 'violet-lighter',
        };
        for (const [legacy, target] of Object.entries(expected)) {
            localStorage.setItem(COLOUR_PREFERENCE_KEY, legacy);
            expect(loadColourPreference()).toBe(target);
        }
    });

    it('migrates a legacy integer index to the same target as its id', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '0'); // midnight
        expect(loadColourPreference()).toBe('indigo-darker');
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '3'); // light
        expect(loadColourPreference()).toBe('gray-light');
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '11'); // lavender
        expect(loadColourPreference()).toBe('violet-lighter');
    });

    it('falls back to default for an unrecognised value', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, 'totally-unknown');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('ignores Object.prototype keys (returns a real string id)', () => {
        for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            localStorage.setItem(COLOUR_PREFERENCE_KEY, key);
            expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
        }
    });

    it('falls back to default for an out-of-range legacy index', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '99');
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
        // Stub a resolvable colour so the chrome path doesn't spuriously
        // warn (jsdom can't resolve var() on its own).
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            backgroundColor: 'rgb(33, 150, 243)',
        } as CSSStyleDeclaration);
        const warn = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        applyBackgroundColour('blue-default');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe('var(--color-blue-default)');
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns and defaults to dark chrome when the colour cannot be resolved', () => {
        // Mirrors a missing/unloaded palette.css: getComputedStyle returns
        // an empty (unparseable) background-color.
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            backgroundColor: '',
        } as CSSStyleDeclaration);
        const warn = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        applyBackgroundColour('blue-default');
        expect(warn).toHaveBeenCalledOnce();
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

    it('derives the chrome from the colour written to document.body', () => {
        // Regression guard for the read-back target. applyBackgroundColour
        // writes the colour to document.body.style.backgroundColor *so it can
        // read it back* via getComputedStyle(document.body) to pick the
        // ui-scheme. That assignment looks redundant next to the
        // --puzzle-bg-colour custom property (which drives the visible
        // background), but dropping it leaves body transparent → the chrome
        // would be silently stuck on 'dark' for every colour.
        //
        // Unlike the tests above, this mock resolves the var() off body's
        // *actual* inline style — the way a real browser would — so it fails
        // if the body assignment is ever removed (body would be '' → dark).
        vi.spyOn(window, 'getComputedStyle').mockImplementation(
            (el: Element) =>
                ({
                    backgroundColor:
                        (el as HTMLElement).style.backgroundColor ===
                        'var(--color-gray-lighter)'
                            ? 'rgb(245, 245, 245)'
                            : '',
                }) as CSSStyleDeclaration,
        );
        const warn = vi.spyOn(diagnostics, 'warn').mockImplementation(() => {});
        applyBackgroundColour('gray-lighter');
        expect(document.body.style.backgroundColor).toBe(
            'var(--color-gray-lighter)',
        );
        expect(document.documentElement.dataset.uiScheme).toBe('light');
        expect(warn).not.toHaveBeenCalled();
    });

    it('falls back to the default preset for an unknown id', () => {
        applyBackgroundColour('not-a-colour');
        expect(
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY),
        ).toBe(`var(--color-${DEFAULT_COLOUR_ID})`);
    });
});
