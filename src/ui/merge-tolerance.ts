/**
 * Merge tolerance presets and persistence.
 *
 * Controls how close pieces need to be before they snap together.
 * Tolerance is expressed as a fraction of the reference piece width
 * (imageWidth / cols), so it feels consistent regardless of puzzle
 * size or image resolution.
 *
 * Storage format: preset index in localStorage. Indices are append-only
 * to avoid breaking existing saved preferences.
 *
 * Storage layout (append-only — do NOT reorder):
 *   0 = Strict  (was "Normal" before relative snap)
 *   1 = Forgiving
 *   2 = Normal  (new default, added with relative snap)
 */

import type { CutStyle } from '../game/cut-styles.js';
import { createIndexedPreferenceStore } from './preference-store.js';

/**
 * A merge tolerance preset.
 */
export interface MergeTolerancePreset {
    /** Display label */
    label: string;
    /** Description shown to the player */
    description: string;
    /** Tolerance as a fraction of the reference piece width. */
    fraction: number;
    /**
     * Maximum angular misalignment (in degrees) at which two free-rotation
     * groups can still merge. In quarter-turn mode the rotations are always
     * exactly equal, so this value is effectively a no-op there.
     */
    rotationDegrees: number;
    /** Sort order for display in the UI (lowest first). */
    displayOrder: number;
}

/**
 * Available merge tolerance presets.
 *
 * IMPORTANT: indices are persisted in localStorage.
 * Always APPEND new presets — never reorder or remove existing ones.
 */
export const MERGE_TOLERANCE_PRESETS: readonly MergeTolerancePreset[] = [
    {
        label: 'Strict',
        description: 'Pieces must be very close to snap',
        fraction: 0.133,
        rotationDegrees: 10,
        displayOrder: 0,
    },
    {
        label: 'Forgiving',
        description: 'Pieces snap from further away',
        fraction: 0.533,
        rotationDegrees: 40,
        displayOrder: 2,
    },
    {
        label: 'Normal',
        description: 'Standard snapping distance',
        fraction: 0.333,
        rotationDegrees: 20,
        displayOrder: 1,
    },
] as const;

/** Default preset index (Normal — index 2). */
export const DEFAULT_TOLERANCE_INDEX = 2;

/**
 * Get the presets sorted by displayOrder for rendering in the UI.
 * Each entry includes the original storage index.
 */
export function getSortedPresets(): Array<{
    preset: MergeTolerancePreset;
    storageIndex: number;
}> {
    return MERGE_TOLERANCE_PRESETS
        .map((preset, storageIndex) => ({ preset, storageIndex }))
        .sort((a, b) => a.preset.displayOrder - b.preset.displayOrder);
}

/** localStorage key for the saved merge tolerance preference. */
export const TOLERANCE_PREFERENCE_KEY = 'puzzle-merge-tolerance';

const store = createIndexedPreferenceStore({
    key: TOLERANCE_PREFERENCE_KEY,
    presets: MERGE_TOLERANCE_PRESETS,
    defaultIndex: DEFAULT_TOLERANCE_INDEX,
});

/**
 * Get the preset at the given index,
 * or the default if the index is out of range.
 */
export const getTolerancePreset = store.getPreset;

/**
 * Save the preferred merge tolerance index to localStorage.
 */
export const saveTolerancePreference = store.save;

/**
 * Load the preferred merge tolerance index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export const loadTolerancePreference = store.load;

/**
 * Per-style snap distance multiplier.
 *
 * Applied on top of the preset fraction to allow each puzzle style
 * to feel right without exposing extra UI to the player.
 * Default is 1.0 for all styles; tweak as needed.
 */
const STYLE_SNAP_MULTIPLIERS: Record<string, number> = {
    classic: 1.0,
    fractal: 1.0,
    composable: 1.0,
};

/**
 * Get the snap distance multiplier for a given cut style.
 */
export function getStyleSnapMultiplier(style: CutStyle | string): number {
    return STYLE_SNAP_MULTIPLIERS[style] ?? 1.0;
}

/**
 * Compute the reference piece width for snap distance calculation.
 *
 * Uses imageWidth / cols — the nominal piece width for a grid-based
 * puzzle. This is consistent across all styles, including fractal
 * (which still has a nominal grid size).
 */
export function getReferencePieceWidth(
    imageWidth: number,
    cols: number,
): number {
    return imageWidth / cols;
}

/**
 * Get the current merge tolerance in pixels.
 *
 * @param imageWidth - Width of the puzzle image in pixels
 * @param cols - Number of grid columns
 * @param cutStyle - The active cut style (for per-style multiplier)
 */
export function getActiveTolerance(
    imageWidth: number,
    cols: number,
    cutStyle: CutStyle | string = 'classic',
): number {
    const index = loadTolerancePreference();
    const preset = getTolerancePreset(index);
    const pieceWidth = getReferencePieceWidth(imageWidth, cols);
    const styleMultiplier = getStyleSnapMultiplier(cutStyle);

    return preset.fraction * pieceWidth * styleMultiplier;
}

/**
 * Get the current merge rotation tolerance in degrees.
 *
 * Read from the same Strict/Normal/Forgiving preset as the position
 * tolerance, so a single user-facing setting controls both.
 */
export function getActiveRotationTolerance(): number {
    const index = loadTolerancePreference();
    const preset = getTolerancePreset(index);
    return preset.rotationDegrees;
}
