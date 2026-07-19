import { describe, it, expect } from 'vitest';
import type { GameState, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { getGroup, rotatePoint } from '../model/helpers.js';
import { rotateGroup } from '../game/rotate-group.js';
import { SnapProximityPositionController } from './snap-proximity-position-controller.js';

const D = 40;
const T = 20;

/**
 * Pair state: piece 0 fixed near the origin (group 10); piece 1 (group 11)
 * placed by bbox center + rotation. Aligned center for group 11 is (150, 50),
 * so a center at (150 + k, 50) has simulated-snap distance k and
 * snapDelta ≈ (−k, 0).
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
    controller: SnapProximityPositionController;
    flushFrame: () => void;
} {
    let pending: Array<() => void> = [];
    const controller = new SnapProximityPositionController({
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

describe('SnapProximityPositionController', () => {
    it('translates the group toward alignment on rotate', () => {
        // d = 20, |θ| = 5 → cap 10 → excess 10 → move −10 in x.
        // Assert the CHANGE in position.x: makeCenteredGroup positions by bbox
        // center, so the absolute position.x depends on the rotation offset
        // (rotatePoint of the center), but the applied translation is −10.
        const state = makePairState({ x: 170, y: 50 }, 5);
        const { controller } = makeController(state);
        const startX = getGroup(state, 11).position.x;

        controller.start(11);
        controller.onGroupRotated();

        expect(getGroup(state, 11).position.x - startX).toBeCloseTo(-10);
    });

    it('does nothing before start() or after stop()', () => {
        const state = makePairState({ x: 170, y: 50 }, 5);
        const { controller, flushFrame } = makeController(state);
        const startX = getGroup(state, 11).position.x;

        controller.onGroupRotated();
        expect(getGroup(state, 11).position.x).toBeCloseTo(startX);

        controller.start(11);
        controller.stop();
        flushFrame();
        controller.onGroupRotated();
        expect(getGroup(state, 11).position.x).toBeCloseTo(startX);
    });

    it('does nothing when rotation mode is not free', () => {
        const state = makePairState({ x: 170, y: 50 }, 5, 'quarter-turn');
        const { controller } = makeController(state);
        const startX = getGroup(state, 11).position.x;

        controller.start(11);
        controller.onGroupRotated();

        expect(getGroup(state, 11).position.x).toBeCloseTo(startX);
    });

    it('evaluates at most once per frame, then resumes after the frame fires', () => {
        // Start at d = 20, |θ| = 5 (cap 10): first eval moves −10 (d → 10).
        // Track the world bbox center, which the module keeps invariant to the
        // player's rotation and moves only by the applied translation — unlike
        // position.x, which pivot-preserving rotation also shifts.
        const state = makePairState({ x: 170, y: 50 }, 5);
        const { controller, flushFrame } = makeController(state);
        const group = getGroup(state, 11);
        const centerX = () =>
            group.position.x + rotatePoint({ x: 50, y: 50 }, group.rotation).x;
        const startCenterX = centerX();

        controller.start(11);
        controller.onGroupRotated();
        expect(centerX() - startCenterX).toBeCloseTo(-10);

        // Improve rotation to |θ| = 2 (cap 4) via pivot-preserving rotateGroup
        // (as production does) so the bbox center — and thus the measured
        // distance d = 10 — stays fixed. The frame gate is still set.
        rotateGroup(group, state.piecesById, 2 - group.rotation);
        controller.onGroupRotated();
        expect(centerX() - startCenterX).toBeCloseTo(-10); // gated: no further move

        flushFrame();
        // Evaluates again: d still 10, cap 4 → excess 6 → move another −6.
        controller.onGroupRotated();
        expect(centerX() - startCenterX).toBeCloseTo(-16);
    });
});
