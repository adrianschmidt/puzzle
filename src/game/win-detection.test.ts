import { describe, it, expect } from 'vitest';
import { checkWin, checkAndMarkWin } from './win-detection.js';
import type { PieceGroup } from '../model/types.js';
import { makePiece, makeGameState } from '../test-helpers/fixtures.js';

/** Create a minimal group with the given piece ids. */
function makeGroup(id: number, pieceIds: number[]): PieceGroup {
    const pieces = new Map<number, { x: number; y: number }>();
    for (const pid of pieceIds) {
        pieces.set(pid, { x: 0, y: 0 });
    }

    return { id, pieces, position: { x: 0, y: 0 }, rotation: 0 };
}

describe('checkWin', () => {
    it('returns false when there are multiple groups', () => {
        const pieces = [makePiece({ id: 0 }), makePiece({ id: 1 }), makePiece({ id: 2 })];
        const groups = [makeGroup(0, [0]), makeGroup(1, [1, 2])];
        const state = makeGameState({ pieces, groups });

        expect(checkWin(state)).toBe(false);
    });

    it('returns true when all pieces are in a single group', () => {
        const pieces = [makePiece({ id: 0 }), makePiece({ id: 1 }), makePiece({ id: 2 })];
        const groups = [makeGroup(0, [0, 1, 2])];
        const state = makeGameState({ pieces, groups });

        expect(checkWin(state)).toBe(true);
    });

    it('returns false when one group exists but not all pieces are in it', () => {
        // Edge case: single group but piece count mismatch (shouldn't happen
        // in practice, but the function should be defensive)
        const pieces = [makePiece({ id: 0 }), makePiece({ id: 1 }), makePiece({ id: 2 })];
        const groups = [makeGroup(0, [0, 1])]; // Missing piece 2
        const state = makeGameState({ pieces, groups });

        expect(checkWin(state)).toBe(false);
    });

    it('returns true for a single-piece puzzle in one group', () => {
        const pieces = [makePiece({ id: 0 })];
        const groups = [makeGroup(0, [0])];
        const state = makeGameState({ pieces, groups });

        expect(checkWin(state)).toBe(true);
    });

    it('returns false for an empty puzzle (no pieces, no groups)', () => {
        const state = makeGameState();

        // No groups → groups.length !== 1 → false
        expect(checkWin(state)).toBe(false);
    });
});

describe('checkAndMarkWin', () => {
    it('marks completed and returns true when puzzle is solved', () => {
        const pieces = [makePiece({ id: 0 }), makePiece({ id: 1 })];
        const groups = [makeGroup(0, [0, 1])];
        const state = makeGameState({ pieces, groups });

        expect(state.completed).toBe(false);
        expect(checkAndMarkWin(state)).toBe(true);
        expect(state.completed).toBe(true);
    });

    it('returns false and does not modify state when puzzle is not solved', () => {
        const pieces = [makePiece({ id: 0 }), makePiece({ id: 1 })];
        const groups = [makeGroup(0, [0]), makeGroup(1, [1])];
        const state = makeGameState({ pieces, groups });

        expect(checkAndMarkWin(state)).toBe(false);
        expect(state.completed).toBe(false);
    });

    it('returns false if the state is already marked completed', () => {
        const pieces = [makePiece({ id: 0 }), makePiece({ id: 1 })];
        const groups = [makeGroup(0, [0, 1])];
        const state = makeGameState({ pieces, groups, completed: true });

        expect(checkAndMarkWin(state)).toBe(false);
        // completed stays true (not toggled)
        expect(state.completed).toBe(true);
    });
});
