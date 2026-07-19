import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair, makePiece } from '../test-helpers/fixtures.js';
import { buildProximityContext, type ProximityContext } from './snap-proximity-context.js';
import { computeSnapProximityPosition } from './snap-proximity-position.js';
import { getGroup, moveGroup, rotatePoint } from '../model/helpers.js';

const D = 40; // tolerancePx (snap distance)
const T = 20; // rotationToleranceDeg (rotation tolerance)
const TOL = { tolerancePx: D, rotationToleranceDeg: T };

function makeGroupOf(id: number, pieceId: number, position: Point, rotation = 0): PieceGroup {
    return { id, pieces: new Map([[pieceId, { x: 0, y: 0 }]]), position, rotation };
}

/**
 * Piece 0 fixed at the origin (group 10); piece 1 in its own group (11),
 * placed by bbox center. Correct placement for group 11 is bbox center
 * (150, 50). `distance` is measured after simulating the rotation snap, so
 * for a group whose bbox center sits at (150 + k, 50) the simulated-snap
 * distance is k regardless of the group's current rotation, and snapDelta ≈
 * (-k, 0).
 */
function makePairState(group1Center: Point, group1Rotation = 0): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeCenteredGroup(11, 1, group1Center, group1Rotation);
    return makeGameState({
        pieces: [piece0, piece1],
        groups: [group0, group1],
        rotationMode: 'free',
    });
}

function makeSetup(center: Point, rotation: number): { state: GameState; ctx: ProximityContext } {
    const state = makePairState(center, rotation);
    const ctx = buildProximityContext(state, 11, TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

describe('computeSnapProximityPosition', () => {
    it('returns null when the group is beyond the snap distance', () => {
        // d = D + 5 = 45 > 40, rotation within tolerance.
        const { state, ctx } = makeSetup({ x: 150 + D + 5, y: 50 }, 5);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('returns null when the context targets an unknown group', () => {
        // The group vanished (or the id is stale): tryGetGroup misses → null,
        // before any candidate is measured.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        expect(computeSnapProximityPosition(state, { ...ctx, groupId: 999 })).toBeNull();
    });

    it('returns null near the distance boundary at the rotation edge (no jump on entry)', () => {
        // d = D − 1 = 39 (just inside the snap zone), |θ| = T → cap = D = 40 >
        // d → excess < 0 → null. Complements the d = 20 edge case: a group that
        // enters the zone at the rotation edge must not jump, even at d ≈ D.
        const { state, ctx } = makeSetup({ x: 150 + D - 1, y: 50 }, T);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('translates diagonally when the misalignment is not axis-aligned', () => {
        // Center offset (12, 16) from the aligned (150, 50): d = 20, snapDelta ≈
        // (−12, −16). |θ| = 5 → cap = 10 → factor 0.5 → translation (−6, −8).
        const { state, ctx } = makeSetup({ x: 150 + 12, y: 50 + 16 }, 5);
        const delta = computeSnapProximityPosition(state, ctx);
        expect(delta).not.toBeNull();
        expect(delta!.x).toBeCloseTo(-6);
        expect(delta!.y).toBeCloseTo(-8);
    });

    it('returns null when the rotation is beyond the rotation tolerance', () => {
        // d = 20 (in range), |θ| = T + 5 = 25 > 20.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, T + 5);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('returns null at the rotation-tolerance edge (no jump on entry)', () => {
        // |θ| = T → cap = D = 40 ≥ d = 20 → excess ≤ 0 → nothing to do.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, T);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('translates toward the placement as rotation improves, tracking the cap', () => {
        // d = 20, |θ| = 5 → cap = D·(5/20) = 10 → excess = 10 → factor 0.5.
        // snapDelta ≈ (-20, 0) → translation ≈ (-10, 0).
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        const delta = computeSnapProximityPosition(state, ctx);
        expect(delta).not.toBeNull();
        expect(delta!.x).toBeCloseTo(-10);
        expect(delta!.y).toBeCloseTo(0);
    });

    it('applies the full snapDelta at exactly-correct rotation (θ = 0)', () => {
        // cap = 0 → excess = d → factor 1 → full correction to exact placement.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 0);
        const delta = computeSnapProximityPosition(state, ctx);
        expect(delta).not.toBeNull();
        expect(delta!.x).toBeCloseTo(-20);
        expect(delta!.y).toBeCloseTo(0);
    });

    it('is idempotent at rest: re-evaluating after applying the delta returns null', () => {
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        const delta = computeSnapProximityPosition(state, ctx)!;
        moveGroup(getGroup(state, 11), delta);
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
    });

    it('never moves back as the rotation worsens again (one-way ratchet)', () => {
        // Approach at |θ| = 5 (cap 10): translate from d = 20 down to d = 10.
        const { state, ctx } = makeSetup({ x: 170, y: 50 }, 5);
        const group = getGroup(state, 11);
        // `group.position` is the raw anchor `moveGroup` translates, not the
        // bbox center: `makeCenteredGroup` offsets it by the group's ROTATED
        // local center, so at rotation 5 it is center.x − rotatePoint({50,
        // 50}, 5).x, not center.x − 50 (that only holds at rotation 0).
        const initialX = 170 - rotatePoint({ x: 50, y: 50 }, 5).x;
        moveGroup(group, computeSnapProximityPosition(state, ctx)!);
        const heldX = group.position.x;
        expect(heldX).toBeCloseTo(initialX - 10); // translation is exactly (-10, 0)

        // Worsen rotation to |θ| = 10 (cap = 20 > current d = 10): held.
        group.rotation = 10;
        expect(computeSnapProximityPosition(state, ctx)).toBeNull();
        expect(group.position.x).toBeCloseTo(heldX);
    });

    it.each(['left', 'right'] as const)(
        'the closest qualifying mate wins (%s mate closest)',
        (closest) => {
            const { state, ctx } = makeRowState(closest);
            const delta = computeSnapProximityPosition(state, ctx);
            expect(delta).not.toBeNull();
            // Closest mate at d = 24, cap (|θ| = 8) = D·(8/20) = 16 → excess 8,
            // factor 8/24 = 1/3, |snapDelta| = 24 → |translation| = 8.
            // 'left' pulls toward group 0 (−x); 'right' pulls toward group 2 (+x).
            expect(delta!.x).toBeCloseTo(closest === 'left' ? -8 : 8);
            expect(delta!.y).toBeCloseTo(0);
        },
    );
});

/**
 * A 1×3 row: piece 0 — piece 1 — piece 2, mated along vertical edges. The
 * middle group (11) is rotated 8° (cap = D·8/20 = 16). One mate sits at
 * simulated-snap distance 24 (qualifies, excess 8), the other at 32 (also
 * qualifies, larger excess is NOT chosen). Group 1 is placed to the RIGHT of
 * group 0's alignment (pull −x) and to the LEFT of group 2's alignment (pull
 * +x), so the sign of the returned translation reveals which mate won —
 * discriminating closest-wins from first/last-qualifying-wins bugs.
 *
 * - 'left':  closer to group 0 (d = 24, pull −x); group 2 far (d = 32).
 * - 'right': closer to group 2 (d = 24, pull +x); group 0 far (d = 32).
 */
function makeRowState(closest: 'left' | 'right'): { state: GameState; ctx: ProximityContext } {
    const { piece0, piece1 } = makeMatedPiecePair();
    const rightMate = { id: 2, matePieceId: 2, mateEdgeId: 3, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } };
    piece1.edges[1] = rightMate; // replace the border right edge with a mate to piece 2
    const piece2 = makePiece({ id: 2, edges: [
        { id: 16, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { id: 17, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
        { id: 18, matePieceId: -1, mateEdgeId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
        { id: 3, matePieceId: 1, mateEdgeId: 2, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ] });

    // Aligned centers: group 0 → (150, 50); group 2 → (group2.x − 50, 50).
    // 'left':  group1 center x = 174 (d_left = 24), group2 aligned at 206 (d_right = 32).
    // 'right': group1 center x = 182 (d_left = 32), group2 aligned at 206 (d_right = 24).
    const group1CenterX = closest === 'left' ? 174 : 182;
    const group2X = 206 + 50; // group2 aligned center at 206
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeCenteredGroup(11, 1, { x: group1CenterX, y: 50 }, 8);
    const group2 = makeGroupOf(12, 2, { x: group2X, y: 0 });
    const state = makeGameState({
        pieces: [piece0, piece1, piece2],
        groups: [group0, group1, group2],
        rotationMode: 'free',
    });
    const ctx = buildProximityContext(state, 11, TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}
