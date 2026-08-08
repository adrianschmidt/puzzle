import { describe, it, expect } from 'vitest';
import type { GameState, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair, makePiece, makeWideRowScenario } from '../test-helpers/fixtures.js';
import { getGroup, getWorldPosition } from '../model/helpers.js';
import { SnapProximityRotationController } from './snap-proximity-rotation-controller.js';
import { ROTATION_COMPLETE_AT_FRACTION as F } from '../game/snap-proximity-rotation.js';

const D = 40;
const T = 20;

/**
 * Bbox-center x placing group 11 (aligned center (150, 50)) at a fraction
 * along the cap ramp: fraction 0 = completion distance (cap 0), fraction 1 =
 * zone edge (cap T); cap at fraction `f` is `T · f`. Anchored to F so these
 * stay valid when ROTATION_COMPLETE_AT_FRACTION is retuned.
 */
function rampX(fraction: number): number {
    return 150 + D * (F + fraction * (1 - F));
}

/**
 * Pair state as in snap-proximity-rotation.test.ts: piece 0 fixed at the
 * origin (group 10); piece 1 (group 11) placed by bbox center + rotation.
 * Aligned center for group 11 is (150, 50).
 */
function makePairState(
    center: Point,
    rotation: number,
    rotationMode: GameState['rotationMode'] = 'free',
): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeCenteredGroup(10, 0, { x: 50, y: 50 });
    const group1 = makeCenteredGroup(11, 1, center, rotation);
    return makeGameState({ pieces: [piece0, piece1], groups: [group0, group1], rotationMode });
}

/** Distance (world px) placing a candidate at ramp fraction `f` (cap = T·f). */
function frac(f: number): number {
    return D * (F + f * (1 - F));
}

/**
 * A single-piece moved group (11) at 16° between two placed neighbors:
 * mated left to piece 0 (group 10, aligned center x = 150) and right to
 * piece 2 (group 12), at ramp fractions 0.25 (left) and 0.5 (right).
 *
 * Single-piece on purpose: both candidates' measurement pivots are the same
 * piece center, and applied corrections rotate around it too, so a
 * correction changes NEITHER measured distance — the fixture's hand-set
 * fractions stay valid across evaluations, which is what lets latch
 * behavior be asserted across several corrections.
 */
function makeSingleBetweenTwoMates(): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    piece1.edges[1] = { id: 2, matePieceId: 2, mateEdgeId: 3, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } };
    const piece2 = makePiece({ id: 2, edges: [
        { id: 16, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { id: 17, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
        { id: 18, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
        { id: 3, matePieceId: 1, mateEdgeId: 2, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ] });
    const group0 = makeCenteredGroup(10, 0, { x: 50, y: 50 });
    const group1 = makeCenteredGroup(11, 1, { x: 150 + frac(0.25), y: 50 }, 16);
    // Piece 2 sits so the right mate's aligned center is frac(0.5) to the
    // RIGHT of group 11's current center: +x shifts trade dLeft up for
    // dRight down, px for px.
    const group2 = makeCenteredGroup(12, 2, { x: 250 + frac(0.25) + frac(0.5), y: 50 });
    return makeGameState({
        pieces: [piece0, piece1, piece2],
        groups: [group0, group1, group2],
        rotationMode: 'free',
    });
}

function makeController(state: GameState): {
    controller: SnapProximityRotationController;
    flushFrame: () => void;
} {
    let pending: Array<() => void> = [];
    const controller = new SnapProximityRotationController({
        getState: () => state,
        getTolerances: () => ({ tolerancePx: D, rotationToleranceDeg: T }),
        scheduleFrame: (cb) => { pending.push(cb); },
    });
    return {
        controller,
        flushFrame: () => {
            const cbs = pending;
            pending = [];
            for (const cb of cbs) cb();
        },
    };
}

describe('SnapProximityRotationController', () => {
    it('rotates the dragged group toward alignment on move', () => {
        // Ramp midpoint → cap = T/2 = 10; error 18 → rotated down to 10°.
        const state = makePairState({ x: rampX(0.5), y: 50 }, 18);
        const { controller } = makeController(state);

        controller.start(11);
        controller.onGroupMoved();

        expect(getGroup(state, 11).rotation).toBeCloseTo(10);
    });

    it('does nothing before start() or after stop()', () => {
        const state = makePairState({ x: 170, y: 50 }, 18);
        const { controller, flushFrame } = makeController(state);

        controller.onGroupMoved();
        expect(getGroup(state, 11).rotation).toBeCloseTo(18);

        controller.start(11);
        controller.stop();
        flushFrame();
        controller.onGroupMoved();
        expect(getGroup(state, 11).rotation).toBeCloseTo(18);
    });

    it('does nothing when rotation mode is not free', () => {
        const state = makePairState({ x: 170, y: 50 }, 18, 'quarter-turn');
        const { controller } = makeController(state);

        controller.start(11);
        controller.onGroupMoved();

        expect(getGroup(state, 11).rotation).toBeCloseTo(18);
    });

    it('evaluates at most once per frame, then resumes after the frame fires', () => {
        const state = makePairState({ x: rampX(0.5), y: 50 }, 18);
        const { controller, flushFrame } = makeController(state);
        const group = getGroup(state, 11);

        controller.start(11);
        controller.onGroupMoved(); // evaluates: 18 → 10 (ramp midpoint, cap = 10)
        expect(group.rotation).toBeCloseTo(10);

        // Move closer to ramp fraction 0.25 (cap = 5), but the frame gate is still set.
        // A center-x shift equals the same position-x shift (they differ by a constant offset).
        group.position = { ...group.position, x: group.position.x + (rampX(0.25) - rampX(0.5)) };
        controller.onGroupMoved();
        expect(group.rotation).toBeCloseTo(10); // gated: no change

        flushFrame();
        controller.onGroupMoved(); // evaluates again: 10 → 5
        expect(group.rotation).toBeCloseTo(5);
    });

    it('re-picks the closest candidate on a new gesture instead of inheriting the latch', () => {
        // The latch's reset is "by construction" — start() rebuilds the
        // context — and this pins the gesture boundary: a future context-reuse
        // optimization must not carry a latched winner into the next drag.
        const state = makeSingleBetweenTwoMates();
        const { controller, flushFrame } = makeController(state);
        const group = getGroup(state, 11);

        // Gesture 1: left mate closest (fraction 0.25, cap T·0.25) → the 16°
        // error is rotated down to the cap, latching the left mate.
        controller.start(11);
        controller.onGroupMoved();
        expect(group.rotation).toBeCloseTo(T * 0.25);

        // Shift toward the right mate: right is now closest (fraction 0.125)
        // but the left mate still qualifies with a cap above the remaining
        // error, so the in-gesture latch corrects nothing.
        flushFrame();
        group.position = { ...group.position, x: group.position.x + (frac(0.625) - frac(0.25)) };
        controller.onGroupMoved();
        expect(group.rotation).toBeCloseTo(T * 0.25);

        // New gesture from the same spot: a fresh pick takes the closest
        // (right) mate and its tighter cap; an inherited latch would keep
        // the left mate and change nothing.
        controller.stop();
        controller.start(11);
        controller.onGroupMoved();
        expect(group.rotation).toBeCloseTo(T * 0.125);
    });

    it('applies the correction around the winning piece (wide-group wiring)', () => {
        const { state } = makeWideRowScenario(8);
        const controller = new SnapProximityRotationController({
            getState: () => state,
            getTolerances: () => ({ tolerancePx: 18, rotationToleranceDeg: 10 }),
            scheduleFrame: () => {},
        });
        const before = getWorldPosition({ x: 50, y: 50 }, 1, getGroup(state, 11));

        controller.start(11);
        controller.onGroupMoved();

        const group = getGroup(state, 11);
        expect(group.rotation).toBeCloseTo(0);
        const after = getWorldPosition({ x: 50, y: 50 }, 1, group);
        expect(after.x).toBeCloseTo(before.x);
        expect(after.y).toBeCloseTo(before.y);
    });
});
