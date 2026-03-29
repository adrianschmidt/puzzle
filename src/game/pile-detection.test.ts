import { describe, it, expect } from 'vitest';
import type { Edge, GameState, Piece, PieceGroup, Point } from '../model/types.js';
import {
    getGroupBounds,
    rectsOverlap,
    padRect,
    rectFullyContains,
    shouldSuppressMerge,
    reorderGroupsAfterDrop,
    PILE_OVERLAP_THRESHOLD,
} from './pile-detection.js';

// --- Test helpers ---

function makePiece(id: number, edges: Edge[]): Piece {
    return { id, edges, shape: '', imageOffset: { x: 0, y: 0 } };
}

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
    };
}

function makeGameState(
    pieces: Piece[],
    groups: PieceGroup[],
): GameState {
    return { pieces, groups, imageUrl: 'test.jpg', imageSize: { width: 800, height: 600 }, gridSize: { cols: 8, rows: 6 }, completed: false };
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

    return makePiece(id, [
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
    ]);
}

// --- Tests ---

describe('getGroupBounds', () => {
    it('computes bounds for a single-piece group', () => {
        const piece = makeSquarePiece(0);
        const group = makeGroup(0, 0, { x: 50, y: 75 });

        const bounds = getGroupBounds(group, [piece]);

        expect(bounds.minX).toBe(50);
        expect(bounds.minY).toBe(75);
        expect(bounds.maxX).toBe(150);
        expect(bounds.maxY).toBe(175);
    });

    it('computes bounds for a multi-piece group', () => {
        const piece0 = makeSquarePiece(0);
        const piece1 = makeSquarePiece(1);

        const group: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }], // piece 1 is to the right
            ]),
            position: { x: 10, y: 20 },
        };

        const bounds = getGroupBounds(group, [piece0, piece1]);

        expect(bounds.minX).toBe(10);      // group.x + offset0.x + edge min x (10+0+0)
        expect(bounds.minY).toBe(20);      // group.y + offset0.y + edge min y (20+0+0)
        expect(bounds.maxX).toBe(210);     // 10 + 100 + 100 (group.x + offset1.x + piece edge max x)
        expect(bounds.maxY).toBe(120);     // 20 + 0 + 100
    });

    it('handles negative group positions', () => {
        const piece = makeSquarePiece(0);
        const group = makeGroup(0, 0, { x: -50, y: -30 });

        const bounds = getGroupBounds(group, [piece]);

        expect(bounds.minX).toBe(-50);
        expect(bounds.minY).toBe(-30);
        expect(bounds.maxX).toBe(50);
        expect(bounds.maxY).toBe(70);
    });

    it('handles non-zero piece offsets within group', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 50, y: 25 }]]),
            position: { x: 100, y: 100 },
        };

        const bounds = getGroupBounds(group, [piece]);

        expect(bounds.minX).toBe(150);  // 100 + 50 + 0
        expect(bounds.minY).toBe(125);  // 100 + 25 + 0
        expect(bounds.maxX).toBe(250);  // 100 + 50 + 100
        expect(bounds.maxY).toBe(225);  // 100 + 25 + 100
    });
});

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

        const state = makeGameState(
            [piece0, piece1, piece2],
            [group0, group1, group2],
        );

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

        const state = makeGameState(
            [piece0, piece1, piece2, piece3, piece4],
            [group0, group1, group2, group3, group4],
        );

        // 3 non-mate overlaps (>= PILE_OVERLAP_THRESHOLD) and > 1 mate overlap
        expect(shouldSuppressMerge(0, state)).toBe(true);
    });

    it('returns false when group is not found', () => {
        const state = makeGameState([], []);
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
        };

        // Pile of non-mates
        const group2 = makeGroup(2, 2, { x: 55, y: 55 });
        const group3 = makeGroup(3, 3, { x: 60, y: 60 });
        const group4 = makeGroup(4, 4, { x: 45, y: 45 });

        const state = makeGameState(
            [piece0, piece1, piece2, piece3, piece4],
            [movedGroup, group2, group3, group4],
        );

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

        const state = makeGameState(
            [piece0, piece1, piece2, piece3, piece4, piece5],
            [group0, group1, group2, group3, group4, group5],
        );

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

        const state = makeGameState(
            [piece0, piece1, piece2, piece3, piece4],
            [group0, group1, group2, group3, group4],
        );

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

        const state = makeGameState(pieces, groups);

        // Non-mates >= threshold and > 0 mates → suppressed
        expect(shouldSuppressMerge(0, state)).toBe(true);
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

        const state = makeGameState(
            [piece0, piece1, piece2, piece3, piece4, piece5, piece6],
            [group0, group1, group2, group3, group4, group5, group6],
        );

        // 3 non-mates = 3 mates, non-mates do NOT outnumber mates → allow merge
        expect(shouldSuppressMerge(0, state)).toBe(false);
    });
});

describe('rectFullyContains', () => {
    it('returns true when rect A fully contains rect B', () => {
        const a = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
        const b = { minX: 50, minY: 50, maxX: 150, maxY: 150 };

        expect(rectFullyContains(a, b)).toBe(true);
    });

    it('returns true when rects are identical', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

        expect(rectFullyContains(a, b)).toBe(true);
    });

    it('returns false when B extends beyond A on the right', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 50, minY: 50, maxX: 150, maxY: 75 };

        expect(rectFullyContains(a, b)).toBe(false);
    });

    it('returns false when B extends beyond A on the left', () => {
        const a = { minX: 50, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 0, minY: 50, maxX: 75, maxY: 75 };

        expect(rectFullyContains(a, b)).toBe(false);
    });

    it('returns false when B extends beyond A vertically', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 25, minY: 50, maxX: 75, maxY: 150 };

        expect(rectFullyContains(a, b)).toBe(false);
    });

    it('returns false when rects only partially overlap', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 50, minY: 50, maxX: 150, maxY: 150 };

        expect(rectFullyContains(a, b)).toBe(false);
        expect(rectFullyContains(b, a)).toBe(false);
    });

    it('returns false when rects are separated', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 200, minY: 200, maxX: 300, maxY: 300 };

        expect(rectFullyContains(a, b)).toBe(false);
        expect(rectFullyContains(b, a)).toBe(false);
    });

    it('handles edge-touching case (rect B touches boundary of A)', () => {
        const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        const b = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

        expect(rectFullyContains(a, b)).toBe(true);
    });
});

describe('reorderGroupsAfterDrop', () => {
    it('raises smaller groups that are fully covered by dropped group', () => {
        // Create custom pieces with specific bounds to ensure proper coverage
        const largePiece = makePiece(0, [
            makeEdge(0, { x: 0, y: 0 }, { x: 200, y: 0 }),     // top
            makeEdge(1, { x: 200, y: 0 }, { x: 200, y: 200 }), // right  
            makeEdge(2, { x: 200, y: 200 }, { x: 0, y: 200 }), // bottom
            makeEdge(3, { x: 0, y: 200 }, { x: 0, y: 0 }),     // left
        ]);

        const smallPiece1 = makePiece(1, [
            makeEdge(4, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(5, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(6, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(7, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ]);

        const smallPiece2 = makePiece(2, [
            makeEdge(8, { x: 0, y: 0 }, { x: 40, y: 0 }),
            makeEdge(9, { x: 40, y: 0 }, { x: 40, y: 40 }),
            makeEdge(10, { x: 40, y: 40 }, { x: 0, y: 40 }),
            makeEdge(11, { x: 0, y: 40 }, { x: 0, y: 0 }),
        ]);

        // Create an additional piece to make the large group actually have more pieces
        const additionalPiece = makePiece(3, [
            makeEdge(12, { x: 0, y: 0 }, { x: 200, y: 0 }),
            makeEdge(13, { x: 200, y: 0 }, { x: 200, y: 200 }),
            makeEdge(14, { x: 200, y: 200 }, { x: 0, y: 200 }),
            makeEdge(15, { x: 0, y: 200 }, { x: 0, y: 0 }),
        ]);

        // Large dropped group (2 pieces for larger size)
        const largeGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],     // piece 0 covers 0-200 x 0-200
                [3, { x: 200, y: 0 }],   // piece 3 covers 200-400 x 0-200
            ]),
            position: { x: 0, y: 0 },
        }; // Combined covers 0-400 x 0-200

        // Small covered groups positioned inside the large group
        const smallGroup1 = makeGroup(1, 1, { x: 50, y: 50 }); // Covers 50-100 x 50-100 (inside)
        const smallGroup2 = makeGroup(2, 2, { x: 100, y: 100 }); // Covers 100-140 x 100-140 (inside)

        const state = makeGameState(
            [largePiece, smallPiece1, smallPiece2, additionalPiece],
            [largeGroup, smallGroup1, smallGroup2],
        );

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([0], state, mockBringToFront);

        // Both smaller groups should be raised (order doesn't matter since they're same size)
        expect(raisedGroups).toHaveLength(2);
        expect(raisedGroups).toContain(1);
        expect(raisedGroups).toContain(2);
    });

    it('does not raise groups that are larger or equal in size', () => {
        const piece0 = makeSquarePiece(0);
        const piece1 = makeSquarePiece(1);

        // Both groups have 1 piece each (same size)
        const group0 = makeGroup(0, 0, { x: 50, y: 50 });
        const group1 = makeGroup(1, 1, { x: 60, y: 60 }); // Covered but same size

        const state = makeGameState([piece0, piece1], [group0, group1]);

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([0], state, mockBringToFront);

        // No groups should be raised (same size)
        expect(raisedGroups).toHaveLength(0);
    });

    it('does not raise groups that are not fully covered', () => {
        const piece0 = makeSquarePiece(0);
        const piece1 = makeSquarePiece(1);

        const largeGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
            ]),
            position: { x: 50, y: 50 }, // Covers 50-150 x 50-150
        };

        // Small group that extends beyond the large group's bounds
        const smallGroup = makeGroup(1, 1, { x: 120, y: 120 }); // Covers 120-220 x 120-220, partially outside

        const state = makeGameState([piece0, piece1], [largeGroup, smallGroup]);

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([0], state, mockBringToFront);

        // Small group extends beyond bounds, so it should not be raised
        expect(raisedGroups).toHaveLength(0);
    });

    it('sorts raised groups by size descending (largest raised first)', () => {
        // Create a large piece that will cover multiple smaller pieces
        const largePiece = makePiece(0, [
            makeEdge(0, { x: 0, y: 0 }, { x: 300, y: 0 }),
            makeEdge(1, { x: 300, y: 0 }, { x: 300, y: 300 }),
            makeEdge(2, { x: 300, y: 300 }, { x: 0, y: 300 }),
            makeEdge(3, { x: 0, y: 300 }, { x: 0, y: 0 }),
        ]);

        // Create smaller pieces
        const mediumPiece1 = makePiece(1, [
            makeEdge(4, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(5, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(6, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(7, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ]);

        const mediumPiece2 = makePiece(2, [
            makeEdge(8, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(9, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(10, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(11, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ]);

        const smallPiece = makePiece(3, [
            makeEdge(12, { x: 0, y: 0 }, { x: 30, y: 0 }),
            makeEdge(13, { x: 30, y: 0 }, { x: 30, y: 30 }),
            makeEdge(14, { x: 30, y: 30 }, { x: 0, y: 30 }),
            makeEdge(15, { x: 0, y: 30 }, { x: 0, y: 0 }),
        ]);

        // Create additional pieces for the large group
        const additionalPiece1 = makePiece(4, [
            makeEdge(16, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(17, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(18, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(19, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        const additionalPiece2 = makePiece(5, [
            makeEdge(20, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(21, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(22, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(23, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        // Large dropped group (3 pieces)
        const largeGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [4, { x: 0, y: 300 }],
                [5, { x: 300, y: 0 }],
            ]),
            position: { x: 0, y: 0 }
        }; // Covers 0-450 x 0-450 (large enough to contain both smaller groups)

        // Medium group (2 pieces)
        const mediumGroup: PieceGroup = {
            id: 1,
            pieces: new Map([
                [1, { x: 0, y: 0 }],
                [2, { x: 0, y: 50 }],
            ]),
            position: { x: 50, y: 50 }, // Covers 50-100 x 50-150
        };

        // Small group (1 piece)
        const smallGroup = makeGroup(3, 3, { x: 100, y: 100 }); // Covers 100-130 x 100-130

        const state = makeGameState(
            [largePiece, mediumPiece1, mediumPiece2, smallPiece, additionalPiece1, additionalPiece2],
            [largeGroup, mediumGroup, smallGroup],
        );

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([0], state, mockBringToFront);

        // Should raise both covered groups, with medium group (size 2) raised before small group (size 1)
        expect(raisedGroups).toEqual([1, 3]); // Medium (2 pieces) raised first, then small (1 piece)
    });

    it('handles multiple dropped groups from multi-select', () => {
        // Create large pieces for the dropped groups
        const largePiece0 = makePiece(0, [
            makeEdge(0, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(1, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(2, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(3, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        const largePiece1 = makePiece(1, [
            makeEdge(4, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(5, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(6, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(7, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        // Small pieces that will be covered
        const smallPiece2 = makePiece(2, [
            makeEdge(8, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(9, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(10, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(11, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ]);

        const smallPiece3 = makePiece(3, [
            makeEdge(12, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(13, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(14, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(15, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ]);

        // Create additional pieces for the dropped groups to make them larger
        const additionalPiece4 = makePiece(4, [
            makeEdge(16, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(17, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(18, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(19, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        const additionalPiece5 = makePiece(5, [
            makeEdge(20, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(21, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(22, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(23, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        // Two dropped groups (from multi-select drag) - each with 2 pieces
        const droppedGroup1: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [4, { x: 0, y: 150 }],
            ]),
            position: { x: 0, y: 0 }
        }; // Covers 0-150 x 0-300

        const droppedGroup2: PieceGroup = {
            id: 1,
            pieces: new Map([
                [1, { x: 0, y: 0 }],
                [5, { x: 0, y: 150 }],
            ]),
            position: { x: 200, y: 0 }
        }; // Covers 200-350 x 0-300

        // Two smaller groups, each covered by one of the dropped groups
        const smallGroup1 = makeGroup(2, 2, { x: 50, y: 50 }); // Covers 50-100 x 50-100 (inside droppedGroup1)
        const smallGroup2 = makeGroup(3, 3, { x: 250, y: 50 }); // Covers 250-300 x 50-100 (inside droppedGroup2)

        const state = makeGameState(
            [largePiece0, largePiece1, smallPiece2, smallPiece3, additionalPiece4, additionalPiece5],
            [droppedGroup1, droppedGroup2, smallGroup1, smallGroup2],
        );

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([0, 1], state, mockBringToFront);

        // Both small groups should be raised
        expect(raisedGroups).toHaveLength(2);
        expect(raisedGroups).toContain(2);
        expect(raisedGroups).toContain(3);
    });

    it('avoids duplicate raises when multiple dropped groups cover the same small group', () => {
        // Create large pieces for the dropped groups
        const largePiece0 = makePiece(0, [
            makeEdge(0, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(1, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(2, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(3, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        const largePiece1 = makePiece(1, [
            makeEdge(4, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(5, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(6, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(7, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        // Small piece that will be covered by both
        const smallPiece2 = makePiece(2, [
            makeEdge(8, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(9, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(10, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(11, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ]);

        // Create additional pieces to make the dropped groups larger
        const additionalPiece4 = makePiece(4, [
            makeEdge(16, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(17, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(18, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(19, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        const additionalPiece5 = makePiece(5, [
            makeEdge(20, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(21, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(22, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(23, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ]);

        // Two overlapping dropped groups (each with 2 pieces) that both cover the same small group
        const droppedGroup1: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [4, { x: 0, y: 150 }],
            ]),
            position: { x: 0, y: 0 }
        }; // Covers 0-150 x 0-300

        const droppedGroup2: PieceGroup = {
            id: 1,
            pieces: new Map([
                [1, { x: 0, y: 0 }],
                [5, { x: 0, y: 150 }],
            ]),
            position: { x: 50, y: 50 }
        }; // Covers 50-200 x 50-350

        // Small group in the overlapping area (covers 75-125 x 75-125, inside both dropped groups)
        const smallGroup = makeGroup(2, 2, { x: 75, y: 75 });

        const state = makeGameState(
            [largePiece0, largePiece1, smallPiece2, additionalPiece4, additionalPiece5],
            [droppedGroup1, droppedGroup2, smallGroup],
        );

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([0, 1], state, mockBringToFront);

        // Small group should be raised only once, despite being covered by both dropped groups
        expect(raisedGroups).toEqual([2]);
    });

    it('handles empty dropped groups list', () => {
        const piece0 = makeSquarePiece(0);
        const group0 = makeGroup(0, 0, { x: 50, y: 50 });
        const state = makeGameState([piece0], [group0]);

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([], state, mockBringToFront);

        expect(raisedGroups).toHaveLength(0);
    });

    it('handles non-existent dropped group IDs gracefully', () => {
        const piece0 = makeSquarePiece(0);
        const group0 = makeGroup(0, 0, { x: 50, y: 50 });
        const state = makeGameState([piece0], [group0]);

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([999], state, mockBringToFront); // Non-existent group ID

        expect(raisedGroups).toHaveLength(0);
    });
});
