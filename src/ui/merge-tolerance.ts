/**
 * Merge tolerance presets and persistence.
 *
 * Controls how close pieces need to be before they snap together.
 * "Normal" is the default (~18px), "Forgiving" is larger (~30px)
 * for casual players who want easier merging.
 */

import { MERGE_TOLERANCE_PX } from '../game/merge-detection.js';

/**
 * A merge tolerance preset.
 */
export interface MergeTolerancePreset {
    /** Display label */
    label: string;
    /** Description shown to the player */
    description: string;
    /** Tolerance in pixels */
    tolerance: number;
}

/**
 * Available merge tolerance presets.
 */
export const MERGE_TOLERANCE_PRESETS: readonly MergeTolerancePreset[] = [
    {
        label: 'Normal',
        description: 'Standard snapping distance',
        tolerance: MERGE_TOLERANCE_PX,
    },
    {
        label: 'Forgiving',
        description: 'Pieces snap from further away',
        tolerance: MERGE_TOLERANCE_PX * 4,
    },
] as const;

/** Default preset index (Normal). */
export const DEFAULT_TOLERANCE_INDEX = 0;

/** localStorage key for the saved merge tolerance preference. */
export const TOLERANCE_PREFERENCE_KEY = 'puzzle-merge-tolerance';

/**
 * Get the preset at the given index,
 * or the default if the index is out of range.
 */
export function getTolerancePreset(index: number): MergeTolerancePreset {
    if (index >= 0 && index < MERGE_TOLERANCE_PRESETS.length) {
        return MERGE_TOLERANCE_PRESETS[index];
    }

    return MERGE_TOLERANCE_PRESETS[DEFAULT_TOLERANCE_INDEX];
}

/**
 * Save the preferred merge tolerance index to localStorage.
 */
export function saveTolerancePreference(index: number): void {
    localStorage.setItem(TOLERANCE_PREFERENCE_KEY, String(index));
}

/**
 * Load the preferred merge tolerance index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export function loadTolerancePreference(): number {
    try {
        const raw = localStorage.getItem(TOLERANCE_PREFERENCE_KEY);
        if (raw === null) {
            return DEFAULT_TOLERANCE_INDEX;
        }

        const index = parseInt(raw, 10);
        if (
            Number.isNaN(index) ||
            index < 0 ||
            index >= MERGE_TOLERANCE_PRESETS.length
        ) {
            return DEFAULT_TOLERANCE_INDEX;
        }

        return index;
    } catch {
        return DEFAULT_TOLERANCE_INDEX;
    }
}

/**
 * Get the current merge tolerance in pixels based on the saved preference.
 */
export function getActiveTolerance(): number {
    const index = loadTolerancePreference();

    return getTolerancePreset(index).tolerance;
}
