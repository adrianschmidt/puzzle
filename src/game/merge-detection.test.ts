import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    checkEdgeAlignment,
    detectMerges,
    getWorldPosition,
    MERGE_TOLERANCE_PX,
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

describe('getWorldPosition', () => {
    it('computes world position from group position + offset + point', () => {
        const group: PieceGroup = {
            id: 1,
            pieces: new Map([[5, { x: 10, y: 20 }]]),
            position: { x: 100, y: 200 },
            rotation: 0,
        };

        const result = getWorldPosition({ x: 30, y: 40 }, 5, group);
        expect(result).toEqual({ x: 140, y: 260 });
    });

    it('handles zero offset (single-piece group)', () => {
        const group = makeGroup(1, 5, { x: 50, y: 75 });
        const result = getWorldPosition({ x: 10, y: 20 }, 5, group);
        expect(result).toEqual({ x: 60, y: 95 });
    });

    it('throws if piece is not in the group', () => {
        const group = makeGroup(1, 5, { x: 0, y: 0 });
        expect(() => getWorldPosition({ x: 0, y: 0 }, 99, group)).toThrow();
    });

    it('applies rotation to the local point before translating', () => {
        // Group at world (100, 200), rotated 90° CW, single piece at local (0,0)
        const group: PieceGroup = {
            id: 1,
            pieces: new Map([[5, { x: 0, y: 0 }]]),
            position: { x: 100, y: 200 },
            rotation: 1,
        };

        // Local point (10, 0) rotated 90° CW → (0, 10); then + position
        const result = getWorldPosition({ x: 10, y: 0 }, 5, group);
        expect(result).toEqual({ x: 100, y: 210 });
    });

    it('applies rotation with a non-zero piece offset', () => {
        // Offset + point = local (10, 0); rotated 180° → (-10, 0)
        const group: PieceGroup = {
            id: 1,
            pieces: new Map([[5, { x: 10, y: 0 }]]),
            position: { x: 50, y: 50 },
            rotation: 2,
        };

        const result = getWorldPosition({ x: 0, y: 0 }, 5, group);
        expect(result).toEqual({ x: 40, y: 50 });
    });
});

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

    it('rejects when the two groups have different rotations', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Groups in identical world positions, but one is rotated.
        // Without the rotation gate, endpoint distances at certain
        // symmetry points could falsely register as aligned.
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 100, y: 0 },
            rotation: 1,
        };

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
        );

        expect(result.aligned).toBe(false);
    });

    it('accepts alignment when both groups share the same non-zero rotation', () => {
        // Both pieces are rotated 90° CW around their group origins.
        // Piece 0's right edge starts at (100,0) → world (0,100).
        // Piece 0's right edge ends at (100,100) → world (-100,100).
        // Piece 1's left edge (start (0,100), end (0,0)) with piece 1's
        // rotation=1 around group 1's origin gives:
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
            rotation: 1,
        };
        const group1: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 0, y: 100 },
            rotation: 1,
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
