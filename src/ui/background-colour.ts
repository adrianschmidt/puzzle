/**
 * Background colour presets and persistence.
 *
 * Provides preset background colours for the puzzle table. Saved by
 * stable string id; legacy integer indices migrate via
 * `createIdPreferenceStore`.
 */

import { createIdPreferenceStore } from './preference-store.js';

export interface BackgroundColourPreset {
    /** Stable string identifier used in localStorage. */
    id: string;
    /** Display label, e.g. "Midnight" */
    label: string;
    /** CSS colour value */
    colour: string;
}

/**
 * Available background colour presets.
 *
 * Storage is id-keyed; declaration order is no longer load-bearing for
 * persistence. The legacy-integer migration (`LEGACY_ORDER` below)
 * relies on the original pre-migration order, captured separately —
 * so this array can be reordered without affecting saved preferences.
 */
export const BACKGROUND_COLOUR_PRESETS: readonly BackgroundColourPreset[] = [
    { id: 'midnight',   label: 'Midnight',   colour: '#1a1a2e' },
    { id: 'charcoal',   label: 'Charcoal',   colour: '#2d2d2d' },
    { id: 'slate',      label: 'Slate',      colour: '#4a5568' },
    { id: 'light',      label: 'Light',      colour: '#d4d4d4' },
    { id: 'wood',       label: 'Wood',       colour: '#5c4033' },
    { id: 'green-felt', label: 'Green felt', colour: '#2e5f3e' },
    { id: 'hot-pink',   label: 'Hot pink',   colour: '#ff1493' },
    { id: 'blush',      label: 'Blush',      colour: '#f5e0e0' },
    { id: 'peach',      label: 'Peach',      colour: '#fde8d0' },
    { id: 'sage',       label: 'Sage',       colour: '#ddeedd' },
    { id: 'sky',        label: 'Sky',        colour: '#ddeeff' },
    { id: 'lavender',   label: 'Lavender',   colour: '#e8e0f0' },
] as const;

/** Default preset id (Midnight — the original default). */
export const DEFAULT_COLOUR_ID = 'midnight';

/** localStorage key for the saved background colour. */
export const COLOUR_PREFERENCE_KEY = 'puzzle-background-colour';

/** CSS custom property name applied to the document root. */
export const CSS_CUSTOM_PROPERTY = '--puzzle-bg-colour';

/**
 * Pre-migration storage order — DO NOT reorder. Used by the loader to
 * translate legacy integer indices to ids. Drop in a follow-up release
 * once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = [
    'midnight',
    'charcoal',
    'slate',
    'light',
    'wood',
    'green-felt',
    'hot-pink',
    'blush',
    'peach',
    'sage',
    'sky',
    'lavender',
] as const;

const store = createIdPreferenceStore({
    key: COLOUR_PREFERENCE_KEY,
    presets: BACKGROUND_COLOUR_PRESETS,
    defaultId: DEFAULT_COLOUR_ID,
    legacyOrder: LEGACY_ORDER,
});

export const getColourPreset = store.getPreset;
export const saveColourPreference = store.save;
export const loadColourPreference = store.load;

/**
 * Determine whether a hex colour is perceptually light
 * (relative luminance > 0.4).
 */
export function isLightColour(hex: string): boolean {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4;
}

/**
 * Apply a background colour to the document root.
 */
export function applyBackgroundColour(id: string): void {
    const preset = getColourPreset(id);
    document.documentElement.style.setProperty(CSS_CUSTOM_PROPERTY, preset.colour);
    document.body.style.backgroundColor = preset.colour;
    document.documentElement.dataset.uiScheme = isLightColour(preset.colour)
        ? 'light'
        : 'dark';
}
