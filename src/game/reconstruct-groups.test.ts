import { describe, it, expect } from 'vitest';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import { computeMergedOffsets, applyProgress } from './reconstruct-groups.js';
import { createNewGame } from './init.js';
import type { GameState } from '../model/types.js';

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

function fresh(seed: number, rotationMode: 'none' | 'quarter-turn' | 'free' = 'none'): GameState {
    return createNewGame(
        'blank',
        { width: 400, height: 300 },
        { width: 800, height: 600 },
        { cols: 4, rows: 3 },
        { cutStyle: 'classic', seed, rotationMode },
    );
}

describe('applyProgress', () => {
    it('merges the listed piece groups into one multi-piece group', () => {
        const state = fresh(123);
        const originalGroupCount = state.groups.length;

        const ok = applyProgress(state, { m: [[0, 1]] });
        expect(ok).toBe(true);

        expect(state.groups.length).toBe(originalGroupCount - 1);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged).toBeDefined();
        expect([...merged!.pieces.keys()].sort()).toEqual([0, 1]);
    });

    it('restores merged-group rotation when rotation mode is on', () => {
        const state = fresh(123, 'quarter-turn');
        const ok = applyProgress(state, { m: [[0, 1]], mr: [2] });
        expect(ok).toBe(true);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged!.rotation).toBe(180);
    });

    it('restores solo-piece rotations from sr', () => {
        const state = fresh(123, 'quarter-turn');
        // Force all solo rotations to a known baseline (0) before the test.
        for (const g of state.groups) g.rotation = 0;

        const ok = applyProgress(state, { m: [], sr: [2, 1, 5, 3] });
        expect(ok).toBe(true);
        const soloFor = (pid: number) =>
            state.groups.find((g) => g.pieces.size === 1 && g.pieces.has(pid))!;
        expect(soloFor(2).rotation).toBe(90);
        expect(soloFor(5).rotation).toBe(270);
    });

    it('restores merged-group rotation in free mode (wire value is degrees, not quarter-turns)', () => {
        const state = fresh(123, 'free');
        const ok = applyProgress(state, { m: [[0, 1]], mr: [135] });
        expect(ok).toBe(true);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged!.rotation).toBe(135);
    });

    it('restores solo-piece rotations in free mode from sr', () => {
        const state = fresh(123, 'free');
        for (const g of state.groups) g.rotation = 0;

        const ok = applyProgress(state, { m: [], sr: [2, 47, 5, 312] });
        expect(ok).toBe(true);
        const soloFor = (pid: number) =>
            state.groups.find((g) => g.pieces.size === 1 && g.pieces.has(pid))!;
        expect(soloFor(2).rotation).toBe(47);
        expect(soloFor(5).rotation).toBe(312);
    });

    it('normalises out-of-range free-mode mr values into [0, 360)', () => {
        // The encoder always emits values in [0, 360), but a hand-edited
        // share link could plant negatives or values ≥ 360. Mirror the
        // encoder's clamp on read so they don't reach group.rotation.
        const state = fresh(123, 'free');
        const ok = applyProgress(state, { m: [[0, 1]], mr: [-90] });
        expect(ok).toBe(true);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged!.rotation).toBe(270);
    });

    it('normalises out-of-range free-mode sr values into [0, 360)', () => {
        const state = fresh(123, 'free');
        for (const g of state.groups) g.rotation = 0;

        const ok = applyProgress(state, { m: [], sr: [2, 720, 5, -45] });
        expect(ok).toBe(true);
        const soloFor = (pid: number) =>
            state.groups.find((g) => g.pieces.size === 1 && g.pieces.has(pid))!;
        expect(soloFor(2).rotation).toBe(0);
        expect(soloFor(5).rotation).toBe(315);
    });

    it('quarter-turn mode is unchanged: mr: [2] decodes to 180°', () => {
        const state = fresh(123, 'quarter-turn');
        const ok = applyProgress(state, { m: [[0, 1]], mr: [2] });
        expect(ok).toBe(true);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged!.rotation).toBe(180);
    });

    it('returns false if any group references a missing piece id', () => {
        const state = fresh(123);
        const ok = applyProgress(state, { m: [[0, 999]] });
        expect(ok).toBe(false);
    });

    it('returns false if any group references disconnected pieces', () => {
        const state = fresh(123);
        // Pieces 0 and 2 are not adjacent.
        const ok = applyProgress(state, { m: [[0, 2]] });
        expect(ok).toBe(false);
    });
});
