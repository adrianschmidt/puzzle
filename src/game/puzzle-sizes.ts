/**
 * Puzzle size options and persistence.
 *
 * Each option carries a stable string `id` (the piece count as a
 * string). Legacy integer indices migrate via the id-keyed factory.
 */

import type { GridSize } from '../model/types.js';
import { createIdPreferenceStore } from '../ui/preference-store.js';

export interface PuzzleSizeOption {
    /** Stable string id (the piece count as a string). */
    id: string;
    /** Display label, e.g. "48 pieces" */
    label: string;
    /** Total number of pieces */
    pieceCount: number;
    /** Grid columns */
    cols: number;
    /** Grid rows */
    rows: number;
}

/**
 * Available puzzle size options.
 *
 * Storage is id-keyed; declaration order is no longer load-bearing for
 * persistence. The legacy-integer migration (`LEGACY_ORDER` below)
 * relies on the original pre-migration order, captured separately.
 */
export const PUZZLE_SIZE_OPTIONS: readonly PuzzleSizeOption[] = [
    { id: '24',  label: '24 pieces',  pieceCount: 24,  cols: 6,  rows: 4 },
    { id: '48',  label: '48 pieces',  pieceCount: 48,  cols: 8,  rows: 6 },
    { id: '96',  label: '96 pieces',  pieceCount: 96,  cols: 12, rows: 8 },
    { id: '192', label: '192 pieces', pieceCount: 192, cols: 16, rows: 12 },
] as const;

/** Default size id (48 pieces — the original default). */
export const DEFAULT_SIZE_ID = '48';

/** localStorage key for the saved size preference. */
export const SIZE_PREFERENCE_KEY = 'puzzle-size-preference';

/**
 * Pre-migration storage order — DO NOT reorder. Drop in a follow-up
 * release once enough users have loaded the migrated build.
 */
const LEGACY_ORDER = ['24', '48', '96', '192'] as const;

const store = createIdPreferenceStore({
    key: SIZE_PREFERENCE_KEY,
    presets: PUZZLE_SIZE_OPTIONS,
    defaultId: DEFAULT_SIZE_ID,
    legacyOrder: LEGACY_ORDER,
});

/** Get the option for an id, or the default option. */
export const getSizeOption = store.getPreset;

/** Convert a PuzzleSizeOption to a GridSize. */
export function toGridSize(option: PuzzleSizeOption): GridSize {
    return { cols: option.cols, rows: option.rows };
}

/**
 * Find the id of the option matching the given grid size.
 * Returns undefined if no match is found.
 */
export function findSizeId(gridSize: GridSize): string | undefined {
    return PUZZLE_SIZE_OPTIONS.find(
        (opt) => opt.cols === gridSize.cols && opt.rows === gridSize.rows,
    )?.id;
}

export const saveSizePreference = store.save;
export const loadSizePreference = store.load;
