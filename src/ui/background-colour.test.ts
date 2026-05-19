/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
    it('has at least 3 presets', () => {
        expect(BACKGROUND_COLOUR_PRESETS.length).toBeGreaterThanOrEqual(3);
    });

    it('each preset has id, label, and colour', () => {
        for (const preset of BACKGROUND_COLOUR_PRESETS) {
            expect(preset.id).toBeTruthy();
            expect(preset.label).toBeTruthy();
            expect(preset.colour).toBeTruthy();
        }
    });

    it('first preset is Midnight (id "midnight", the original default)', () => {
        expect(BACKGROUND_COLOUR_PRESETS[0].label).toBe('Midnight');
        expect(BACKGROUND_COLOUR_PRESETS[0].id).toBe('midnight');
        expect(DEFAULT_COLOUR_ID).toBe('midnight');
    });
});

describe('getColourPreset', () => {
    it('returns the preset matching an id', () => {
        expect(getColourPreset('midnight').label).toBe('Midnight');
        expect(getColourPreset('charcoal').label).toBe('Charcoal');
    });

    it('returns the default preset for an unknown id', () => {
        expect(getColourPreset('not-a-colour').label).toBe('Midnight');
    });
});

describe('saveColourPreference / loadColourPreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads an id', () => {
        saveColourPreference('slate');
        expect(loadColourPreference()).toBe('slate');
    });

    it('returns the default when nothing is saved', () => {
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('returns the default for an unknown saved value', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, 'garbage');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });

    it('migrates legacy integer indices to ids', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '1');
        expect(loadColourPreference()).toBe('charcoal');
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '5');
        expect(loadColourPreference()).toBe('green-felt');
    });

    it('returns the default for out-of-range legacy values', () => {
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '99');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
        localStorage.setItem(COLOUR_PREFERENCE_KEY, '-1');
        expect(loadColourPreference()).toBe(DEFAULT_COLOUR_ID);
    });
});

describe('isLightColour', () => {
    it('identifies white as light', () => {
        expect(isLightColour('#ffffff')).toBe(true);
    });

    it('identifies pastel blush as light', () => {
        expect(isLightColour('#f5e0e0')).toBe(true);
    });

    it('identifies midnight as dark', () => {
        expect(isLightColour('#1a1a2e')).toBe(false);
    });

    it('identifies hot pink as dark', () => {
        expect(isLightColour('#ff1493')).toBe(false);
    });
});

describe('applyBackgroundColour', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty(CSS_CUSTOM_PROPERTY);
        document.body.style.backgroundColor = '';
        delete document.documentElement.dataset.uiScheme;
    });

    it('sets the CSS custom property on the document root', () => {
        applyBackgroundColour('midnight');
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe('#1a1a2e');
    });

    it('sets the body background-color', () => {
        applyBackgroundColour('midnight');
        expect(document.body.style.backgroundColor).toBeTruthy();
    });

    it('applies a different colour for a different id', () => {
        applyBackgroundColour('slate');
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe('#4a5568');
    });

    it('falls back to default for an unknown id', () => {
        applyBackgroundColour('not-a-colour');
        const value =
            document.documentElement.style.getPropertyValue(CSS_CUSTOM_PROPERTY);
        expect(value).toBe('#1a1a2e');
    });

    it('sets data-ui-scheme="light" for a light pastel preset', () => {
        applyBackgroundColour('blush');
        expect(document.documentElement.dataset.uiScheme).toBe('light');
    });

    it('sets data-ui-scheme="dark" for midnight', () => {
        applyBackgroundColour('midnight');
        expect(document.documentElement.dataset.uiScheme).toBe('dark');
    });
});
