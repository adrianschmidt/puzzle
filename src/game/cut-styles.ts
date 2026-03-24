/**
 * Cut style options and preference persistence.
 *
 * Defines the available puzzle cut styles and saves/loads
 * the player's preferred style from localStorage.
 */

/**
 * Identifier for a cut style generator.
 */
export type CutStyle = 'classic' | 'fractal';

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
] as const;

/** Default cut style index (Classic). */
export const DEFAULT_CUT_STYLE_INDEX = 0;

/** localStorage key for the saved cut style preference. */
export const CUT_STYLE_PREFERENCE_KEY = 'puzzle-cut-style';

/**
 * Get the cut style option at the given index,
 * or the default if the index is out of range.
 */
export function getCutStyleOption(index: number): CutStyleOption {
    if (index >= 0 && index < CUT_STYLE_OPTIONS.length) {
        return CUT_STYLE_OPTIONS[index];
    }

    return CUT_STYLE_OPTIONS[DEFAULT_CUT_STYLE_INDEX];
}

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
export function saveCutStylePreference(index: number): void {
    localStorage.setItem(CUT_STYLE_PREFERENCE_KEY, String(index));
}

/**
 * Load the preferred cut style index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export function loadCutStylePreference(): number {
    try {
        const raw = localStorage.getItem(CUT_STYLE_PREFERENCE_KEY);
        if (raw === null) {
            return DEFAULT_CUT_STYLE_INDEX;
        }

        const index = parseInt(raw, 10);
        if (Number.isNaN(index) || index < 0 || index >= CUT_STYLE_OPTIONS.length) {
            return DEFAULT_CUT_STYLE_INDEX;
        }

        return index;
    } catch {
        return DEFAULT_CUT_STYLE_INDEX;
    }
}
