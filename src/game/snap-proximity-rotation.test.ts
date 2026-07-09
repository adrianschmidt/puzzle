import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { buildProximityContext } from './snap-proximity-rotation.js';

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

    it('returns null for non-finite tolerances (corrupted-state hardening)', () => {
        const state = () => makePairState({ x: 120, y: 0 });
        expect(buildProximityContext(state(), 11, NaN, T)).toBeNull();
        expect(buildProximityContext(state(), 11, Infinity, T)).toBeNull();
        expect(buildProximityContext(state(), 11, D, NaN)).toBeNull();
        expect(buildProximityContext(state(), 11, D, Infinity)).toBeNull();
    });
});
