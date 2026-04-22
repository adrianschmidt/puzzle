import { describe, it, expect } from 'vitest';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import { computeMergedOffsets } from './reconstruct-groups.js';

describe('computeMergedOffsets', () => {
    it('computes offsets for a two-piece horizontal merge that match the generator layout', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 and piece 1 are horizontally adjacent in the top row.
        const offsets = computeMergedOffsets(pieces, [0, 1]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        const off1 = offsets!.get(1)!;
        expect(off1.x).toBeCloseTo(100, 3);
        expect(off1.y).toBeCloseTo(0, 3);
    });

    it('computes offsets for a three-piece L-shape', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 top-left, piece 1 right of it, piece 4 below piece 0.
        const offsets = computeMergedOffsets(pieces, [0, 1, 4]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        const off1 = offsets!.get(1)!;
        const off4 = offsets!.get(4)!;
        expect(off1.x).toBeCloseTo(100, 3);
        expect(off1.y).toBeCloseTo(0, 3);
        expect(off4.x).toBeCloseTo(0, 3);
        expect(off4.y).toBeCloseTo(100, 3);
    });

    it('traverses a three-piece horizontal chain via BFS', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Pieces 0, 1, 2 form a chain along the top row. Piece 2 is only
        // reachable from the anchor (0) via piece 1 — a BFS that stopped
        // after processing the anchor's direct neighbours would fail.
        const offsets = computeMergedOffsets(pieces, [0, 1, 2]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        expect(offsets!.get(1)!.x).toBeCloseTo(100, 3);
        expect(offsets!.get(1)!.y).toBeCloseTo(0, 3);
        expect(offsets!.get(2)!.x).toBeCloseTo(200, 3);
        expect(offsets!.get(2)!.y).toBeCloseTo(0, 3);
    });

    it('returns null for a disconnected piece set', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 and piece 2 are not adjacent.
        expect(computeMergedOffsets(pieces, [0, 2])).toBeNull();
    });

    it('returns null when a piece id is not in the puzzle', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        expect(computeMergedOffsets(pieces, [0, 999])).toBeNull();
    });

    it('returns a single-entry map for a one-piece group', () => {
        const pieces = generateProceduralPuzzle(4, 3, { width: 400, height: 300 }, 123);
        const offsets = computeMergedOffsets(pieces, [5]);
        expect(offsets!.size).toBe(1);
        expect(offsets!.get(5)).toEqual({ x: 0, y: 0 });
    });
});
