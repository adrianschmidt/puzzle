/**
 * @vitest-environment jsdom
 */

/**
 * Tests for puzzle size options and preference persistence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PUZZLE_SIZE_OPTIONS,
    DEFAULT_SIZE_INDEX,
    SIZE_PREFERENCE_KEY,
    getSizeOption,
    toGridSize,
    findSizeIndex,
    saveSizePreference,
    loadSizePreference,
} from './puzzle-sizes.js';

describe('PUZZLE_SIZE_OPTIONS', () => {
    it('has 4 size options', () => {
        expect(PUZZLE_SIZE_OPTIONS).toHaveLength(4);
    });

    it('each option has correct piece count (cols × rows)', () => {
        for (const opt of PUZZLE_SIZE_OPTIONS) {
            expect(opt.pieceCount).toBe(opt.cols * opt.rows);
        }
    });

    it('is sorted from smallest to largest', () => {
        for (let i = 1; i < PUZZLE_SIZE_OPTIONS.length; i++) {
            expect(PUZZLE_SIZE_OPTIONS[i].pieceCount).toBeGreaterThan(
                PUZZLE_SIZE_OPTIONS[i - 1].pieceCount,
            );
        }
    });

    it('contains the expected sizes', () => {
        const counts = PUZZLE_SIZE_OPTIONS.map((o) => o.pieceCount);
        expect(counts).toEqual([24, 48, 96, 192]);
    });
});

describe('getSizeOption', () => {
    it('returns the option at the given index', () => {
        const opt = getSizeOption(0);
        expect(opt.pieceCount).toBe(24);
    });

    it('returns the default for out-of-range index', () => {
        const opt = getSizeOption(99);
        expect(opt).toBe(PUZZLE_SIZE_OPTIONS[DEFAULT_SIZE_INDEX]);
    });

    it('returns the default for negative index', () => {
        const opt = getSizeOption(-1);
        expect(opt).toBe(PUZZLE_SIZE_OPTIONS[DEFAULT_SIZE_INDEX]);
    });
});

describe('toGridSize', () => {
    it('converts a size option to a GridSize', () => {
        const opt = PUZZLE_SIZE_OPTIONS[2]; // 96 pieces: 12×8
        const gridSize = toGridSize(opt);
        expect(gridSize).toEqual({ cols: 12, rows: 8 });
    });
});

describe('findSizeIndex', () => {
    it('finds the index for a known grid size', () => {
        expect(findSizeIndex({ cols: 8, rows: 6 })).toBe(1);
    });

    it('returns -1 for an unknown grid size', () => {
        expect(findSizeIndex({ cols: 10, rows: 10 })).toBe(-1);
    });
});

describe('saveSizePreference / loadSizePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads a preference', () => {
        saveSizePreference(2);
        expect(loadSizePreference()).toBe(2);
    });

    it('returns the default when nothing is saved', () => {
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_INDEX);
    });

    it('returns the default for invalid saved value', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, 'garbage');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_INDEX);
    });

    it('returns the default for out-of-range saved value', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, '99');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_INDEX);
    });

    it('returns the default for negative saved value', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, '-1');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_INDEX);
    });
});
