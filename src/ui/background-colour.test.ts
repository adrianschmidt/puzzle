/**
 * @vitest-environment jsdom
 */

/**
 * Tests for background colour presets and persistence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    BACKGROUND_COLOUR_PRESETS,
    DEFAULT_COLOUR_INDEX,
    COLOUR_PREFERENCE_KEY,
    CSS_CUSTOM_PROPERTY,
    getColourPreset,
    saveColourPreference,
    loadColourPreference,
    applyBackgroundColour,
} from './background-colour.js';

describe('BACKGROUND_COLOUR_PRESETS', () => {
    it('has at least 3 presets', () => {
        expect(BACKGROUND_COLOUR_PRESETS.length).toBeGreaterThanOrEqual(3);
    });

    it('each preset has a label and a colour', () => {
        for (const preset of BACKGROUND_COLOUR_PRESETS) {
            expect(preset.label).toBeTruthy();
            expect(preset.colour).toBeTruthy();
        }
    });

    it('first preset matches the original dark background', () => {
        expect(BACKGROUND_COLOUR_PRESETS[0].colour).toBe('#1a1a2e');
    });
});

describe('getColourPreset', () => {
    it('returns the preset at the given index', () => {
        const preset = getColourPreset(0);
        expect(preset).toBe(BACKGROUND_COLOUR_PRESETS[0]);
    });

    it('returns a different preset for a different index', () => {
        const preset = getColourPreset(1);
        expect(preset).toBe(BACKGROUND_COLOUR_PRESETS[1]);
    });

    it('returns the default for out-of-range index', () => {
        const preset = getColourPreset(99);
        expect(preset).toBe(BACKGROUND_COLOUR_PRESETS[DEFAULT_COLOUR_INDEX]);
    });

    it('returns the default for negative index', () => {
        const preset = getColourPreset(-1);
        expect(preset).toBe(BACKGROUND_COLOUR_PRESETS[DEFAULT_COLOUR_INDEX]);
    });
});

describe('saveColourPreference / loadColourPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads a preference', () => {
        saveColourPreference(3);
        expect(loadColourPreference()).toBe(3);
    });

    it('returns the default when nothing is saved', () => {
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_INDEX);
    });

    it('returns the default for invalid saved value', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, 'garbage');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_INDEX);
    });

    it('returns the default for out-of-range saved value', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '99');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_INDEX);
    });

    it('returns the default for negative saved value', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '-1');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_INDEX);
    });
});

describe('applyBackgroundColour', () => {
    beforeEach(() => {
        // Reset any inline styles
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
        document.body.style.backgroundColor = '';
    });

    it('sets the CSS custom property on the document root', () => {
        applyBackgroundColour(0);
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe(BACKGROUND_COLOUR_PRESETS[0].colour);
    });

    it('sets the body background-color', () => {
        applyBackgroundColour(0);
        expect(document.body.style.backgroundColor).toBeTruthy();
    });

    it('applies a different colour for a different index', () => {
        applyBackgroundColour(2);
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe(BACKGROUND_COLOUR_PRESETS[2].colour);
    });

    it('falls back to default for out-of-range index', () => {
        applyBackgroundColour(99);
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe(
            BACKGROUND_COLOUR_PRESETS[DEFAULT_COLOUR_INDEX].colour,
        );
    });
});
