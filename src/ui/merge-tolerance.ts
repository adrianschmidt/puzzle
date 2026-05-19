/**
 * Merge tolerance presets and persistence.
 *
 * Controls how close pieces need to be before they snap together.
 * Tolerance is expressed as a fraction of the reference piece width
 * (imageWidth / cols), so it feels consistent regardless of puzzle
 * size or image resolution.
 *
 * Storage format: each preset has a stable string `id` written to
 * localStorage. Legacy integer indices (pre-migration:
 * 0=strict, 1=forgiving, 2=normal) still load via the
 * `createIdPreferenceStore` factory's legacy-order translation.
 */

import type { CutStyle } from '../game/cut-styles.js';
import { createIdPreferenceStore } from './preference-store.js';

/**
 * A merge tolerance preset.
 */
export interface MergeTolerancePreset {
    /** Stable string identifier used in localStorage. */
    id: string;
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
 * Array order matches the pre-migration storage indices so the
 * legacy-index loader translates correctly. New presets can be
 * appended freely now that storage is id-keyed.
 */
export const MERGE_TOLERANCE_PRESETS: readonly MergeTolerancePreset[] = [
    {
        id: 'strict',
        label: 'Strict',
        description: 'Pieces must be very close to snap',
        fraction: 0.133,
        rotationDegrees: 10,
        displayOrder: 0,
    },
    {
        id: 'forgiving',
        label: 'Forgiving',
        description: 'Pieces snap from further away',
        fraction: 0.533,
        rotationDegrees: 40,
        displayOrder: 2,
    },
    {
        id: 'normal',
        label: 'Normal',
        description: 'Standard snapping distance',
        fraction: 0.333,
        rotationDegrees: 20,
        displayOrder: 1,
    },
] as const;

/** Default preset id. */
export const DEFAULT_TOLERANCE_ID = 'normal';

/**
 * Pre-migration storage order — DO NOT reorder. Used by the loader to
 * translate legacy integer indices to ids. Drop in a follow-up release
 * once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = ['strict', 'forgiving', 'normal'] as const;

/**
 * Return the presets sorted by `displayOrder`, ready for rendering.
 */
export function getSortedPresets(): readonly MergeTolerancePreset[] {
    return [...MERGE_TOLERANCE_PRESETS].sort(
        (a, b) => a.displayOrder - b.displayOrder,
    );
}

/** localStorage key for the saved merge tolerance preference. */
export const TOLERANCE_PREFERENCE_KEY = 'puzzle-merge-tolerance';

const store = createIdPreferenceStore({
    key: TOLERANCE_PREFERENCE_KEY,
    presets: MERGE_TOLERANCE_PRESETS,
    defaultId: DEFAULT_TOLERANCE_ID,
    legacyOrder: LEGACY_ORDER,
});

/** Get the preset for an id, or the default preset for an unknown id. */
export const getTolerancePreset = store.getPreset;

/** Save the preferred merge tolerance id to localStorage. */
export const saveTolerancePreference = store.save;

/** Load the preferred merge tolerance id from localStorage. */
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
    wavy: 1.0,
};

/**
 * Get the snap distance multiplier for a given cut style.
 */
export function getStyleSnapMultiplier(style: CutStyle | string): number {
    return STYLE_SNAP_MULTIPLIERS[style] ?? 1.0;
}

/**
 * Compute the reference piece width for snap distance calculation.
 */
export function getReferencePieceWidth(
    imageWidth: number,
    cols: number,
): number {
    return imageWidth / cols;
}

/**
 * Get the current merge tolerance in pixels.
 */
export function getActiveTolerance(
    imageWidth: number,
    cols: number,
    cutStyle: CutStyle | string = 'classic',
): number {
    const preset = getTolerancePreset(loadTolerancePreference());
    const pieceWidth = getReferencePieceWidth(imageWidth, cols);
    const styleMultiplier = getStyleSnapMultiplier(cutStyle);
    return preset.fraction * pieceWidth * styleMultiplier;
}

/**
 * Get the current merge rotation tolerance in degrees.
 */
export function getActiveRotationTolerance(): number {
    return getTolerancePreset(loadTolerancePreference()).rotationDegrees;
}
