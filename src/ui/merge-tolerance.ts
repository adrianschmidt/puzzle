/**
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
 * A known cut style, or any other string.
 *
 * `CutStyle | string` collapses to `string` — the linter is right about that —
 * so the `& {}` is what keeps the union from being flattened, preserving
 * autocomplete on the four known styles while still accepting the bare
 * `string` that `GameState.cutStyle` is declared as. Plain `string` also
 * satisfies the linter, so deleting the `CutStyle |` half looks free and is
 * not: it silently drops the only place naming the intended domain.
 */
export type CutStyleOrOther = CutStyle | (string & {});

export interface MergeTolerancePreset {
    id: string;
    label: string;
    description: string;
    /** Tolerance as a fraction of the reference piece width. */
    fraction: number;
    /**
     * Maximum angular misalignment (in degrees) at which two free-rotation
     * groups can still merge. In quarter-turn mode the rotations are always
     * exactly equal, so this value is effectively a no-op there.
     */
    rotationDegrees: number;
    displayOrder: number;
}

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

export const DEFAULT_TOLERANCE_ID = 'normal';

/**
 * Pre-migration storage order — DO NOT reorder. Used by the loader to
 * translate legacy integer indices to ids.
 */
const LEGACY_ORDER = ['strict', 'forgiving', 'normal'] as const;

export function getSortedPresets(): readonly MergeTolerancePreset[] {
    return [...MERGE_TOLERANCE_PRESETS].sort(
        (a, b) => a.displayOrder - b.displayOrder,
    );
}

export const TOLERANCE_PREFERENCE_KEY = 'puzzle-merge-tolerance';

const store = createIdPreferenceStore({
    key: TOLERANCE_PREFERENCE_KEY,
    presets: MERGE_TOLERANCE_PRESETS,
    defaultId: DEFAULT_TOLERANCE_ID,
    legacyOrder: LEGACY_ORDER,
});

export const getTolerancePreset = store.getPreset;

export const saveTolerancePreference = store.save;

export const loadTolerancePreference = store.load;

/**
 * Applied on top of the preset fraction to allow each puzzle style
 * to feel right without exposing extra UI to the player.
 */
const STYLE_SNAP_MULTIPLIERS: Record<string, number> = {
    classic: 1.0,
    fractal: 1.0,
    composable: 1.0,
    wavy: 1.0,
};

export function getStyleSnapMultiplier(style: CutStyleOrOther): number {
    return STYLE_SNAP_MULTIPLIERS[style] ?? 1.0;
}

export function getReferencePieceWidth(
    imageWidth: number,
    cols: number,
): number {
    return imageWidth / cols;
}

/** Result is in pixels. */
export function getActiveTolerance(
    imageWidth: number,
    cols: number,
    cutStyle: CutStyleOrOther = 'classic',
): number {
    const preset = getTolerancePreset(loadTolerancePreference());
    const pieceWidth = getReferencePieceWidth(imageWidth, cols);
    const styleMultiplier = getStyleSnapMultiplier(cutStyle);
    return preset.fraction * pieceWidth * styleMultiplier;
}

/** Result is in degrees. */
export function getActiveRotationTolerance(): number {
    return getTolerancePreset(loadTolerancePreference()).rotationDegrees;
}
