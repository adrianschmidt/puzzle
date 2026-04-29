import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    rectFullyContains,
    reorderGroupsAfterDrop,
} from './z-order.js';
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
 */
function makeSquarePiece(id: number): Piece {
    const edgeBase = id * 4;

    return makePiece({ id, edges: [
        makeEdge(edgeBase,     { x: 0, y: 0 },     { x: 100, y: 0 }),
        makeEdge(edgeBase + 1, { x: 100, y: 0 },   { x: 100, y: 100 }),
        makeEdge(edgeBase + 2, { x: 100, y: 100 }, { x: 0, y: 100 }),
        makeEdge(edgeBase + 3, { x: 0, y: 100 },   { x: 0, y: 0 }),
    ] });
}

// --- Tests ---

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
        const largePiece = makePiece({ id: 0, edges: [
            makeEdge(0, { x: 0, y: 0 }, { x: 200, y: 0 }),     // top
            makeEdge(1, { x: 200, y: 0 }, { x: 200, y: 200 }), // right
            makeEdge(2, { x: 200, y: 200 }, { x: 0, y: 200 }), // bottom
            makeEdge(3, { x: 0, y: 200 }, { x: 0, y: 0 }),     // left
        ] });

        const smallPiece1 = makePiece({ id: 1, edges: [
            makeEdge(4, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(5, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(6, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(7, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ] });

        const smallPiece2 = makePiece({ id: 2, edges: [
            makeEdge(8, { x: 0, y: 0 }, { x: 40, y: 0 }),
            makeEdge(9, { x: 40, y: 0 }, { x: 40, y: 40 }),
            makeEdge(10, { x: 40, y: 40 }, { x: 0, y: 40 }),
            makeEdge(11, { x: 0, y: 40 }, { x: 0, y: 0 }),
        ] });

        // Create an additional piece to make the large group actually have more pieces
        const additionalPiece = makePiece({ id: 3, edges: [
            makeEdge(12, { x: 0, y: 0 }, { x: 200, y: 0 }),
            makeEdge(13, { x: 200, y: 0 }, { x: 200, y: 200 }),
            makeEdge(14, { x: 200, y: 200 }, { x: 0, y: 200 }),
            makeEdge(15, { x: 0, y: 200 }, { x: 0, y: 0 }),
        ] });

        // Large dropped group (2 pieces for larger size)
        const largeGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],     // piece 0 covers 0-200 x 0-200
                [3, { x: 200, y: 0 }],   // piece 3 covers 200-400 x 0-200
            ]),
            position: { x: 0, y: 0 },
            rotation: 0,
        }; // Combined covers 0-400 x 0-200

        // Small covered groups positioned inside the large group
        const smallGroup1 = makeGroup(1, 1, { x: 50, y: 50 }); // Covers 50-100 x 50-100 (inside)
        const smallGroup2 = makeGroup(2, 2, { x: 100, y: 100 }); // Covers 100-140 x 100-140 (inside)

        const state = makeGameState({ pieces: [largePiece, smallPiece1, smallPiece2, additionalPiece], groups: [largeGroup, smallGroup1, smallGroup2] });

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

        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });

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
            rotation: 0,
        };

        // Small group that extends beyond the large group's bounds
        const smallGroup = makeGroup(1, 1, { x: 120, y: 120 }); // Covers 120-220 x 120-220, partially outside

        const state = makeGameState({ pieces: [piece0, piece1], groups: [largeGroup, smallGroup] });

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
        const largePiece = makePiece({ id: 0, edges: [
            makeEdge(0, { x: 0, y: 0 }, { x: 300, y: 0 }),
            makeEdge(1, { x: 300, y: 0 }, { x: 300, y: 300 }),
            makeEdge(2, { x: 300, y: 300 }, { x: 0, y: 300 }),
            makeEdge(3, { x: 0, y: 300 }, { x: 0, y: 0 }),
        ] });

        // Create smaller pieces
        const mediumPiece1 = makePiece({ id: 1, edges: [
            makeEdge(4, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(5, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(6, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(7, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ] });

        const mediumPiece2 = makePiece({ id: 2, edges: [
            makeEdge(8, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(9, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(10, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(11, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ] });

        const smallPiece = makePiece({ id: 3, edges: [
            makeEdge(12, { x: 0, y: 0 }, { x: 30, y: 0 }),
            makeEdge(13, { x: 30, y: 0 }, { x: 30, y: 30 }),
            makeEdge(14, { x: 30, y: 30 }, { x: 0, y: 30 }),
            makeEdge(15, { x: 0, y: 30 }, { x: 0, y: 0 }),
        ] });

        // Create additional pieces for the large group
        const additionalPiece1 = makePiece({ id: 4, edges: [
            makeEdge(16, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(17, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(18, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(19, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        const additionalPiece2 = makePiece({ id: 5, edges: [
            makeEdge(20, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(21, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(22, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(23, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        // Large dropped group (3 pieces)
        const largeGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [4, { x: 0, y: 300 }],
                [5, { x: 300, y: 0 }],
            ]),
            position: { x: 0, y: 0 },
            rotation: 0,
        }; // Covers 0-450 x 0-450 (large enough to contain both smaller groups)

        // Medium group (2 pieces)
        const mediumGroup: PieceGroup = {
            id: 1,
            pieces: new Map([
                [1, { x: 0, y: 0 }],
                [2, { x: 0, y: 50 }],
            ]),
            position: { x: 50, y: 50 }, // Covers 50-100 x 50-150
            rotation: 0,
        };

        // Small group (1 piece)
        const smallGroup = makeGroup(3, 3, { x: 100, y: 100 }); // Covers 100-130 x 100-130

        const state = makeGameState({ pieces: [largePiece, mediumPiece1, mediumPiece2, smallPiece, additionalPiece1, additionalPiece2], groups: [largeGroup, mediumGroup, smallGroup] });

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
        const largePiece0 = makePiece({ id: 0, edges: [
            makeEdge(0, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(1, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(2, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(3, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        const largePiece1 = makePiece({ id: 1, edges: [
            makeEdge(4, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(5, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(6, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(7, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        // Small pieces that will be covered
        const smallPiece2 = makePiece({ id: 2, edges: [
            makeEdge(8, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(9, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(10, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(11, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ] });

        const smallPiece3 = makePiece({ id: 3, edges: [
            makeEdge(12, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(13, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(14, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(15, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ] });

        // Create additional pieces for the dropped groups to make them larger
        const additionalPiece4 = makePiece({ id: 4, edges: [
            makeEdge(16, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(17, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(18, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(19, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        const additionalPiece5 = makePiece({ id: 5, edges: [
            makeEdge(20, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(21, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(22, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(23, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        // Two dropped groups (from multi-select drag) - each with 2 pieces
        const droppedGroup1: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [4, { x: 0, y: 150 }],
            ]),
            position: { x: 0, y: 0 },
            rotation: 0,
        }; // Covers 0-150 x 0-300

        const droppedGroup2: PieceGroup = {
            id: 1,
            pieces: new Map([
                [1, { x: 0, y: 0 }],
                [5, { x: 0, y: 150 }],
            ]),
            position: { x: 200, y: 0 },
            rotation: 0,
        }; // Covers 200-350 x 0-300

        // Two smaller groups, each covered by one of the dropped groups
        const smallGroup1 = makeGroup(2, 2, { x: 50, y: 50 }); // Covers 50-100 x 50-100 (inside droppedGroup1)
        const smallGroup2 = makeGroup(3, 3, { x: 250, y: 50 }); // Covers 250-300 x 50-100 (inside droppedGroup2)

        const state = makeGameState({ pieces: [largePiece0, largePiece1, smallPiece2, smallPiece3, additionalPiece4, additionalPiece5], groups: [droppedGroup1, droppedGroup2, smallGroup1, smallGroup2] });

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
        const largePiece0 = makePiece({ id: 0, edges: [
            makeEdge(0, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(1, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(2, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(3, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        const largePiece1 = makePiece({ id: 1, edges: [
            makeEdge(4, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(5, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(6, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(7, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        // Small piece that will be covered by both
        const smallPiece2 = makePiece({ id: 2, edges: [
            makeEdge(8, { x: 0, y: 0 }, { x: 50, y: 0 }),
            makeEdge(9, { x: 50, y: 0 }, { x: 50, y: 50 }),
            makeEdge(10, { x: 50, y: 50 }, { x: 0, y: 50 }),
            makeEdge(11, { x: 0, y: 50 }, { x: 0, y: 0 }),
        ] });

        // Create additional pieces to make the dropped groups larger
        const additionalPiece4 = makePiece({ id: 4, edges: [
            makeEdge(16, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(17, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(18, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(19, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        const additionalPiece5 = makePiece({ id: 5, edges: [
            makeEdge(20, { x: 0, y: 0 }, { x: 150, y: 0 }),
            makeEdge(21, { x: 150, y: 0 }, { x: 150, y: 150 }),
            makeEdge(22, { x: 150, y: 150 }, { x: 0, y: 150 }),
            makeEdge(23, { x: 0, y: 150 }, { x: 0, y: 0 }),
        ] });

        // Two overlapping dropped groups (each with 2 pieces) that both cover the same small group
        const droppedGroup1: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [4, { x: 0, y: 150 }],
            ]),
            position: { x: 0, y: 0 },
            rotation: 0,
        }; // Covers 0-150 x 0-300

        const droppedGroup2: PieceGroup = {
            id: 1,
            pieces: new Map([
                [1, { x: 0, y: 0 }],
                [5, { x: 0, y: 150 }],
            ]),
            position: { x: 50, y: 50 },
            rotation: 0,
        }; // Covers 50-200 x 50-350

        // Small group in the overlapping area (covers 75-125 x 75-125, inside both dropped groups)
        const smallGroup = makeGroup(2, 2, { x: 75, y: 75 });

        const state = makeGameState({ pieces: [largePiece0, largePiece1, smallPiece2, additionalPiece4, additionalPiece5], groups: [droppedGroup1, droppedGroup2, smallGroup] });

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
        const state = makeGameState({ pieces: [piece0], groups: [group0] });

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
        const state = makeGameState({ pieces: [piece0], groups: [group0] });

        const raisedGroups: number[] = [];
        const mockBringToFront = (groupId: number) => {
            raisedGroups.push(groupId);
        };

        reorderGroupsAfterDrop([999], state, mockBringToFront); // Non-existent group ID

        expect(raisedGroups).toHaveLength(0);
    });
});
