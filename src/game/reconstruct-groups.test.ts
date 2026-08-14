import { describe, it, expect } from 'vitest';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import { computeMergedOffsets, applyProgress } from './reconstruct-groups.js';
import { createNewGame } from './init.js';
import { buildGroupIndexes } from '../model/helpers.js';
import { sealPieceGeometry } from '../model/seal-geometry.js';
import type { GameState, PieceGroup } from '../model/types.js';

/** Seal raw generator output so it satisfies the sealed `Piece[]` contract. */
function generatePieces(cols: number, rows: number, imageSize: { width: number; height: number }, seed: number) {
    return sealPieceGeometry(generateProceduralPuzzle(cols, rows, imageSize, seed));
}

describe('computeMergedOffsets', () => {
    it('computes offsets for a two-piece horizontal merge that match the generator layout', () => {
        const pieces = generatePieces(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 and piece 1 are horizontally adjacent in the top row.
        const offsets = computeMergedOffsets(pieces, [0, 1]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        const off1 = offsets!.get(1)!;
        expect(off1.x).toBeCloseTo(100, 3);
        expect(off1.y).toBeCloseTo(0, 3);
    });

    it('computes offsets for a three-piece L-shape', () => {
        const pieces = generatePieces(4, 3, { width: 400, height: 300 }, 123);
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
        const pieces = generatePieces(4, 3, { width: 400, height: 300 }, 123);
        // Pieces 0,1,2 chain along the top row; piece 2 is reachable from anchor
        // 0 only via piece 1, so a BFS stopping at direct neighbors would fail.
        const offsets = computeMergedOffsets(pieces, [0, 1, 2]);
        expect(offsets).not.toBeNull();
        expect(offsets!.get(0)).toEqual({ x: 0, y: 0 });
        expect(offsets!.get(1)!.x).toBeCloseTo(100, 3);
        expect(offsets!.get(1)!.y).toBeCloseTo(0, 3);
        expect(offsets!.get(2)!.x).toBeCloseTo(200, 3);
        expect(offsets!.get(2)!.y).toBeCloseTo(0, 3);
    });

    it('returns null for a disconnected piece set', () => {
        const pieces = generatePieces(4, 3, { width: 400, height: 300 }, 123);
        // Piece 0 and piece 2 are not adjacent.
        expect(computeMergedOffsets(pieces, [0, 2])).toBeNull();
    });

    it('returns null when a piece id is not in the puzzle', () => {
        const pieces = generatePieces(4, 3, { width: 400, height: 300 }, 123);
        expect(computeMergedOffsets(pieces, [0, 999])).toBeNull();
    });

    it('returns a single-entry map for a one-piece group', () => {
        const pieces = generatePieces(4, 3, { width: 400, height: 300 }, 123);
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
        expect([...merged!.pieces.keys()].sort((a, b) => a - b)).toEqual([0, 1]);
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

    it('normalizes out-of-range free-mode mr values into [0, 360)', () => {
        // The encoder emits [0, 360), but a hand-edited share link could plant
        // out-of-range values; the read mirrors the encoder's clamp.
        const state = fresh(123, 'free');
        const ok = applyProgress(state, { m: [[0, 1]], mr: [-90] });
        expect(ok).toBe(true);
        const merged = state.groups.find((g) => g.pieces.size === 2);
        expect(merged!.rotation).toBe(270);
    });

    it('normalizes out-of-range free-mode sr values into [0, 360)', () => {
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

/**
 * Replace `state.groups` with a synthetic partition: `mergedIds` (must be a
 * connected subgraph) form one starting group, every other piece solo. Mirrors
 * `createInitialGroups` with `autoGroups`, without a full composable generation.
 */
function replaceWithAutoGroupPartition(state: GameState, mergedIds: number[]): void {
    const offsets = computeMergedOffsets(state.pieces, mergedIds);
    if (!offsets) throw new Error('Merged piece set is not connected');

    const newGroups: PieceGroup[] = [];
    let nextId = 0;
    const merged: PieceGroup = {
        id: nextId++,
        pieces: offsets,
        position: { x: 0, y: 0 },
        rotation: 0,
    };
    newGroups.push(merged);
    const absorbed = new Set(mergedIds);
    for (const piece of state.pieces) {
        if (absorbed.has(piece.id)) continue;
        newGroups.push({
            id: nextId++,
            pieces: new Map([[piece.id, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        });
    }
    state.groups = newGroups;
    const indexes = buildGroupIndexes(newGroups);
    state.groupsById = indexes.groupsById;
    state.pieceToGroup = indexes.pieceToGroup;
}

describe('applyProgress: starting auto-groups (Plan 3)', () => {
    it('does not duplicate a starting auto-group when its pieces appear in pr.m', () => {
        // Reproduces the bug: extractProgress emits every size>=2 group into
        // pr.m, so without the dedup filter the receiver keeps both the starting
        // auto-group and a reconstructed merge of the same pieces.
        const state = fresh(123);
        replaceWithAutoGroupPartition(state, [0, 1]);
        const totalPieces = state.pieces.length;

        // Payload: auto-group [0,1] plus a real user merge [2,3] (adjacent in
        // the top row of the 4x3 grid).
        const ok = applyProgress(state, { m: [[0, 1], [2, 3]] });
        expect(ok).toBe(true);

        // Expect 2 multi-piece groups ([0,1] and [2,3]) plus solos.
        const multiGroups = state.groups.filter((g) => g.pieces.size >= 2);
        expect(multiGroups.length).toBe(2);

        // Every piece appears exactly once — none missing, none duplicated.
        let countedPieces = 0;
        const seen = new Set<number>();
        for (const g of state.groups) {
            for (const pid of g.pieces.keys()) {
                expect(seen.has(pid)).toBe(false);
                seen.add(pid);
                countedPieces++;
            }
        }
        expect(countedPieces).toBe(totalPieces);

        // pieceToGroup agrees with state.groups.
        for (const g of state.groups) {
            for (const pid of g.pieces.keys()) {
                expect(state.pieceToGroup.get(pid)).toBe(g);
            }
        }
    });

    it('replaces a starting auto-group with the reconstructed merged group', () => {
        // The group containing piece 0 after applyProgress must be the
        // reconstructed one, confirming the starting auto-group was filtered out.
        const state = fresh(123);
        replaceWithAutoGroupPartition(state, [0, 1]);
        const startingAutoGroupId = state.pieceToGroup.get(0)!.id;

        const ok = applyProgress(state, { m: [[0, 1]] });
        expect(ok).toBe(true);

        const groupContaining0 = state.pieceToGroup.get(0)!;
        // The reconstructed group gets a fresh id (max+1), so it won't match the
        // original auto-group's id.
        expect(groupContaining0.id).not.toBe(startingAutoGroupId);
        expect(groupContaining0.pieces.size).toBe(2);
        expect(groupContaining0.pieces.has(1)).toBe(true);
    });
});
