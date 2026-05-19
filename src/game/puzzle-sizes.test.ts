/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    PUZZLE_SIZE_OPTIONS,
    DEFAULT_SIZE_ID,
    SIZE_PREFERENCE_KEY,
    getSizeOption,
    toGridSize,
    findSizeId,
    saveSizePreference,
    loadSizePreference,
} from './puzzle-sizes.js';

describe('PUZZLE_SIZE_OPTIONS', () => {
    it('has 4 size options', () => {
        expect(PUZZLE_SIZE_OPTIONS).toHaveLength(4);
    });

    it('each option has correct pieceCount = cols × rows', () => {
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

    it('uses pieceCount string as the id', () => {
        const ids = PUZZLE_SIZE_OPTIONS.map((o) => o.id);
        expect(ids).toEqual(['24', '48', '96', '192']);
    });

    it('default id is "48"', () => {
        expect(DEFAULT_SIZE_ID).toBe('48');
    });
});

describe('getSizeOption', () => {
    it('returns the option matching an id', () => {
        expect(getSizeOption('24').pieceCount).toBe(24);
        expect(getSizeOption('96').pieceCount).toBe(96);
    });

    it('returns the default for an unknown id', () => {
        const opt = getSizeOption('not-a-size');
        expect(opt.pieceCount).toBe(48);
    });
});

describe('toGridSize', () => {
    it('converts a size option to a GridSize', () => {
        const opt = getSizeOption('96');
        expect(toGridSize(opt)).toEqual({ cols: 12, rows: 8 });
    });
});

describe('findSizeId', () => {
    it('finds the id for a known grid size', () => {
        expect(findSizeId({ cols: 8, rows: 6 })).toBe('48');
    });

    it('returns undefined for an unknown grid size', () => {
        expect(findSizeId({ cols: 10, rows: 10 })).toBeUndefined();
    });
});

describe('saveSizePreference / loadSizePreference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('saves and loads an id', () => {
        saveSizePreference('96');
        expect(loadSizePreference()).toBe('96');
    });

    it('returns default when nothing is saved', () => {
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
    });

    it('migrates legacy integer indices to ids', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, '0');
        expect(loadSizePreference()).toBe('24');
        localStorage.setItem(SIZE_PREFERENCE_KEY, '2');
        expect(loadSizePreference()).toBe('96');
    });

    it('returns default for unknown stored values', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, 'garbage');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
    });

    it('returns default for out-of-range legacy values', () => {
        localStorage.setItem(SIZE_PREFERENCE_KEY, '99');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
        localStorage.setItem(SIZE_PREFERENCE_KEY, '-1');
        expect(loadSizePreference()).toBe(DEFAULT_SIZE_ID);
    });
});
