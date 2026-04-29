/**
 * Cut style options and preference persistence.
 *
 * Defines the available puzzle cut styles and saves/loads
 * the player's preferred style from localStorage.
 */

import { createIndexedPreferenceStore } from '../ui/preference-store.js';

/**
 * Identifier for a cut style generator.
 */
export type CutStyle = 'classic' | 'fractal' | 'composable';

/**
 * A selectable cut style option.
 */
export interface CutStyleOption {
    /** Machine identifier. */
    id: CutStyle;
    /** Display label. */
    label: string;
    /** Short description shown under the label. */
    description: string;
}

/**
 * Available cut style options.
 */
export const CUT_STYLE_OPTIONS: readonly CutStyleOption[] = [
    {
        id: 'classic',
        label: 'Classic',
        description: 'Traditional jigsaw tabs',
    },
    {
        id: 'fractal',
        label: 'Fractal',
        description: 'Organic circle-packing',
    },
    {
        id: 'composable',
        label: 'Composable',
        description: 'Experimental — customizable cuts',
    },
] as const;

/** Default cut style index (Classic). */
export const DEFAULT_CUT_STYLE_INDEX = 0;

/** localStorage key for the saved cut style preference. */
export const CUT_STYLE_PREFERENCE_KEY = 'puzzle-cut-style';

const store = createIndexedPreferenceStore({
    key: CUT_STYLE_PREFERENCE_KEY,
    presets: CUT_STYLE_OPTIONS,
    defaultIndex: DEFAULT_CUT_STYLE_INDEX,
});

/**
 * Get the cut style option at the given index,
 * or the default if the index is out of range.
 */
export const getCutStyleOption = store.getPreset;

/**
 * Find the index of a cut style option by its id.
 * Returns the default index if not found.
 */
export function findCutStyleIndex(style: CutStyle): number {
    const index = CUT_STYLE_OPTIONS.findIndex((opt) => opt.id === style);

    return index >= 0 ? index : DEFAULT_CUT_STYLE_INDEX;
}

/**
 * Save the preferred cut style index to localStorage.
 */
export const saveCutStylePreference = store.save;

/**
 * Load the preferred cut style index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export const loadCutStylePreference = store.load;
