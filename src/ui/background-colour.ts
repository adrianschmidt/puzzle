/**
 * Background colour presets and persistence.
 *
 * Provides a set of preset background colours for the puzzle table,
 * and saves/loads the player's choice from localStorage.
 * The selected colour is applied via a CSS custom property on the root element.
 */

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

/**
 * Get the preset at the given index,
 * or the default if the index is out of range.
 */
export function getColourPreset(index: number): BackgroundColourPreset {
    if (index >= 0 && index < BACKGROUND_COLOUR_PRESETS.length) {
        return BACKGROUND_COLOUR_PRESETS[index];
    }

    return BACKGROUND_COLOUR_PRESETS[DEFAULT_COLOUR_INDEX];
}

/**
 * Save the preferred background colour index to localStorage.
 */
export function saveColourPreference(index: number): void {
    localStorage.setItem(COLOUR_PREFERENCE_KEY, String(index));
}

/**
 * Load the preferred background colour index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export function loadColourPreference(): number {
    try {
        const raw = localStorage.getItem(COLOUR_PREFERENCE_KEY);
        if (raw === null) {
            return DEFAULT_COLOUR_INDEX;
        }

        const index = parseInt(raw, 10);
        if (
            Number.isNaN(index) ||
            index < 0 ||
            index >= BACKGROUND_COLOUR_PRESETS.length
        ) {
            return DEFAULT_COLOUR_INDEX;
        }

        return index;
    } catch {
        return DEFAULT_COLOUR_INDEX;
    }
}

/**
 * Apply a background colour to the document root via CSS custom property.
 * Also updates the `<body>` background-color directly for immediate effect.
 */
export function applyBackgroundColour(index: number): void {
    const preset = getColourPreset(index);
    document.documentElement.style.setProperty(CSS_CUSTOM_PROPERTY, preset.colour);
    document.body.style.backgroundColor = preset.colour;
}
