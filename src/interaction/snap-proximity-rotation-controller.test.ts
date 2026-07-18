import { describe, it, expect } from 'vitest';
import type { GameState, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { getGroup } from '../model/helpers.js';
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

/** Controller wired to a manually flushable frame scheduler. */
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
});
