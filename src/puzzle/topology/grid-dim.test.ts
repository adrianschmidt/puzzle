import { describe, it, expect } from 'vitest';
import { MAX_GRID_DIM, clampGridDim } from './grid-dim.js';

describe('clampGridDim', () => {
    it('leaves an in-range integer untouched', () => {
        expect(clampGridDim(1)).toBe(1);
        expect(clampGridDim(12)).toBe(12);
        expect(clampGridDim(MAX_GRID_DIM)).toBe(MAX_GRID_DIM);
    });

    it('caps anything above the ceiling at MAX_GRID_DIM', () => {
        expect(clampGridDim(MAX_GRID_DIM + 1)).toBe(MAX_GRID_DIM);
        expect(clampGridDim(1e9)).toBe(MAX_GRID_DIM);
        expect(clampGridDim(Infinity)).toBe(1); // non-finite → 1, not the cap
    });

    it('raises sub-1 and non-finite values to 1', () => {
        expect(clampGridDim(0)).toBe(1);
        expect(clampGridDim(-5)).toBe(1);
        expect(clampGridDim(NaN)).toBe(1);
        expect(clampGridDim(-Infinity)).toBe(1);
    });

    it('floors fractional dimensions', () => {
        expect(clampGridDim(3.9)).toBe(3);
        expect(clampGridDim(63.99)).toBe(63);
    });

    it('keeps the ceiling generously above the UI grid cap (16×12)', () => {
        // Guards against anyone lowering MAX_GRID_DIM into the range of a real
        // puzzle, which would silently re-clamp legitimate geometry.
        expect(MAX_GRID_DIM).toBeGreaterThanOrEqual(16);
    });
});
