import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    rectsOverlap,
    padRect,
    shouldSuppressMerge,
    PILE_OVERLAP_THRESHOLD,
} from './pile-detection.js';
import { makePiece, makeGameState } from '../test-helpers/fixtures.js';

// --- Test helpers ---

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
 * Create a simple 100×100 piece with four straight edges.
 * Optionally set mate info for specific edges.
 */
function makeSquarePiece(
    id: number,
    mates?: {
        right?: { pieceId: number; edgeId: number };
        bottom?: { pieceId: number; edgeId: number };
        left?: { pieceId: number; edgeId: number };
        top?: { pieceId: number; edgeId: number };
    },
): Piece {
    const edgeBase = id * 4;
    const m = mates ?? {};

    return makePiece({ id, edges: [
        makeEdge(
            edgeBase,
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            m.top?.pieceId ?? -1,
            m.top?.edgeId ?? -1,
        ), // top
        makeEdge(
            edgeBase + 1,
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            m.right?.pieceId ?? -1,
            m.right?.edgeId ?? -1,
        ), // right
        makeEdge(
            edgeBase + 2,
            { x: 100, y: 100 },
            { x: 0, y: 100 },
            m.bottom?.pieceId ?? -1,
            m.bottom?.edgeId ?? -1,
        ), // bottom
        makeEdge(
            edgeBase + 3,
            { x: 0, y: 100 },
            { x: 0, y: 0 },
            m.left?.pieceId ?? -1,
            m.left?.edgeId ?? -1,
        ), // left
    ] });
}

// --- Tests ---

describe('rectsOverlap', () => {
    it('detects overlap when rects share a region', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 50, minY: 50, maxX: 150, maxY: 150 };

        expect(rectsOverlap(a, b)).toBe(true);
    });

    it('detects overlap when one rect is inside another', () => {
        const a = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
        const b = { minX: 50, minY: 50, maxX: 150, maxY: 150 };

        expect(rectsOverlap(a, b)).toBe(true);
        expect(rectsOverlap(b, a)).toBe(true);
    });

    it('detects overlap at shared edge', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 100, minY: 0, maxX: 200, maxY: 100 };

        expect(rectsOverlap(a, b)).toBe(true);
    });

    it('returns false when rects are separated horizontally', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 200, minY: 0, maxX: 300, maxY: 100 };

        expect(rectsOverlap(a, b)).toBe(false);
    });

    it('returns false when rects are separated vertically', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 0, minY: 200, maxX: 100, maxY: 300 };

        expect(rectsOverlap(a, b)).toBe(false);
    });

    it('returns false when rects are diagonally separated', () => {
        const a = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
        const b = { minX: 100, minY: 100, maxX: 150, maxY: 150 };

        expect(rectsOverlap(a, b)).toBe(false);
    });
});

describe('padRect', () => {
    it('expands a rect in all directions', () => {
        const rect = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
        const padded = padRect(rect, 10);

        expect(padded).toEqual({
            minX: 40,
            minY: 40,
            maxX: 160,
            maxY: 160,
        });
    });

    it('handles zero padding', () => {
        const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const padded = padRect(rect, 0);

        expect(padded).toEqual(rect);
    });

    it('can use negative padding to shrink', () => {
        const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const padded = padRect(rect, -10);

        expect(padded).toEqual({
            minX: 10,
            minY: 10,
            maxX: 90,
            maxY: 90,
        });
    });
});

describe('shouldSuppressMerge', () => {
    it('returns false when only a few groups are nearby', () => {
        // Dropped piece has 1 non-mate neighbor — not a pile
        const piece0 = makeSquarePiece(0, {
            right: { pieceId: 1, edgeId: 5 },
        });
        const piece1 = makeSquarePiece(1, {
            left: { pieceId: 0, edgeId: 1 },
        });
        const piece2 = makeSquarePiece(2); // no mate relationship

        const group0 = makeGroup(0, 0, { x: 50, y: 50 });
        const group1 = makeGroup(1, 1, { x: 150, y: 50 });
        const group2 = makeGroup(2, 2, { x: 50, y: 50 }); // overlapping, non-mate

        const state = makeGameState({ pieces: [piece0, piece1, piece2], groups: [group0, group1, group2] });

        // Only 1 non-mate overlap — below threshold
        expect(shouldSuppressMerge(0, state)).toBe(false);
    });

    it('returns true when many non-matching groups overlap (a pile)', () => {
        // Create a piece with one mate and many non-mate pieces piled on top
        const mates = { right: { pieceId: 1, edgeId: 5 } };
        const piece0 = makeSquarePiece(0, mates);
        const piece1 = makeSquarePiece(1, {
            left: { pieceId: 0, edgeId: 1 },
        });

        // Non-mate pieces piled on top
        const piece2 = makeSquarePiece(2);
        const piece3 = makeSquarePiece(3);
        const piece4 = makeSquarePiece(4);

        const group0 = makeGroup(0, 0, { x: 50, y: 50 });
        const group1 = makeGroup(1, 1, { x: 150, y: 50 }); // mate, overlapping

        // Three non-mate groups all overlapping at the same spot
        const group2 = makeGroup(2, 2, { x: 55, y: 55 });
        const group3 = makeGroup(3, 3, { x: 60, y: 60 });
        const group4 = makeGroup(4, 4, { x: 45, y: 45 });

        const state = makeGameState({ pieces: [piece0, piece1, piece2, piece3, piece4], groups: [group0, group1, group2, group3, group4] });

        // 3 non-mate overlaps (>= PILE_OVERLAP_THRESHOLD) and > 1 mate overlap
        expect(shouldSuppressMerge(0, state)).toBe(true);
    });

    it('returns false when group is not found', () => {
        const state = makeGameState({ pieces: [], groups: [] });
        expect(shouldSuppressMerge(999, state)).toBe(false);
    });

    it('returns false when moved group has multiple pieces (assembled chunk)', () => {
        // A group of 2+ pieces is an intentional placement, not sorting
        const piece0 = makeSquarePiece(0);
        const piece1 = makeSquarePiece(1);
        const piece2 = makeSquarePiece(2);
        const piece3 = makeSquarePiece(3);
        const piece4 = makeSquarePiece(4);

        // Moved group has 2 pieces (already partially assembled)
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 50, y: 50 },
            rotation: 0,
        };

        // Pile of non-mates
        const group2 = makeGroup(2, 2, { x: 55, y: 55 });
        const group3 = makeGroup(3, 3, { x: 60, y: 60 });
        const group4 = makeGroup(4, 4, { x: 45, y: 45 });

        const state = makeGameState({ pieces: [piece0, piece1, piece2, piece3, piece4], groups: [movedGroup, group2, group3, group4] });

        // Multi-piece group → never suppressed
        expect(shouldSuppressMerge(0, state)).toBe(false);
    });

    it('allows merge into a gap in an assembled section (mates outnumber non-mates)', () => {
        // Piece 0 is being placed into a gap surrounded by matching pieces.
        // Create mates on multiple sides.
        const piece0 = makeSquarePiece(0, {
            right: { pieceId: 1, edgeId: 5 },
            bottom: { pieceId: 2, edgeId: 10 },
            left: { pieceId: 3, edgeId: 15 },
            top: { pieceId: 4, edgeId: 16 },
        });
        const piece1 = makeSquarePiece(1, {
            left: { pieceId: 0, edgeId: 1 },
        });
        const piece2 = makeSquarePiece(2, {
            top: { pieceId: 0, edgeId: 2 },
        });
        const piece3 = makeSquarePiece(3, {
            right: { pieceId: 0, edgeId: 3 },
        });
        const piece4 = makeSquarePiece(4, {
            bottom: { pieceId: 0, edgeId: 0 },
        });

        // One non-mate also in the area
        const piece5 = makeSquarePiece(5);

        const group0 = makeGroup(0, 0, { x: 100, y: 100 }); // dropped piece
        const group1 = makeGroup(1, 1, { x: 200, y: 100 }); // mate right
        const group2 = makeGroup(2, 2, { x: 100, y: 200 }); // mate below
        const group3 = makeGroup(3, 3, { x: 0, y: 100 });   // mate left
        const group4 = makeGroup(4, 4, { x: 100, y: 0 });   // mate above
        const group5 = makeGroup(5, 5, { x: 105, y: 105 }); // non-mate overlap

        const state = makeGameState({ pieces: [piece0, piece1, piece2, piece3, piece4, piece5], groups: [group0, group1, group2, group3, group4, group5] });

        // 4 mate overlaps, 1 non-mate → mates outnumber, so NOT suppressed
        expect(shouldSuppressMerge(0, state)).toBe(false);
    });

    it('does not suppress when non-mate groups are not overlapping', () => {
        const piece0 = makeSquarePiece(0, {
            right: { pieceId: 1, edgeId: 5 },
        });
        const piece1 = makeSquarePiece(1, {
            left: { pieceId: 0, edgeId: 1 },
        });
        const piece2 = makeSquarePiece(2);
        const piece3 = makeSquarePiece(3);
        const piece4 = makeSquarePiece(4);

        const group0 = makeGroup(0, 0, { x: 50, y: 50 });
        const group1 = makeGroup(1, 1, { x: 150, y: 50 });

        // Non-mates are far away — no overlap
        const group2 = makeGroup(2, 2, { x: 500, y: 500 });
        const group3 = makeGroup(3, 3, { x: 600, y: 600 });
        const group4 = makeGroup(4, 4, { x: 700, y: 700 });

        const state = makeGameState({ pieces: [piece0, piece1, piece2, piece3, piece4], groups: [group0, group1, group2, group3, group4] });

        expect(shouldSuppressMerge(0, state)).toBe(false);
    });

    it('suppresses when exactly at threshold', () => {
        // PILE_OVERLAP_THRESHOLD non-mates overlapping, 0 mates overlapping
        const piece0 = makeSquarePiece(0);
        const pieces = [piece0];
        const groups: PieceGroup[] = [makeGroup(0, 0, { x: 50, y: 50 })];

        // Create exactly PILE_OVERLAP_THRESHOLD non-mate overlapping groups
        for (let i = 1; i <= PILE_OVERLAP_THRESHOLD; i++) {
            pieces.push(makeSquarePiece(i));
            groups.push(makeGroup(i, i, { x: 50 + i * 5, y: 50 + i * 5 }));
        }

        const state = makeGameState({ pieces: pieces, groups: groups });

        // Non-mates >= threshold and > 0 mates → suppressed
        expect(shouldSuppressMerge(0, state)).toBe(true);
    });

    it('does not falsely suppress when the moved group is rotated (issue #237)', () => {
        // Regression for issue #237: getGroupBounds must account for group
        // rotation. When it doesn't, a rotated moved piece's bounds sit at
        // the wrong world location, so the overlap check silently walks past
        // its real mate and instead counts unrelated loose pieces that happen
        // to lie at the phantom shifted location — tripping the pile filter
        // and vetoing a perfectly legitimate drop.
        //
        // Layout (visual / world space):
        //   - Moved piece at visual AABB [0..100] × [0..100]  (rotation 1)
        //   - Mate piece at visual AABB [-100..0] × [0..100]  (rotation 0,
        //     touching the moved piece's left edge)
        //   - Three non-mate pieces far to the right at x ≥ 150 — well
        //     outside the moved piece's visual bounds + padding.
        //
        // Because rotation 1 translates un-rotated local [0..100]² to
        // rotated-local [-100..0] × [0..100], the moved group's position
        // must be offset by (+100, 0) to place the visual AABB at [0..100]².
        // The rotation-ignorant implementation will compute the moved
        // group's bounds at [100..200]², shift the overlap window east by
        // 100 pixels, lose the real mate and pick up the three distant
        // non-mates, then suppress the merge.
        const piece0 = makeSquarePiece(0, {
            left: { pieceId: 1, edgeId: 5 }, // mates with piece 1 to the left
        });
        const piece1 = makeSquarePiece(1, {
            right: { pieceId: 0, edgeId: 3 },
        });
        const piece2 = makeSquarePiece(2); // non-mate
        const piece3 = makeSquarePiece(3); // non-mate
        const piece4 = makeSquarePiece(4); // non-mate

        // Moved group: rotated 90° CW. position = (100, 0) → visual [0..100]².
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 100, y: 0 },
            rotation: 1,
        };

        // Mate group: un-rotated, positioned so its visual AABB is
        // [-100..0] × [0..100] — touches the moved group's left edge
        // visually, well clear of the rotation-ignorant phantom bounds.
        const mateGroup = makeGroup(1, 1, { x: -100, y: 0 });

        // Three non-mate loose pieces clustered far to the right of the
        // moved piece's VISUAL bounds, but right on top of its BUGGY
        // (un-rotated) bounds at x ≈ 150..200.
        const nonMate1 = makeGroup(2, 2, { x: 150, y: 0 });
        const nonMate2 = makeGroup(3, 3, { x: 160, y: 0 });
        const nonMate3 = makeGroup(4, 4, { x: 170, y: 0 });

        const state = makeGameState({ pieces: [piece0, piece1, piece2, piece3, piece4], groups: [movedGroup, mateGroup, nonMate1, nonMate2, nonMate3] });

        expect(shouldSuppressMerge(0, state)).toBe(false);
    });

    it('does not suppress when non-mates equal mates', () => {
        // When non-mate count equals mate count, it's ambiguous —
        // we give the benefit of the doubt and allow the merge.
        const piece0 = makeSquarePiece(0, {
            right: { pieceId: 1, edgeId: 5 },
            bottom: { pieceId: 2, edgeId: 9 },
            left: { pieceId: 3, edgeId: 13 },
        });
        const piece1 = makeSquarePiece(1, {
            left: { pieceId: 0, edgeId: 1 },
        });
        const piece2 = makeSquarePiece(2, {
            top: { pieceId: 0, edgeId: 2 },
        });
        const piece3 = makeSquarePiece(3, {
            right: { pieceId: 0, edgeId: 3 },
        });

        // 3 non-mates
        const piece4 = makeSquarePiece(4);
        const piece5 = makeSquarePiece(5);
        const piece6 = makeSquarePiece(6);

        const group0 = makeGroup(0, 0, { x: 100, y: 100 });
        const group1 = makeGroup(1, 1, { x: 200, y: 100 }); // mate
        const group2 = makeGroup(2, 2, { x: 100, y: 200 }); // mate
        const group3 = makeGroup(3, 3, { x: 0, y: 100 });   // mate
        const group4 = makeGroup(4, 4, { x: 105, y: 105 }); // non-mate
        const group5 = makeGroup(5, 5, { x: 110, y: 110 }); // non-mate
        const group6 = makeGroup(6, 6, { x: 115, y: 115 }); // non-mate

        const state = makeGameState({ pieces: [piece0, piece1, piece2, piece3, piece4, piece5, piece6], groups: [group0, group1, group2, group3, group4, group5, group6] });

        // 3 non-mates = 3 mates, non-mates do NOT outnumber mates → allow merge
        expect(shouldSuppressMerge(0, state)).toBe(false);
    });
});
