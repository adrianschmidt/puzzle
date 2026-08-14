import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    checkEdgeAlignment,
    detectMerges,
    measureEdgeAlignment,
    MERGE_TOLERANCE_PX,
    MERGE_ROTATION_TOLERANCE_DEG,
} from './merge-detection.js';
import { makePiece, makeGameState, makeWideRowScenario } from '../test-helpers/fixtures.js';

function makeEdge(
    id: number,
    start: Point,
    end: Point,
    matePieceId: number = -1,
    mateEdgeId: number = -1,
): Edge {
    return { id, mateEdgeId, matePieceId, path: '', start, end };
}

function makeGroup(id: number, pieceId: number, position: Point): PieceGroup {
    return {
        id,
        pieces: new Map([[pieceId, { x: 0, y: 0 }]]),
        position,
        rotation: 0,
    };
}

/**
 * Two adjacent 100×100 pieces sharing a vertical edge (local coords): piece 0's
 * right edge (100,0)→(100,100) mates piece 1's left edge (0,100)→(0,0).
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
        );

        expect(result.aligned).toBe(false);
    });

    it('accepts alignment when both groups share the same non-zero rotation', () => {
        // Both groups at 90°. group1 is placed at world (0,100) so piece 1's
        // rotated left edge coincides with piece 0's rotated right edge.
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
            10,
        );
        expect(strictResult.aligned).toBe(false);

        const lenientResult = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
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
        );

        expect(result.aligned).toBe(false);
        expect(result.snapDelta).toEqual({ x: 0, y: 0 });
    });

    it('accepts pairs whose rotations differ by less than the tolerance', () => {
        // moved rot=5°, target rot=0° → rotDelta -5°, within tolerance. After
        // the -5° snap around the piece center, the moved right-edge start lands
        // at ~(95.45, 4.17); target is placed there for perfect post-snap alignment.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

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
        );

        expect(result.aligned).toBe(true);
        // Perfect alignment after snap → snapDelta is ~zero
        expect(result.snapDelta.x).toBeCloseTo(0, 1);
        expect(result.snapDelta.y).toBeCloseTo(0, 1);
    });

    it('rejects a 15° delta with default tolerance but accepts with rotationTolerance=20', () => {
        // rotDelta = -15°. group1 is placed at (85.36, 11.24), the moved
        // right-edge start after the -15° snap, so it aligns post-snap.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

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
        );
        expect(rejectedResult.aligned).toBe(false);

        // 15° < 20° → accepted when rotationTolerance=20 is passed
        const acceptedResult = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
            MERGE_TOLERANCE_PX,
            20,
        );
        expect(acceptedResult.aligned).toBe(true);
    });

    it('accepts pairs whose rotations match exactly (quarter-turn parity)', () => {
        // Both at 90°: rotDelta=0, so the snap collapses to getWorldPosition.
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
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0);
        expect(result.snapDelta.y).toBeCloseTo(0);
    });

    it('correctly handles wrap-around (e.g. moved=355°, target=5°)', () => {
        // signedAngularDelta(5, 355) = 10° (wrapped); |10| == tolerance → not
        // rejected (> not >=). group1 at (108.34, 0) aligns after group0's +10° snap.
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

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
        );

        expect(result.aligned).toBe(true);
        expect(result.snapDelta.x).toBeCloseTo(0, 1);
        expect(result.snapDelta.y).toBeCloseTo(0, 1);
    });
});

describe('measureEdgeAlignment', () => {
    it('reports distance, rotation delta, and snap delta for an offset pair', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 112, y: 0 }); // 12px right of aligned

        const m = measureEdgeAlignment(
            piece1, leftEdge, group1,
            piece0, rightEdge, group0,
        );

        expect(m.rotationDelta).toBeCloseTo(0);
        expect(m.distance).toBeCloseTo(12);
        expect(m.snapDelta.x).toBeCloseTo(-12);
        expect(m.snapDelta.y).toBeCloseTo(0);
    });

    it('reports the wrap-aware rotation delta (target − moved)', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        group0.rotation = 10;
        group1.rotation = 350;

        const m = measureEdgeAlignment(
            piece1, leftEdge, group1,
            piece0, rightEdge, group0,
        );

        // From 350° to 10° the short way is +20°, not −340°.
        expect(m.rotationDelta).toBeCloseTo(20);
    });
});

describe('piece-anchored rotation snap pivot (issue #530)', () => {
    it('measures a flush edge on a wide group as flush, regardless of group size', () => {
        const { movedGroup, targetGroup, piece0, piece1 } = makeWideRowScenario(8);

        const m = measureEdgeAlignment(
            piece1, piece1.edges[3], movedGroup,
            piece0, piece0.edges[1], targetGroup,
        );

        expect(m.rotationDelta).toBeCloseTo(-8);
        expect(m.distance).toBeCloseTo(0, 6);
    });

    it('accepts the wide-group flush edge within default tolerances', () => {
        const { movedGroup, targetGroup, piece0, piece1 } = makeWideRowScenario(8);

        const result = checkEdgeAlignment(
            piece1, piece1.edges[3], movedGroup,
            piece0, piece0.edges[1], targetGroup,
        );

        expect(result.aligned).toBe(true);
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

        expect(candidates).toHaveLength(2);

        const targetGroupIds = candidates.map((c) => c.targetGroup.id).sort((a, b) => a - b);
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
        // Snap delta aligns the moved group: 8px right, 5px up.
        expect(candidates[0].snapDelta.x).toBeCloseTo(8);
        expect(candidates[0].snapDelta.y).toBeCloseTo(-5);
    });
});
