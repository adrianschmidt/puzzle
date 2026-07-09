import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeGameState, makeMatedPiecePair, makePiece } from '../test-helpers/fixtures.js';
import { buildProximityContext, computeSnapProximityRotation, type ProximityContext } from './snap-proximity-rotation.js';
import { rotatePoint, getGroup } from '../model/helpers.js';
import { rotateGroup } from './rotate-group.js';

const D = 40; // tolerancePx used throughout these tests
const T = 20; // rotationToleranceDeg used throughout these tests

function makeGroupOf(id: number, pieceId: number, position: Point, rotation = 0): PieceGroup {
    return { id, pieces: new Map([[pieceId, { x: 0, y: 0 }]]), position, rotation };
}

/**
 * State with piece 0 fixed at the origin (group 10) and piece 1 in its
 * own group (11). Correct placement for group 11 is position (100, 0),
 * i.e. bbox center (150, 50).
 */
function makePairState(
    group1Position: Point,
    group1Rotation = 0,
    opts: { rotationMode?: GameState['rotationMode'] } = {},
): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeGroupOf(11, 1, group1Position, group1Rotation);
    return makeGameState({
        pieces: [piece0, piece1],
        groups: [group0, group1],
        // The presence check distinguishes "omitted → 'free'" from an
        // explicitly passed `rotationMode: undefined` (kept as undefined).
        rotationMode: 'rotationMode' in opts ? opts.rotationMode : 'free',
    });
}

describe('buildProximityContext', () => {
    it('returns a context with the border candidates and bbox center', () => {
        const state = makePairState({ x: 300, y: 0 });
        const ctx = buildProximityContext(state, 11, D, T);

        expect(ctx).not.toBeNull();
        expect(ctx!.groupId).toBe(11);
        expect(ctx!.candidates).toHaveLength(1);
        expect(ctx!.candidates[0].matePiece.id).toBe(0);
        expect(ctx!.centerLocal.x).toBeCloseTo(50);
        expect(ctx!.centerLocal.y).toBeCloseTo(50);
        expect(ctx!.tolerancePx).toBe(D);
        expect(ctx!.rotationToleranceDeg).toBe(T);
    });

    it('returns null unless rotation mode is free', () => {
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }, 0, { rotationMode: 'none' }), 11, D, T)).toBeNull();
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }, 0, { rotationMode: 'quarter-turn' }), 11, D, T)).toBeNull();
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }, 0, { rotationMode: undefined }), 11, D, T)).toBeNull();
    });

    it('returns null for an unknown group', () => {
        expect(buildProximityContext(makePairState({ x: 300, y: 0 }), 99, D, T)).toBeNull();
    });

    it('returns null when the group has no cross-group mates', () => {
        // Both pieces in ONE group: the mate edge is internal, not a border.
        const { piece0, piece1 } = makeMatedPiecePair();
        const merged: PieceGroup = {
            id: 10,
            pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };
        const state = makeGameState({
            pieces: [piece0, piece1],
            groups: [merged],
            rotationMode: 'free',
        });

        expect(buildProximityContext(state, 10, D, T)).toBeNull();
    });

    it('returns null for a non-positive tolerance', () => {
        expect(buildProximityContext(makePairState({ x: 120, y: 0 }), 11, 0, T)).toBeNull();
    });
});

/** Group-11 position that puts its bbox center at `center` for a given rotation. */
function positionForCenter(center: Point, rotation: number): Point {
    const r = rotatePoint({ x: 50, y: 50 }, rotation);
    return { x: center.x - r.x, y: center.y - r.y };
}

/** Build the pair state + context in one go; throws if the context is unexpectedly null. */
function makeComputeSetup(center: Point, rotation: number): { state: GameState; ctx: ProximityContext } {
    const state = makePairState(positionForCenter(center, rotation), rotation);
    const ctx = buildProximityContext(state, 11, D, T);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

/**
 * A 1×3 row: piece 0 — piece 1 — piece 2, each 100×100, mated along
 * vertical edges. Piece 1 (the moved group, id 11) sits with its center
 * displaced +12px from alignment with piece 0's group, while piece 2's
 * group is itself displaced +4px right of ITS correct spot — so piece 1
 * is only 8px from alignment with piece 2. Both mates un-rotated;
 * piece 1 rotated 16°.
 */
function makeRowState(): { state: GameState; ctx: ProximityContext } {
    const { piece0, piece1 } = makeMatedPiecePair();
    // Extend piece 1 with a right-edge mate to a third piece.
    const rightMate = { id: 2, matePieceId: 2, mateEdgeId: 3, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } };
    piece1.edges[1] = rightMate; // replace the border right edge (id 14)
    const piece2 = makePiece({ id: 2, edges: [
        { id: 16, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { id: 17, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
        { id: 18, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
        { id: 3, matePieceId: 1, mateEdgeId: 2, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ] });

    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeGroupOf(11, 1, positionForCenter({ x: 162, y: 50 }, 16), 16);
    const group2 = makeGroupOf(12, 2, { x: 204, y: 0 }); // +4px right of correct (200, 0)
    const state = makeGameState({
        pieces: [piece0, piece1, piece2],
        groups: [group0, group1, group2],
        rotationMode: 'free',
    });
    const ctx = buildProximityContext(state, 11, D, T);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

describe('computeSnapProximityRotation', () => {
    it('returns null when the group is beyond the snap distance', () => {
        const { state, ctx } = makeComputeSetup({ x: 150 + D + 5, y: 50 }, 18);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('returns null when the rotation is beyond the rotation tolerance', () => {
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, T + 5);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('returns null when the angular error is already under the cap (no jump on zone entry)', () => {
        // d = 30 → cap = 20 × 30/40 = 15; error 10 < 15 → nothing to do.
        const { state, ctx } = makeComputeSetup({ x: 180, y: 50 }, 10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('rotates the error down to the distance-scaled cap, and is idempotent at rest', () => {
        // d = 20 → cap = 10; error 18 → excess 8, toward alignment (negative).
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, 18);
        const delta = computeSnapProximityRotation(state, ctx);
        expect(delta).toBeCloseTo(-8);

        // Applying the delta and re-evaluating without moving: no oscillation.
        rotateGroup(getGroup(state, 11), state.piecesById, delta!);
        expect(getGroup(state, 11).rotation).toBeCloseTo(10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('fully aligns at zero distance', () => {
        const { state, ctx } = makeComputeSetup({ x: 150, y: 50 }, 15);
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(-15);
    });

    it('is wrap-aware: rotations just below 360° rotate forward through 0°', () => {
        // error = signedAngularDelta(0, 342) = +18; d = 20 → cap = 10 → +8.
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, 342);
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(8);
    });

    it('never rotates back as the distance increases again (one-way ratchet)', () => {
        const { state, ctx } = makeComputeSetup({ x: 170, y: 50 }, 18);
        const group = getGroup(state, 11);

        // Approach: d = 20 → rotated down to the cap (10°).
        rotateGroup(group, state.piecesById, computeSnapProximityRotation(state, ctx)!);
        expect(group.rotation).toBeCloseTo(10);

        // Retreat to d = 36 (cap = 18 > 10): no correction, rotation stays.
        group.position = { ...group.position, x: group.position.x + 16 };
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
        expect(group.rotation).toBeCloseTo(10);
    });

    it('the closest qualifying mate wins', () => {
        // Middle piece (1) mated on both sides; see makeRowState below.
        const { state, ctx } = makeRowState();
        // Left mate at d = 12 (cap 6), right mate at d = 8 (cap 4); error 16 on both.
        // Closest (right) wins: excess = 16 − 4 = 12, toward alignment.
        expect(computeSnapProximityRotation(state, ctx)).toBeCloseTo(-12);
    });

    it('returns null for non-finite tolerances (corrupted-state hardening)', () => {
        const state = () => makePairState({ x: 120, y: 0 });
        expect(buildProximityContext(state(), 11, NaN, T)).toBeNull();
        expect(buildProximityContext(state(), 11, Infinity, T)).toBeNull();
        expect(buildProximityContext(state(), 11, D, NaN)).toBeNull();
        expect(buildProximityContext(state(), 11, D, Infinity)).toBeNull();
    });
});
