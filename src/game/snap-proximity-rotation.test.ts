import { describe, it, expect } from 'vitest';
import type { GameState, PieceGroup, Point } from '../model/types.js';
import { makeCenteredGroup, makeGameState, makeMatedPiecePair, makePiece, makeTwoMatedEndsRow, makeWideRowScenario } from '../test-helpers/fixtures.js';
import { buildProximityContext, computeSnapProximityRotation, ROTATION_COMPLETE_AT_FRACTION as F, type ProximityContext } from './snap-proximity-rotation.js';
import { getGroup, getPiece } from '../model/helpers.js';
import { rotateGroup } from './rotate-group.js';

const D = 40; // tolerancePx used throughout these tests
const T = 20; // rotationToleranceDeg used throughout these tests
const TOL = { tolerancePx: D, rotationToleranceDeg: T };

function makeGroupOf(id: number, pieceId: number, position: Point, rotation = 0): PieceGroup {
    return { id, pieces: new Map([[pieceId, { x: 0, y: 0 }]]), position, rotation };
}

/**
 * State with piece 0 fixed at the origin (group 10) and piece 1 in its
 * own group (11), placed by bbox center. Correct placement for group 11
 * is bbox center (150, 50).
 */
function makePairState(
    group1Center: Point,
    group1Rotation = 0,
    opts: { rotationMode?: GameState['rotationMode'] } = {},
): GameState {
    const { piece0, piece1 } = makeMatedPiecePair();
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeCenteredGroup(11, 1, group1Center, group1Rotation);
    return makeGameState({
        pieces: [piece0, piece1],
        groups: [group0, group1],
        // The presence check distinguishes "omitted → 'free'" from an
        // explicitly passed `rotationMode: undefined` (kept as undefined).
        rotationMode: 'rotationMode' in opts ? opts.rotationMode : 'free',
    });
}

describe('buildProximityContext', () => {
    it('returns a context with the border candidates', () => {
        const state = makePairState({ x: 350, y: 50 });
        const ctx = buildProximityContext(state, 11, TOL);

        expect(ctx).not.toBeNull();
        expect(ctx!.groupId).toBe(11);
        expect(ctx!.candidates).toHaveLength(1);
        expect(ctx!.candidates[0].matePiece.id).toBe(0);
        expect(ctx!.tolerancePx).toBe(D);
        expect(ctx!.rotationToleranceDeg).toBe(T);
    });

    it('returns null unless rotation mode is free', () => {
        expect(buildProximityContext(makePairState({ x: 350, y: 50 }, 0, { rotationMode: 'none' }), 11, TOL)).toBeNull();
        expect(buildProximityContext(makePairState({ x: 350, y: 50 }, 0, { rotationMode: 'quarter-turn' }), 11, TOL)).toBeNull();
        expect(buildProximityContext(makePairState({ x: 350, y: 50 }, 0, { rotationMode: undefined }), 11, TOL)).toBeNull();
    });

    it('returns null for an unknown group', () => {
        expect(buildProximityContext(makePairState({ x: 350, y: 50 }), 99, TOL)).toBeNull();
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

        expect(buildProximityContext(state, 10, TOL)).toBeNull();
    });

    it('returns null for a non-positive tolerance', () => {
        expect(buildProximityContext(makePairState({ x: 170, y: 50 }), 11, { ...TOL, tolerancePx: 0 })).toBeNull();
    });

    it('returns null for a non-positive rotation tolerance', () => {
        expect(buildProximityContext(makePairState({ x: 170, y: 50 }), 11, { ...TOL, rotationToleranceDeg: 0 })).toBeNull();
    });

    it('returns null for non-finite tolerances (corrupted-state hardening)', () => {
        const state = () => makePairState({ x: 170, y: 50 });
        expect(buildProximityContext(state(), 11, { ...TOL, tolerancePx: NaN })).toBeNull();
        expect(buildProximityContext(state(), 11, { ...TOL, tolerancePx: Infinity })).toBeNull();
        expect(buildProximityContext(state(), 11, { ...TOL, rotationToleranceDeg: NaN })).toBeNull();
        expect(buildProximityContext(state(), 11, { ...TOL, rotationToleranceDeg: Infinity })).toBeNull();
    });
});

/** Build the pair state + context in one go; throws if the context is unexpectedly null. */
function makeComputeSetup(center: Point, rotation: number): { state: GameState; ctx: ProximityContext } {
    const state = makePairState(center, rotation);
    const ctx = buildProximityContext(state, 11, TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

/**
 * Bbox-center point placing the moved group (aligned center (150, 50)) at a
 * given fraction along the cap ramp. The ramp runs from the completion
 * distance (fraction 0 → d = F·D, cap 0) to the zone edge (fraction 1 →
 * d = D, cap T); at fraction `f` the cap is exactly `T · f`. Anchoring
 * fixtures to F keeps these tests valid when ROTATION_COMPLETE_AT_FRACTION is
 * retuned — the caps at these fractions (0, T/4, T/2, 3T/4, T) don't move.
 */
function rampCenter(fraction: number): Point {
    return { x: 150 + D * (F + fraction * (1 - F)), y: 50 };
}

/** Distance step (world px) to move a fixture from one ramp fraction to another. */
function rampStep(fromFraction: number, toFraction: number): number {
    return D * (toFraction - fromFraction) * (1 - F);
}

/**
 * A 1×3 row: piece 0 — piece 1 — piece 2, each 100×100, mated along
 * vertical edges. Piece 1 (the moved group, id 11) is rotated 16° and both
 * mates are un-rotated; `closest` picks which mate piece 1 sits nearer.
 * Alignment with group 0 (origin) puts piece 1's center at (150, 50);
 * alignment with group 2 puts it at group2.position + (−50, 50). The two
 * mates sit at ramp fractions 0.25 (cap T/4 = 5) and 0.5 (cap T/2 = 10) —
 * both in the outer half of the zone with distinct non-zero caps, anchored
 * to F so the arrangement holds when the fraction is retuned:
 *
 * - 'right': right mate at fraction 0.25 (d = D·(F + 0.25·(1−F)), cap 5),
 *   left mate at fraction 0.5 (cap 10).
 * - 'left':  left mate at fraction 0.25 (cap 5), right mate at fraction 0.5.
 *
 * `getBorderEdges` iterates piece 1's right mate (edge index 1) before its
 * left mate (index 3), so testing BOTH arrangements discriminates genuine
 * closest-wins from first-qualifying-wins and last-qualifying-wins
 * iteration bugs: either bug picks the cap-10 mate (16 − 10 = −6) in one of
 * the arrangements instead of the closest cap-5 mate (16 − 5 = −11).
 */
function makeRowState(closest: 'left' | 'right'): { state: GameState; ctx: ProximityContext } {
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

    // Mate distances at ramp fractions 0.25 (closer, cap 5) and 0.5 (cap 10).
    // Aligned centers: group 0 at (150, 50); group 2 at (group2.x − 50, 50).
    const dClose = D * (F + 0.25 * (1 - F));
    const dFar = D * (F + 0.5 * (1 - F));
    const group1Center = closest === 'right'
        ? { x: 150 + dFar, y: 50 }
        : { x: 150 + dClose, y: 50 };
    const group2Position = closest === 'right'
        ? { x: (150 + dFar) - dClose + 50, y: 0 }
        : { x: (150 + dClose) - dFar + 50, y: 0 };
    const group0 = makeGroupOf(10, 0, { x: 0, y: 0 });
    const group1 = makeCenteredGroup(11, 1, group1Center, 16);
    const group2 = makeGroupOf(12, 2, group2Position);
    const state = makeGameState({
        pieces: [piece0, piece1, piece2],
        groups: [group0, group1, group2],
        rotationMode: 'free',
    });
    const ctx = buildProximityContext(state, 11, TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

describe('computeSnapProximityRotation', () => {
    it('returns null when the group is beyond the snap distance', () => {
        const { state, ctx } = makeComputeSetup({ x: 150 + D + 5, y: 50 }, 18);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('returns null when the rotation is beyond the rotation tolerance', () => {
        const { state, ctx } = makeComputeSetup(rampCenter(0.5), T + 5);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('returns null when the angular error is already under the cap (no jump on zone entry)', () => {
        // Ramp fraction 0.75 → cap = T·0.75 = 15; error 10 < 15 → nothing to do.
        const { state, ctx } = makeComputeSetup(rampCenter(0.75), 10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('rotates the error down to the distance-scaled cap, and is idempotent at rest', () => {
        // Ramp midpoint (fraction 0.5) → cap = T/2 = 10; error 18 → excess 8, toward alignment (negative).
        const { state, ctx } = makeComputeSetup(rampCenter(0.5), 18);
        const result = computeSnapProximityRotation(state, ctx);
        expect(result!.deltaDeg).toBeCloseTo(-8);

        // Applying the delta and re-evaluating without moving: no oscillation.
        rotateGroup(getGroup(state, 11), state.piecesById, result!.deltaDeg, result!.pivotLocal);
        expect(getGroup(state, 11).rotation).toBeCloseTo(10);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('fully aligns at the completion distance (F·D)', () => {
        // Ramp fraction 0 → d = F·D → cap = 0; error 15 fully corrected.
        const { state, ctx } = makeComputeSetup(rampCenter(0), 15);
        expect(computeSnapProximityRotation(state, ctx)!.deltaDeg).toBeCloseTo(-15);
    });

    it('stays fully aligned across the inner plateau (below the completion distance)', () => {
        // d = F·D/2 < F·D → cap clamps to 0; error 15 fully corrected.
        const { state, ctx } = makeComputeSetup({ x: 150 + (D * F) / 2, y: 50 }, 15);
        expect(computeSnapProximityRotation(state, ctx)!.deltaDeg).toBeCloseTo(-15);
    });

    it('leaves the full tolerance uncorrected at the zone edge (no jump on entry)', () => {
        // Ramp fraction 1 → d = D → cap = T; error 20 → excess 0 → null.
        const { state, ctx } = makeComputeSetup(rampCenter(1), T);
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
    });

    it('is wrap-aware: rotations just below 360° rotate forward through 0°', () => {
        // error = signedAngularDelta(0, 342) = +18; ramp midpoint → cap = 10 → +8.
        const { state, ctx } = makeComputeSetup(rampCenter(0.5), 342);
        expect(computeSnapProximityRotation(state, ctx)!.deltaDeg).toBeCloseTo(8);
    });

    it('never rotates back as the distance increases again (one-way ratchet)', () => {
        const { state, ctx } = makeComputeSetup(rampCenter(0.5), 18);
        const group = getGroup(state, 11);

        // Approach: ramp midpoint (cap 10) → rotated down to 10°.
        const result = computeSnapProximityRotation(state, ctx)!;
        rotateGroup(group, state.piecesById, result.deltaDeg, result.pivotLocal);
        expect(group.rotation).toBeCloseTo(10);

        // Retreat to fraction 0.75 (cap = 15 > held error 10): no correction, rotation stays.
        group.position = { ...group.position, x: group.position.x + rampStep(0.5, 0.75) };
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();
        expect(group.rotation).toBeCloseTo(10);
    });

    it.each(['left', 'right'] as const)(
        'the closest qualifying mate wins (%s mate closest)',
        (closest) => {
            // Middle piece (1) mated on both sides; see makeRowState above.
            // Closer mate at ramp fraction 0.25 (cap 5), farther at 0.5 (cap
            // 10); error 16 on both. Closest wins: excess = 16 − 5 = 11,
            // toward alignment. Running both arrangements rules out
            // iteration-order (first/last-qualifying-wins) bugs, which would
            // yield −6.
            const { state, ctx } = makeRowState(closest);
            expect(computeSnapProximityRotation(state, ctx)!.deltaDeg).toBeCloseTo(-11);
        },
    );
});

/** Merge-default tolerances, which the wide-row scenario is built against. */
const WIDE_TOL = { tolerancePx: 18, rotationToleranceDeg: 10 };

/**
 * The shared two-mates fixture with a proximity context under WIDE_TOL.
 * Its distances 7.2 / 10.8 sit at ramp fractions 0.25 (cap 2.5) and 0.5
 * (cap 5) under WIDE_TOL and F.
 */
function makeTwoMatedEndsRowCtx(closest: 1 | 5): { state: GameState; ctx: ProximityContext } {
    const { state } = makeTwoMatedEndsRow(closest);
    const ctx = buildProximityContext(state, 11, WIDE_TOL);
    if (!ctx) throw new Error('expected a proximity context');
    return { state, ctx };
}

describe('piece-anchored assist pivot (issue #530)', () => {
    it('engages for a wide group flush at one piece and pivots on that piece', () => {
        const { state } = makeWideRowScenario(8);
        const ctx = buildProximityContext(state, 11, WIDE_TOL);
        expect(ctx).not.toBeNull();

        const result = computeSnapProximityRotation(state, ctx!);
        // d ≈ 0 is inside the completion fraction → cap 0 → full correction.
        expect(result!.deltaDeg).toBeCloseTo(-8);
        expect(result!.pivotLocal.x).toBeCloseTo(50);
        expect(result!.pivotLocal.y).toBeCloseTo(50);

        // Applying the correction around the returned pivot is idempotent.
        rotateGroup(getGroup(state, 11), state.piecesById, result!.deltaDeg, result!.pivotLocal);
        expect(getGroup(state, 11).rotation).toBeCloseTo(0);
        expect(computeSnapProximityRotation(state, ctx!)).toBeNull();
    });

    it.each([1, 5] as const)(
        'pivots on the closest qualifying candidate, not the last one (piece %i closest)',
        (closest) => {
            // Two qualifying candidates on DIFFERENT pieces: the closer sits at
            // ramp fraction 0.25 (cap 2.5) → excess 8 − 2.5 = 5.5, the farther
            // at 0.5 (cap 5) → 3. The pivot is the winner's piece center:
            // (50, 50) for piece 1, (450, 50) for piece 5.
            const { state, ctx } = makeTwoMatedEndsRowCtx(closest);

            const result = computeSnapProximityRotation(state, ctx)!;
            expect(result.deltaDeg).toBeCloseTo(-5.5);
            expect(result.pivotLocal.x).toBeCloseTo(closest === 1 ? 50 : 450);
            expect(result.pivotLocal.y).toBeCloseTo(50);
        },
    );
});

describe('sticky winner latch', () => {
    // Both tests start from makeTwoMatedEndsRowCtx(1): d1 = 7.2 (piece 1,
    // latched on the first evaluation) and d5 = 10.8 (piece 5). A +x shift
    // of the row moves it away from group 10 and toward group 12, so d1
    // grows and d5 shrinks by the same amount.
    it('keeps the latched candidate while it qualifies, even when another becomes closer', () => {
        const { state, ctx } = makeTwoMatedEndsRowCtx(1);
        expect(computeSnapProximityRotation(state, ctx)!.pivotLocal.x).toBeCloseTo(50);

        const group = getGroup(state, 11);
        group.position = { ...group.position, x: group.position.x + 5.4 };

        // Piece 5's candidate is now closer (5.4 vs 12.6), but piece 1 still
        // qualifies, so the latch holds: the pivot stays on piece 1 and the
        // cap comes from the latched candidate's distance (12.6 → cap 6.25,
        // excess 1.75). Follow-the-winner would flip to (450, 50) / −6.75.
        const result = computeSnapProximityRotation(state, ctx)!;
        expect(result.pivotLocal.x).toBeCloseTo(50);
        expect(result.deltaDeg).toBeCloseTo(-1.75);
    });

    it('clears the latch when nothing qualifies, re-picking fresh on return', () => {
        const { state, ctx } = makeTwoMatedEndsRowCtx(1);
        expect(computeSnapProximityRotation(state, ctx)!.pivotLocal.x).toBeCloseTo(50);

        const group = getGroup(state, 11);
        // Straight down: both mates leave the snap zone at once (an x shift
        // only trades one distance for the other, so it can't empty the zone).
        group.position = { ...group.position, y: group.position.y + 30 };
        expect(computeSnapProximityRotation(state, ctx)).toBeNull();

        // Return with piece 5 closest (5.4 vs 12.6): a cleared latch
        // re-picks it; a latch surviving the empty sweep would hand the win
        // back to the still-qualifying piece 1.
        group.position = { ...group.position, y: group.position.y - 30, x: group.position.x + 5.4 };
        expect(computeSnapProximityRotation(state, ctx)!.pivotLocal.x).toBeCloseTo(450);
    });

    it('declines a corrupt candidate (NaN distance) instead of latching it', () => {
        const { state, ctx } = makeTwoMatedEndsRowCtx(1);
        // An Infinity coordinate in a tab path makes piece 1's simulated-snap
        // distance NaN, which every `>` tolerance gate waves through.
        getPiece(state, 1).edges[0].path = 'M 1e999 0 L 0 0';

        // The corrupt candidate must not win the latch; the healthy piece-5
        // mate does (d = 10.8 → cap 5, error 8 → excess 3).
        const result = computeSnapProximityRotation(state, ctx)!;
        expect(result.pivotLocal.x).toBeCloseTo(450);
        expect(result.deltaDeg).toBeCloseTo(-3);
    });

    it('re-latches onto the best qualifying candidate only when the latched one stops qualifying', () => {
        const { state, ctx } = makeTwoMatedEndsRowCtx(1);
        expect(computeSnapProximityRotation(state, ctx)!.pivotLocal.x).toBeCloseTo(50);

        const group = getGroup(state, 11);
        group.position = { ...group.position, x: group.position.x + 12 };

        // d1 = 19.2 > tolerance: piece 1 stops qualifying and the latch
        // re-arms onto piece 5 (d5 = 1.2, inside the completion fraction →
        // full correction).
        const rearmed = computeSnapProximityRotation(state, ctx)!;
        expect(rearmed.pivotLocal.x).toBeCloseTo(450);
        expect(rearmed.deltaDeg).toBeCloseTo(-8);

        // Back where piece 1 qualifies again AND is closer — the new latch
        // holds regardless.
        group.position = { ...group.position, x: group.position.x - 12 };
        expect(computeSnapProximityRotation(state, ctx)!.pivotLocal.x).toBeCloseTo(450);
    });
});
