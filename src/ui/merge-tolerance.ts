/**
 * Tolerance is a fraction of the reference piece width (imageWidth / cols), so
 * it feels consistent across puzzle size and resolution. Each preset has a
 * stable string `id` in localStorage; legacy integer indices (0=strict,
 * 1=forgiving, 2=normal) still load via createIdPreferenceStore's legacy-order.
 */

import type { CutStyle } from '../game/cut-styles.js';


import { createIdPreferenceStore } from './preference-store.js';

/**
 * A known cut style, or any other string. The `& {}` stops `CutStyle | string`
 * from collapsing to `string`, preserving autocomplete on the known styles while
 * still accepting the bare `string`. Deleting the `CutStyle |` half looks free
 * but drops the only place naming the intended domain.
 */
export type CutStyleOrOther = CutStyle | (string & {});

export interface MergeTolerancePreset {
    id: string;
    label: string;
    description: string;
    /** Tolerance as a fraction of the reference piece width. */
    fraction: number;
    /**
     * Max angular misalignment (degrees) at which two free-rotation groups can
     * still merge. In quarter-turn mode rotations are always equal, so it's a
     * no-op there.
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
 * Pre-migration storage order — DO NOT reorder. The loader maps legacy integer
 * indices to ids by position.
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
 * Per-style multipliers on the preset snap fraction. Empty by design —
 * unlisted styles use the 1.0 fallback; add an entry only when a style needs a
 * different value to feel the same.
 */
const STYLE_SNAP_MULTIPLIERS: Record<string, number> = {};

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
