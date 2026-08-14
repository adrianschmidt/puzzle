import { describe, it, expect } from 'vitest';
import { getGroup, getPiece } from '../model/helpers.js';
import { makeTwoMatedEndsRow, makeWideRowScenario } from '../test-helpers/fixtures.js';
import { pickManualRotationPivot } from './rotation-pivot.js';

const TOLERANCE_PX = 18;

describe('pickManualRotationPivot', () => {
    it('picks the mated piece center regardless of angular error', () => {
        // 45° is far outside every rotation tolerance, but the flush edge is
        // within snap distance — distance is the only gate.
        const { state, movedGroup } = makeWideRowScenario(45);

        const pivot = pickManualRotationPivot(state, movedGroup, TOLERANCE_PX);

        expect(pivot).not.toBeNull();
        expect(pivot!.pieceId).toBe(1);
        expect(pivot!.pivotLocal.x).toBeCloseTo(50);
        expect(pivot!.pivotLocal.y).toBeCloseTo(50);
    });

    it('returns null when no mate is within the snap distance', () => {
        const { state, movedGroup } = makeWideRowScenario(8);
        movedGroup.position = { ...movedGroup.position, x: movedGroup.position.x + TOLERANCE_PX + 7 };

        expect(pickManualRotationPivot(state, movedGroup, TOLERANCE_PX)).toBeNull();
    });

    it.each([1, 5] as const)(
        'picks the closest mated piece when several are in range (piece %i closest)',
        (closest) => {
            const { state } = makeTwoMatedEndsRow(closest);

            const pivot = pickManualRotationPivot(state, getGroup(state, 11), TOLERANCE_PX);

            expect(pivot!.pieceId).toBe(closest);
            expect(pivot!.pivotLocal.x).toBeCloseTo(closest === 1 ? 50 : 450);
            expect(pivot!.pivotLocal.y).toBeCloseTo(50);
        },
    );

    it('returns null outside free-rotation mode', () => {
        const { state, movedGroup } = makeWideRowScenario(8);
        state.rotationMode = 'quarter-turn';

        expect(pickManualRotationPivot(state, movedGroup, TOLERANCE_PX)).toBeNull();
    });

    it('returns null for a non-finite or non-positive tolerance (corrupted-state hardening)', () => {
        const { state, movedGroup } = makeWideRowScenario(8);

        expect(pickManualRotationPivot(state, movedGroup, NaN)).toBeNull();
        expect(pickManualRotationPivot(state, movedGroup, 0)).toBeNull();
    });

    it('returns null when the picked piece center is poisoned by a non-finite path coordinate', () => {
        // Equal rotations take measureEdgeAlignment's fast path, which never
        // samples path bounds — the one route a corrupt coordinate survives the
        // distance gate to pieceCenterLocal; unguarded, Infinity → NaN position.
        const { state, movedGroup } = makeWideRowScenario(0);
        getPiece(state, 1).edges[0].path = 'M 1e999 0 L 0 0';

        expect(pickManualRotationPivot(state, movedGroup, TOLERANCE_PX)).toBeNull();
    });
});
