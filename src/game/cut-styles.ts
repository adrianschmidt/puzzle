/**
 * Cut style options and preference persistence.
 *
 * Each option carries a stable string id used in localStorage.
 * Legacy integer indices migrate via the id-keyed factory.
 */

import { createIdPreferenceStore } from '../ui/preference-store.js';

/**
 * Identifier for a cut style generator.
 */
export type CutStyle = 'classic' | 'fractal' | 'composable';

/**
 * A selectable cut style option.
 */
export interface CutStyleOption {
    id: CutStyle;
    label: string;
    description: string;
}

/**
 * Available cut style options.
 *
 * Storage is id-keyed; declaration order is no longer load-bearing for
 * persistence. The legacy-integer migration (`LEGACY_ORDER` below)
 * relies on the original pre-migration order, captured separately.
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

/** Default cut style id. */
export const DEFAULT_CUT_STYLE_ID: CutStyle = 'classic';

/** localStorage key for the saved cut style preference. */
export const CUT_STYLE_PREFERENCE_KEY = 'puzzle-cut-style';

/**
 * Pre-migration storage order — DO NOT reorder. Drop in a follow-up
 * release once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = ['classic', 'fractal', 'composable'] as const;

const store = createIdPreferenceStore({
    key: CUT_STYLE_PREFERENCE_KEY,
    presets: CUT_STYLE_OPTIONS,
    defaultId: DEFAULT_CUT_STYLE_ID,
    legacyOrder: LEGACY_ORDER,
});

export const getCutStyleOption = store.getPreset;
export const saveCutStylePreference = store.save;
export const loadCutStylePreference = store.load;
