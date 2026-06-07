import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    checkEdgeAlignment,
    detectMerges,
    MERGE_TOLERANCE_PX,
    MERGE_ROTATION_TOLERANCE_DEG,
} from './merge-detection.js';
import { makePiece, makeGameState } from '../test-helpers/fixtures.js';

// --- Test helpers ---

/** Create a minimal edge. */
function makeEdge(
    id: number,
    start: Point,
    end: Point,
    matePieceId: number = -1,
    mateEdgeId: number = -1,
): Edge {
    return { id, mateEdgeId, matePieceId, path: '', start, end };
}

/** Create a single-piece group at a position. */
function makeGroup(id: number, pieceId: number, position: Point): PieceGroup {
    return {
        id,
        pieces: new Map([[pieceId, { x: 0, y: 0 }]]),
        position,
        rotation: 0,
    };
}

/**
 * Create two adjacent pieces that share a vertical edge.
 *
 * Piece 0 (left, 100×100):
 *   right edge: start=(100,0), end=(100,100)
 *
 * Piece 1 (right, 100×100):
 *   left edge: start=(100,100), end=(100,0)
 *   (Note: left edge runs bottom-to-top in piece-local coords
 *    but we use 0-based coords here so left edge is at x=0)
 *
 * Actually let's keep it simple with piece-local coords:
 * Piece 0: right edge from (100,0) to (100,100), mates with piece 1
 * Piece 1: left edge from (0,100) to (0,0), mates with piece 0
 */
function createAdjacentPiecePair(): {
    piece0: Piece;
    piece1: Piece;
    rightEdge: Edge;
    leftEdge: Edge;
} {
    const rightEdge = makeEdge(0, { x: 100, y: 0 }, { x: 100, y: 100 }, 1, 1);
    const leftEdge = makeEdge(1, { x: 0, y: 100 }, { x: 0, y: 0 }, 0, 0);

    const piece0 = makePiece({ id: 0, edges: [
        makeEdge(10, { x: 0, y: 0 }, { x: 100, y: 0 }),  // top (border)
        rightEdge,                                           // right (mates with piece 1)
        makeEdge(11, { x: 100, y: 100 }, { x: 0, y: 100 }), // bottom (border)
        makeEdge(12, { x: 0, y: 100 }, { x: 0, y: 0 }),     // left (border)
    ] });

    const piece1 = makePiece({ id: 1, edges: [
        makeEdge(13, { x: 0, y: 0 }, { x: 100, y: 0 }),  // top (border)
        makeEdge(14, { x: 100, y: 0 }, { x: 100, y: 100 }), // right (border)
        makeEdge(15, { x: 100, y: 100 }, { x: 0, y: 100 }), // bottom (border)
        leftEdge,                                              // left (mates with piece 0)
    ] });

    return { piece0, piece1, rightEdge, leftEdge };
}

describe('checkEdgeAlignment', () => {
    it('detects alignment when edges are perfectly positioned', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Place piece 0 at (0,0), piece 1 at (100,0) — perfectly adjacent
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0);
        expect(result.snapDelta.y).toBeCloseTo(0);
    });

    it('detects alignment within tolerance', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Place piece 1 slightly off — within tolerance
        const offset = MERGE_TOLERANCE_PX - 1;
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100 + offset, y: 0 });

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
        );

        expect(result.aligned).toBe(true);
        // Snap delta moves the moved group toward the target to align
        expect(result.snapDelta.x).toBeCloseTo(offset);
        expect(result.snapDelta.y).toBeCloseTo(0);
    });

    it('rejects alignment beyond tolerance', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Place piece 1 too far away
        const offset = MERGE_TOLERANCE_PX + 5;
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100 + offset, y: 0 });

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
        );

        expect(result.aligned).toBe(false);
    });

    it('handles diagonal misalignment', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Off by ~14px diagonally (10,10) = sqrt(200) ≈ 14.14 — within tolerance of 18
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 110, y: 10 });

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
        );

        expect(result.aligned).toBe(true);
    });

    it('computes correct snap delta for vertical misalignment', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Piece 1 is at correct x but 10px too low
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 10 });

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0);
        // Moved group needs to shift down by 10 to align with target at y=10
        expect(result.snapDelta.y).toBeCloseTo(10);
    });

    it('rejects when the two groups have different rotations beyond tolerance', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Groups in identical world positions, but one is rotated 90°.
        // 90° difference is well beyond the 10° tolerance.
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 100, y: 0 },
            rotation: 90,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
        );

        expect(result.aligned).toBe(false);
    });

    it('accepts alignment when both groups share the same non-zero rotation', () => {
        // Both pieces are rotated 90° CW around their group origins.
        // Piece 0's right edge starts at (100,0) → world (0,100).
        // Piece 0's right edge ends at (100,100) → world (-100,100).
        // Piece 1's left edge (start (0,100), end (0,0)) with piece 1's
        // rotation=90 around group 1's origin gives:
        //   start (0,100) → (-100, 0)
        //   end   (0,0)   → (0, 0)
        // To mate piece 0's right with piece 1's left, target_end must
        // coincide with moved_start, and target_start with moved_end.
        // So place group 1 at world (0, 100): piece 1's end goes to (0,100),
        // and its start goes to (-100, 100). That matches piece 0's (0,100)
        // and (-100,100). Aligned.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        const group0: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 90,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 0, y: 100 },
            rotation: 90,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map([
                [0, piece0],
                [1, piece1],
            ]),
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0);
        expect(result.snapDelta.y).toBeCloseTo(0);
    });

    it('uses custom tolerance when provided', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // 15px off — within default tolerance (18) but outside custom (10)
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 115, y: 0 });

        const strictResult = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
            10,
        );
        expect(strictResult.aligned).toBe(false);

        const lenientResult = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            new Map(),
            20,
        );
        expect(lenientResult.aligned).toBe(true);
    });
});

describe('checkEdgeAlignment with angular tolerance', () => {
    it('exposes MERGE_ROTATION_TOLERANCE_DEG = 10', () => {
        expect(MERGE_ROTATION_TOLERANCE_DEG).toBe(10);
    });

    it('rejects pairs whose rotations differ by more than the tolerance', () => {
        // 15° > 10° tolerance → must reject regardless of position
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const piecesById = new Map([[0, piece0], [1, piece1]]);

        const group0: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 100, y: 0 },
            rotation: 15,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            piecesById,
        );

        expect(result.aligned).toBe(false);
        expect(result.snapDelta).toEqual({ x: 0, y: 0 });
    });

    it('accepts pairs whose rotations differ by less than the tolerance', () => {
        // movedGroup.rotation = 5°, targetGroup.rotation = 0°.
        // rotDelta = signedAngularDelta(0, 5) = -5°, within tolerance.
        //
        // After a -5° snap around the bbox center (50,50 local for a 100×100
        // piece at offset (0,0)), the snapped world endpoints of the moved
        // right-edge are at approximately (95.45, 4.17) and (95.45, 104.17).
        // Placing targetGroup (rotation=0) at (95.45, 4.17) achieves perfect
        // positional alignment post-snap.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const piecesById = new Map([[0, piece0], [1, piece1]]);

        // Derived: worldCenter of group0 = localToWorld({50,50}, rot=5°, pos=(0,0))
        //  = rotatePoint({50,50},5°) = {45.45, 54.17}
        // Snapped movedStart (rightEdge.start={100,0}):
        //  offsetFromCenter = {50,-50}, rotated by 0° = {50,-50}
        //  world = {45.45+50, 54.17-50} = {95.45, 4.17}
        const group0: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 5,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 95.45, y: 4.17 },
            rotation: 0,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            piecesById,
        );

        expect(result.aligned).toBe(true);
        // Perfect alignment after snap → snapDelta is ~zero
        expect(result.snapDelta.x).toBeCloseTo(0, 1);
        expect(result.snapDelta.y).toBeCloseTo(0, 1);
    });

    it('rejects a 15° delta with default tolerance but accepts with rotationTolerance=20', () => {
        // rotDelta = signedAngularDelta(0, 15) = -15°
        //
        // worldCenter of group0 = rotatePoint({50,50}, 15°):
        //   cos(15°)≈0.9659, sin(15°)≈0.2588
        //   x = 50*0.9659 - 50*0.2588 ≈ 35.36
        //   y = 50*0.2588 + 50*0.9659 ≈ 61.24
        //
        // After -15° snap of group0 (newRotation=0°), movedEdge.start={100,0}:
        //   offsetFromCenter = {50,-50}, rotated by 0° = {50,-50}
        //   world = {35.36+50, 61.24-50} = {85.36, 11.24}
        //
        // targetEdge.end={0,0}, group1 at pos=(85.36,11.24), rot=0° → targetEnd=(85.36,11.24) ✓
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const piecesById = new Map([[0, piece0], [1, piece1]]);

        const group0: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 15,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 85.36, y: 11.24 },
            rotation: 0,
        };

        // 15° > 10° default → rejected with default rotationTolerance
        const rejectedResult = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            piecesById,
        );
        expect(rejectedResult.aligned).toBe(false);

        // 15° < 20° → accepted when rotationTolerance=20 is passed
        const acceptedResult = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            piecesById,
            MERGE_TOLERANCE_PX,
            20,
        );
        expect(acceptedResult.aligned).toBe(true);
    });

    it('accepts pairs whose rotations match exactly (quarter-turn parity)', () => {
        // Both at rotation=90°. rotDelta=0, so getWorldPositionAfterRotationSnap
        // collapses to getWorldPosition — identical to pre-T4 behavior.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const piecesById = new Map([[0, piece0], [1, piece1]]);

        const group0: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 90,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 0, y: 100 },
            rotation: 90,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            piecesById,
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0);
        expect(result.snapDelta.y).toBeCloseTo(0);
    });

    it('correctly handles wrap-around (e.g. moved=355°, target=5°)', () => {
        // signedAngularDelta(5, 355) = 5 - 355 = -350 → wrapped = 10°
        // |10| === tolerance → should NOT be rejected (> not >=).
        // Position group0 at rotation=355°, group1 at rotation=5°, with
        // group1 positioned to align perfectly after the +10° snap of group0.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const piecesById = new Map([[0, piece0], [1, piece1]]);

        // rotDelta = signedAngularDelta(5, 355) = 10°
        // After +10° snap of group0 (rot=355°→365°=5°), endpoints match target (rot=5°).
        // If both groups effectively end up at rotation=5° with adjacent positions,
        // use the existing rotation=5° adjacent layout.
        //
        // worldCenter of group0 = localToWorld({50,50}, rot=355°, pos=(0,0))
        //  cos(355°)≈0.9962, sin(355°)≈-0.0872
        //  rotatePoint({50,50},355°) = {50*0.9962-50*(-0.0872), 50*(-0.0872)+50*0.9962}
        //                            = {49.81+4.36, -4.36+49.81} = {54.17, 45.45}
        //
        // After snap (newRotation=5°):
        //  movedEdge.start={100,0}: offsetFromCenter={50,-50}
        //  rotated by 5°: x=50*cos5-(-50)*sin5=49.81+4.36=54.17, y=50*sin5+(-50)*cos5=4.36-49.81=-45.45
        //  world = {54.17+54.17, 45.45-45.45} = {108.34, 0}
        //
        // targetEdge.end={0,0}, group1 at pos=(108.34, 0), rot=5°:
        //  targetEnd = localToWorld({0,0}, rot=5°, pos=(108.34,0)) = {108.34, 0}
        //  → matches movedStart = {108.34, 0} ✓
        const group0: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 355,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 108.34, y: 0 },
            rotation: 5,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            piecesById,
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0, 1);
        expect(result.snapDelta.y).toBeCloseTo(0, 1);
    });
});

describe('detectMerges', () => {
    it('finds a merge when two adjacent pieces are close enough', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 5 }); // 5px off vertically

        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });
        const candidates = detectMerges(0, state);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].movedGroup.id).toBe(0);
        expect(candidates[0].targetGroup.id).toBe(1);
    });

    it('returns empty when pieces are too far apart', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 500, y: 500 }); // way too far

        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });
        const candidates = detectMerges(0, state);

        expect(candidates).toHaveLength(0);
    });

    it('returns empty for an invalid group ID', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();
        const state = makeGameState({ pieces: [piece0, piece1], groups: [makeGroup(0, 0, { x: 0, y: 0 }), makeGroup(1, 1, { x: 100, y: 0 })] });

        const candidates = detectMerges(999, state);
        expect(candidates).toHaveLength(0);
    });

    it('does not report edges between pieces in the same group', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        // Both pieces in the same group — no merge candidate
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };

        const state = makeGameState({ pieces: [piece0, piece1], groups: [group] });
        const candidates = detectMerges(0, state);

        expect(candidates).toHaveLength(0);
    });

    it('finds multiple merge candidates when surrounded', () => {
        // Create a center piece with mates on two sides
        const centerRight = makeEdge(0, { x: 100, y: 0 }, { x: 100, y: 100 }, 1, 1);
        const centerBottom = makeEdge(2, { x: 100, y: 100 }, { x: 0, y: 100 }, 2, 3);

        const rightLeft = makeEdge(1, { x: 0, y: 100 }, { x: 0, y: 0 }, 0, 0);
        const bottomTop = makeEdge(3, { x: 0, y: 0 }, { x: 100, y: 0 }, 0, 2);

        const center = makePiece({ id: 0, edges: [
            makeEdge(10, { x: 0, y: 0 }, { x: 100, y: 0 }),   // top (border)
            centerRight,
            centerBottom,
            makeEdge(11, { x: 0, y: 100 }, { x: 0, y: 0 }),   // left (border)
        ] });

        const rightPiece = makePiece({ id: 1, edges: [
            makeEdge(12, { x: 0, y: 0 }, { x: 100, y: 0 }),
            makeEdge(13, { x: 100, y: 0 }, { x: 100, y: 100 }),
            makeEdge(14, { x: 100, y: 100 }, { x: 0, y: 100 }),
            rightLeft,
        ] });

        const bottomPiece = makePiece({ id: 2, edges: [
            bottomTop,
            makeEdge(15, { x: 100, y: 0 }, { x: 100, y: 100 }),
            makeEdge(16, { x: 100, y: 100 }, { x: 0, y: 100 }),
            makeEdge(17, { x: 0, y: 100 }, { x: 0, y: 0 }),
        ] });

        // Position all pieces perfectly adjacent
        const centerGroup = makeGroup(0, 0, { x: 0, y: 0 });
        const rightGroup = makeGroup(1, 1, { x: 100, y: 0 });
        const bottomGroup = makeGroup(2, 2, { x: 0, y: 100 });

        const state = makeGameState({ pieces: [center, rightPiece, bottomPiece], groups: [centerGroup, rightGroup, bottomGroup] });

        const candidates = detectMerges(0, state);

        // Should find both neighbors
        expect(candidates).toHaveLength(2);

        const targetGroupIds = candidates.map((c) => c.targetGroup.id).sort();
        expect(targetGroupIds).toEqual([1, 2]);
    });

    it('includes correct snap delta in candidates', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        // Piece 1 is 8px too far right, 5px too high
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 108, y: -5 });

        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });
        const candidates = detectMerges(0, state);

        expect(candidates).toHaveLength(1);
        // Snap delta moves the moved group to align with the target:
        // 8px right (toward target) and 5px up (target is above)
        expect(candidates[0].snapDelta.x).toBeCloseTo(8);
        expect(candidates[0].snapDelta.y).toBeCloseTo(-5);
    });
});
