/**
 * Puzzle size options and preference persistence.
 *
 * Defines the available puzzle sizes and saves/loads
 * the player's preferred size from localStorage.
 */

import type { GridSize } from '../model/types.js';
import { createIndexedPreferenceStore } from '../ui/preference-store.js';

/**
 * A selectable puzzle size option.
 */
export interface PuzzleSizeOption {
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
 * Listed from smallest to largest.
 */
export const PUZZLE_SIZE_OPTIONS: readonly PuzzleSizeOption[] = [
    { label: '24 pieces', pieceCount: 24, cols: 6, rows: 4 },
    { label: '48 pieces', pieceCount: 48, cols: 8, rows: 6 },
    { label: '96 pieces', pieceCount: 96, cols: 12, rows: 8 },
    { label: '192 pieces', pieceCount: 192, cols: 16, rows: 12 },
] as const;

/** Default size index (48 pieces — the original default). */
export const DEFAULT_SIZE_INDEX = 1;

/** localStorage key for the saved size preference. */
export const SIZE_PREFERENCE_KEY = 'puzzle-size-preference';

const store = createIndexedPreferenceStore({
    key: SIZE_PREFERENCE_KEY,
    presets: PUZZLE_SIZE_OPTIONS,
    defaultIndex: DEFAULT_SIZE_INDEX,
});

/**
 * Get the puzzle size option at the given index,
 * or the default if the index is out of range.
 */
export const getSizeOption = store.getPreset;

/**
 * Convert a PuzzleSizeOption to a GridSize.
 */
export function toGridSize(option: PuzzleSizeOption): GridSize {
    return { cols: option.cols, rows: option.rows };
}

/**
 * Find the index of a size option matching the given grid size.
 * Returns -1 if no match is found.
 */
export function findSizeIndex(gridSize: GridSize): number {
    return PUZZLE_SIZE_OPTIONS.findIndex(
        (opt) => opt.cols === gridSize.cols && opt.rows === gridSize.rows,
    );
}

/**
 * Save the preferred puzzle size index to localStorage.
 */
export const saveSizePreference = store.save;

/**
 * Load the preferred puzzle size index from localStorage.
 * Returns the default index if nothing is saved or the value is invalid.
 */
export const loadSizePreference = store.load;
