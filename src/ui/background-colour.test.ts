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
    isLightColour,
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

    it('first preset is Midnight (original default)', () => {
        expect(BACKGROUND_COLOUR_PRESETS[0].label).toBe('Midnight');
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

describe('isLightColour', () => {
    it('identifies white as light', () => {
        expect(isLightColour('#ffffff')).toBe(true);
    });

    it('identifies pastel blush as light', () => {
        expect(isLightColour('#f5e0e0')).toBe(true);
    });

    it('identifies light grey as light', () => {
        expect(isLightColour('#d4d4d4')).toBe(true);
    });

    it('identifies midnight navy as dark', () => {
        expect(isLightColour('#1a1a2e')).toBe(false);
    });

    it('identifies charcoal as dark', () => {
        expect(isLightColour('#2d2d2d')).toBe(false);
    });

    it('identifies hot pink as dark', () => {
        expect(isLightColour('#ff1493')).toBe(false);
    });
});

describe('applyBackgroundColour', () => {
    beforeEach(() => {
        // Reset any inline styles
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
        document.body.style.backgroundColor = '';
        delete document.documentElement.dataset.uiScheme;
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

    it('sets data-ui-scheme="light" for a light pastel preset', () => {
        // Blush (#f5e0e0) is index 7
        applyBackgroundColour(7);
        expect(document.documentElement.dataset.uiScheme).toBe('light');
    });

    it('sets data-ui-scheme="dark" for a dark preset', () => {
        // Midnight (#1a1a2e) is DEFAULT_COLOUR_INDEX (0)
        applyBackgroundColour(DEFAULT_COLOUR_INDEX);
        expect(document.documentElement.dataset.uiScheme).toBe('dark');
    });
});
