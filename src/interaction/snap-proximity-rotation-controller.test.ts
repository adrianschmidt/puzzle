import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeGameState, makeMatedPiecePair } from '../test-helpers/fixtures.js';
import { getGroup, rotatePoint } from '../model/helpers.js';
import { SnapProximityRotationController } from './snap-proximity-rotation-controller.js';

const D = 40;
const T = 20;

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
    const r = rotatePoint({ x: 50, y: 50 }, rotation);
    const group0: PieceGroup = { id: 10, pieces: new Map([[0, { x: 0, y: 0 }]]), position: { x: 0, y: 0 }, rotation: 0 };
    const group1: PieceGroup = {
        id: 11,
        pieces: new Map([[1, { x: 0, y: 0 }]]),
        position: { x: center.x - r.x, y: center.y - r.y },
        rotation,
    };
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
        // d = 20 → cap = 10; error 18 → rotated down to 10°.
        const state = makePairState({ x: 170, y: 50 }, 18);
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
        const state = makePairState({ x: 170, y: 50 }, 18);
        const { controller, flushFrame } = makeController(state);
        const group = getGroup(state, 11);

        controller.start(11);
        controller.onGroupMoved(); // evaluates: 18 → 10 (d = 20)
        expect(group.rotation).toBeCloseTo(10);

        // Move closer (d = 10 → cap = 5), but the frame gate is still set.
        group.position = { ...group.position, x: group.position.x - 10 };
        controller.onGroupMoved();
        expect(group.rotation).toBeCloseTo(10); // gated: no change

        flushFrame();
        controller.onGroupMoved(); // evaluates again: 10 → 5
        expect(group.rotation).toBeCloseTo(5);
    });
});
