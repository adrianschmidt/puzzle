/**
 * Background colour presets and persistence.
 *
 * Provides a set of preset background colours for the puzzle table,
 * and saves/loads the player's choice from localStorage.
 * The selected colour is applied via a CSS custom property on the root element.
 */

import { createIndexedPreferenceStore } from './preference-store.js';

/**
 * A background colour preset.
 */
export interface BackgroundColourPreset {
    /** Display label, e.g. "Dark" */
    label: string;
    /** CSS colour value */
    colour: string;
}

/**
 * Available background colour presets.
 */
export const BACKGROUND_COLOUR_PRESETS: readonly BackgroundColourPreset[] = [
    { label: 'Midnight', colour: '#1a1a2e' },
    { label: 'Charcoal', colour: '#2d2d2d' },
    { label: 'Slate', colour: '#4a5568' },
    { label: 'Light', colour: '#d4d4d4' },
    { label: 'Wood', colour: '#5c4033' },
    { label: 'Green felt', colour: '#2e5f3e' },
    { label: 'Hot pink', colour: '#ff1493' },
    { label: 'Blush', colour: '#f5e0e0' },
    { label: 'Peach', colour: '#fde8d0' },
    { label: 'Sage', colour: '#ddeedd' },
    { label: 'Sky', colour: '#ddeeff' },
    { label: 'Lavender', colour: '#e8e0f0' },
] as const;

/** Default preset index (Midnight — the original default). */
export const DEFAULT_COLOUR_INDEX = 0;

/** localStorage key for the saved background colour. */
export const COLOUR_PREFERENCE_KEY = 'puzzle-background-colour';

/** CSS custom property name applied to the document root. */
export const CSS_CUSTOM_PROPERTY = '--puzzle-bg-colour';

const store = createIndexedPreferenceStore({
    key: COLOUR_PREFERENCE_KEY,
    presets: BACKGROUND_COLOUR_PRESETS,
    defaultIndex: DEFAULT_COLOUR_INDEX,
});

/**
 * Get the preset at the given index,
 * or the default if the index is out of range.
 */
export const getColourPreset = store.getPreset;

/**
 * Save the preferred background colour index to localStorage.
 */
export const saveColourPreference = store.save;

/**
 * Load the preferred background colour index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export const loadColourPreference = store.load;

/**
 * Determine whether a hex colour is perceptually light
 * (relative luminance > 0.4, i.e. needs dark UI chrome on top).
 */
export function isLightColour(hex: string): boolean {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    // Perceived luminance (ITU-R BT.709)
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    return luminance > 0.4;
}

/**
 * Apply a background colour to the document root via CSS custom property.
 * Also updates the `<body>` background-color directly for immediate effect,
 * and toggles `data-ui-scheme` so UI chrome adapts to light/dark backgrounds.
 */
export function applyBackgroundColour(index: number): void {
    const preset = getColourPreset(index);
    document.documentElement.style.setProperty(CSS_CUSTOM_PROPERTY, preset.colour);
    document.body.style.backgroundColor = preset.colour;
    document.documentElement.dataset.uiScheme = isLightColour(preset.colour)
        ? 'light'
        : 'dark';
}
