import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    mergeGroups,
    selectBestCandidate,
    processDrop,
} from './group-merging.js';
import type { MergeCandidate } from './merge-detection.js';
import { getWorldPosition } from '../model/helpers.js';
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
 * Create two pieces that share a vertical edge.
 *
 * Piece 0 (100×100): right edge from (100,0) to (100,100)
 * Piece 1 (100×100): left edge from (0,100) to (0,0)
 * Edges are mates of each other.
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
        makeEdge(10, { x: 0, y: 0 }, { x: 100, y: 0 }),     // top (border)
        rightEdge,                                             // right
        makeEdge(11, { x: 100, y: 100 }, { x: 0, y: 100 }), // bottom (border)
        makeEdge(12, { x: 0, y: 100 }, { x: 0, y: 0 }),     // left (border)
    ] });

    const piece1 = makePiece({ id: 1, edges: [
        makeEdge(13, { x: 0, y: 0 }, { x: 100, y: 0 }),     // top (border)
        makeEdge(14, { x: 100, y: 0 }, { x: 100, y: 100 }), // right (border)
        makeEdge(15, { x: 100, y: 100 }, { x: 0, y: 100 }), // bottom (border)
        leftEdge,                                              // left
    ] });

    return { piece0, piece1, rightEdge, leftEdge };
}

/**
 * Create three pieces in a row (left-center-right), each 100×100.
 *
 * Piece 0: right edge mates with piece 1's left
 * Piece 1: left mates with piece 0, right mates with piece 2
 * Piece 2: left mates with piece 1
 */
function createThreePieceRow(): {
    pieces: Piece[];
    edges: {
        p0Right: Edge;
        p1Left: Edge;
        p1Right: Edge;
        p2Left: Edge;
    };
} {
    // Piece 0 right ↔ Piece 1 left
    const p0Right = makeEdge(0, { x: 100, y: 0 }, { x: 100, y: 100 }, 1, 1);
    const p1Left = makeEdge(1, { x: 0, y: 100 }, { x: 0, y: 0 }, 0, 0);

    // Piece 1 right ↔ Piece 2 left
    const p1Right = makeEdge(2, { x: 100, y: 0 }, { x: 100, y: 100 }, 2, 3);
    const p2Left = makeEdge(3, { x: 0, y: 100 }, { x: 0, y: 0 }, 1, 2);

    const piece0 = makePiece({ id: 0, edges: [
        makeEdge(20, { x: 0, y: 0 }, { x: 100, y: 0 }),
        p0Right,
        makeEdge(21, { x: 100, y: 100 }, { x: 0, y: 100 }),
        makeEdge(22, { x: 0, y: 100 }, { x: 0, y: 0 }),
    ] });

    const piece1 = makePiece({ id: 1, edges: [
        makeEdge(23, { x: 0, y: 0 }, { x: 100, y: 0 }),
        p1Right,
        makeEdge(24, { x: 100, y: 100 }, { x: 0, y: 100 }),
        p1Left,
    ] });

    const piece2 = makePiece({ id: 2, edges: [
        makeEdge(25, { x: 0, y: 0 }, { x: 100, y: 0 }),
        makeEdge(26, { x: 100, y: 0 }, { x: 100, y: 100 }),
        makeEdge(27, { x: 100, y: 100 }, { x: 0, y: 100 }),
        p2Left,
    ] });

    return {
        pieces: [piece0, piece1, piece2],
        edges: { p0Right, p1Left, p1Right, p2Left },
    };
}

// --- Tests ---

describe('mergeGroups', () => {
    it('transfers pieces from moved group to target group', () => {
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 100, y: 0 },
            rotation: 0,
        };
        const targetGroup: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 200, y: 0 },
            rotation: 0,
        };

        const result = mergeGroups(movedGroup, targetGroup, { x: 0, y: 0 });

        expect(result.pieces.has(0)).toBe(true);
        expect(result.pieces.has(1)).toBe(true);
        expect(result.pieces.size).toBe(2);
    });

    it('preserves world positions after merge (no snap)', () => {
        // Moved group at (100, 50) with piece at offset (0,0)
        // → piece world pos = (100, 50)
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 100, y: 50 },
            rotation: 0,
        };
        // Target group at (300, 50) with piece at offset (0,0)
        const targetGroup: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 300, y: 50 },
            rotation: 0,
        };

        mergeGroups(movedGroup, targetGroup, { x: 0, y: 0 });

        // After merge, piece 0 should be at offset (-200, 0) in target group
        // so its world pos = 300 + (-200) = 100, 50 + 0 = 50 ✓
        const offset0 = targetGroup.pieces.get(0)!;
        expect(offset0.x).toBeCloseTo(-200);
        expect(offset0.y).toBeCloseTo(0);
    });

    it('applies snap delta before merging', () => {
        // Moved group is 5px too far right
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 105, y: 0 },
            rotation: 0,
        };
        const targetGroup: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 200, y: 0 },
            rotation: 0,
        };

        // Snap delta: move moved group -5px in x to align
        mergeGroups(movedGroup, targetGroup, { x: -5, y: 0 });

        // After snap, moved group is at (100, 0)
        // Piece 0's offset in target: (100 - 200, 0 - 0) = (-100, 0)
        const offset0 = targetGroup.pieces.get(0)!;
        expect(offset0.x).toBeCloseTo(-100);
        expect(offset0.y).toBeCloseTo(0);
    });

    it('handles multi-piece moved group', () => {
        // Moved group has 2 pieces already
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 50, y: 50 },
            rotation: 0,
        };
        const targetGroup: PieceGroup = {
            id: 2,
            pieces: new Map([[2, { x: 0, y: 0 }]]),
            position: { x: 250, y: 50 },
            rotation: 0,
        };

        mergeGroups(movedGroup, targetGroup, { x: 0, y: 0 });

        expect(targetGroup.pieces.size).toBe(3);

        // Piece 0: world = 50+0=50 → offset in target = 50-250 = -200
        expect(targetGroup.pieces.get(0)!.x).toBeCloseTo(-200);
        expect(targetGroup.pieces.get(0)!.y).toBeCloseTo(0);

        // Piece 1: world = 50+100=150 → offset in target = 150-250 = -100
        expect(targetGroup.pieces.get(1)!.x).toBeCloseTo(-100);
        expect(targetGroup.pieces.get(1)!.y).toBeCloseTo(0);

        // Piece 2: unchanged at (0,0)
        expect(targetGroup.pieces.get(2)!.x).toBeCloseTo(0);
        expect(targetGroup.pieces.get(2)!.y).toBeCloseTo(0);
    });

    it('returns the target group', () => {
        const movedGroup = makeGroup(0, 0, { x: 0, y: 0 });
        const targetGroup = makeGroup(1, 1, { x: 100, y: 0 });

        const result = mergeGroups(movedGroup, targetGroup, { x: 0, y: 0 });

        expect(result).toBe(targetGroup);
    });

    it('handles snap with both x and y correction', () => {
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 108, y: -5 },
            rotation: 0,
        };
        const targetGroup: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 200, y: 0 },
            rotation: 0,
        };

        // Snap delta corrects to (100, 0) → dx=-8, dy=5
        mergeGroups(movedGroup, targetGroup, { x: -8, y: 5 });

        // After snap moved is at (100, 0), offset = 100-200 = -100
        const offset0 = targetGroup.pieces.get(0)!;
        expect(offset0.x).toBeCloseTo(-100);
        expect(offset0.y).toBeCloseTo(0);
    });

    it.each([0, 1, 2, 3] as const)(
        'preserves each piece’s world position at rotation=%i',
        (rotation) => {
            // Moved: two pieces whose world positions we want to pin after merge.
            // Piece 0 at offset (0,0), piece 1 at offset (100,0).
            const movedGroup: PieceGroup = {
                id: 0,
                pieces: new Map([
                    [0, { x: 0, y: 0 }],
                    [1, { x: 100, y: 0 }],
                ]),
                position: { x: 50, y: 20 },
                rotation,
            };
            const targetGroup: PieceGroup = {
                id: 2,
                pieces: new Map([[2, { x: 0, y: 0 }]]),
                position: { x: 300, y: 80 },
                rotation,
            };

            // Capture world positions before merge
            const worldBefore = new Map<number, { x: number; y: number }>();
            for (const id of [0, 1]) {
                worldBefore.set(id, getWorldPosition({ x: 0, y: 0 }, id, movedGroup));
            }
            worldBefore.set(2, getWorldPosition({ x: 0, y: 0 }, 2, targetGroup));

            mergeGroups(movedGroup, targetGroup, { x: 0, y: 0 });

            for (const [id, expected] of worldBefore) {
                const after = getWorldPosition({ x: 0, y: 0 }, id, targetGroup);
                expect(after.x).toBeCloseTo(expected.x);
                expect(after.y).toBeCloseTo(expected.y);
            }
        },
    );
});

describe('selectBestCandidate', () => {
    function makeCandidate(snapDelta: Point): MergeCandidate {
        return {
            movedGroup: makeGroup(0, 0, { x: 0, y: 0 }),
            targetGroup: makeGroup(1, 1, { x: 0, y: 0 }),
            movedPiece: makePiece({ id: 0, edges: [] }),
            movedEdge: makeEdge(0, { x: 0, y: 0 }, { x: 0, y: 0 }),
            targetPiece: makePiece({ id: 1, edges: [] }),
            targetEdge: makeEdge(1, { x: 0, y: 0 }, { x: 0, y: 0 }),
            snapDelta,
        };
    }

    it('picks the candidate with smallest snap delta', () => {
        const candidates = [
            makeCandidate({ x: 10, y: 5 }),  // manhattan dist = 15
            makeCandidate({ x: 1, y: 2 }),   // manhattan dist = 3 ← best
            makeCandidate({ x: -8, y: 3 }),  // manhattan dist = 11
        ];

        const best = selectBestCandidate(candidates);
        expect(best.snapDelta).toEqual({ x: 1, y: 2 });
    });

    it('returns the only candidate when there is one', () => {
        const candidates = [makeCandidate({ x: 5, y: 5 })];
        const best = selectBestCandidate(candidates);
        expect(best.snapDelta).toEqual({ x: 5, y: 5 });
    });

    it('handles negative deltas correctly', () => {
        const candidates = [
            makeCandidate({ x: -2, y: -3 }), // manhattan dist = 5
            makeCandidate({ x: 4, y: 4 }),   // manhattan dist = 8
        ];

        const best = selectBestCandidate(candidates);
        expect(best.snapDelta).toEqual({ x: -2, y: -3 });
    });

    it('throws when given empty candidates', () => {
        expect(() => selectBestCandidate([])).toThrow('No candidates');
    });

    it('picks the first when deltas are equal', () => {
        const c1 = makeCandidate({ x: 3, y: 0 });
        const c2 = makeCandidate({ x: 0, y: 3 });

        const best = selectBestCandidate([c1, c2]);
        expect(best).toBe(c1);
    });
});

describe('processDrop', () => {
    it('merges two perfectly aligned adjacent pieces', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        // Piece 0 at (0,0), piece 1 at (100,0) — perfectly adjacent
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });

        const result = processDrop(0, state);

        expect(result).not.toBeNull();
        expect(result!.mergeCount).toBe(1);
        // Only one group should remain
        expect(state.groups).toHaveLength(1);
        // The surviving group should have both pieces
        expect(state.groups[0].pieces.size).toBe(2);
    });

    it('removes the moved group after merge', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });

        processDrop(0, state);

        // Group 0 (the moved group) should be gone, group 1 (target) survives
        expect(state.groups.find((g) => g.id === 0)).toBeUndefined();
        expect(state.groups.find((g) => g.id === 1)).toBeDefined();
    });

    it('returns null when no merges are possible', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 500, y: 500 }); // too far
        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });

        const result = processDrop(0, state);
        expect(result).toBeNull();
        expect(state.groups).toHaveLength(2);
    });

    it('returns null for invalid group id', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();
        const state = makeGameState({ pieces: [piece0, piece1], groups: [makeGroup(0, 0, { x: 0, y: 0 }), makeGroup(1, 1, { x: 100, y: 0 })] });

        const result = processDrop(999, state);
        expect(result).toBeNull();
    });

    it('snaps pieces into perfect alignment on merge', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        // Piece 1 is slightly off (5px right, 3px down) — within tolerance
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 105, y: 3 });
        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });

        processDrop(0, state);

        // After merge, piece 0 should be at exact correct offset relative to piece 1
        const survivingGroup = state.groups[0];
        const offset0 = survivingGroup.pieces.get(0)!;
        const offset1 = survivingGroup.pieces.get(1)!;

        // Pieces are 100px apart horizontally in piece-local coords
        // (piece 0's right edge is at x=100, piece 1's left edge at x=0)
        expect(offset0.x - offset1.x).toBeCloseTo(-100);
        expect(offset0.y - offset1.y).toBeCloseTo(0);
    });

    it('handles cascading merges (three pieces in a row)', () => {
        const { pieces } = createThreePieceRow();

        // Position all three perfectly: [0 at 0] [1 at 100] [2 at 200]
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        const group2 = makeGroup(2, 2, { x: 200, y: 0 });
        const state = makeGameState({ pieces, groups: [group0, group1, group2] });

        // Drop group 1 (center) — should merge with both neighbors via cascade
        const result = processDrop(1, state);

        expect(result).not.toBeNull();
        expect(result!.mergeCount).toBe(2); // Two merges: first + cascade
        expect(state.groups).toHaveLength(1);
        expect(state.groups[0].pieces.size).toBe(3);
    });

    it('preserves piece world positions through cascading merges', () => {
        const { pieces } = createThreePieceRow();

        // Position all three perfectly
        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        const group2 = makeGroup(2, 2, { x: 200, y: 0 });
        const state = makeGameState({ pieces, groups: [group0, group1, group2] });

        processDrop(1, state);

        const final = state.groups[0];

        // Check that each piece's world position is correct
        for (const [pieceId, offset] of final.pieces) {
            const worldX = final.position.x + offset.x;
            const worldY = final.position.y + offset.y;

            // Each piece should be at (pieceId * 100, 0)
            expect(worldX).toBeCloseTo(pieceId * 100);
            expect(worldY).toBeCloseTo(0);
        }
    });

    it('does not merge pieces that are already in the same group', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        // Both pieces already in the same group
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

        const result = processDrop(0, state);
        expect(result).toBeNull();
        expect(state.groups).toHaveLength(1);
    });

    it('correctly handles merge when moved group has multiple pieces', () => {
        const { pieces } = createThreePieceRow();

        // Group A has pieces 0,1 already merged. Group B has piece 2 alone.
        const groupA: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };
        const groupB = makeGroup(2, 2, { x: 200, y: 0 });

        const state = makeGameState({ pieces, groups: [groupA, groupB] });

        // Drop group A — piece 1 (in group A) is adjacent to piece 2 (group B)
        const result = processDrop(0, state);

        expect(result).not.toBeNull();
        expect(result!.mergeCount).toBe(1);
        expect(state.groups).toHaveLength(1);
        expect(state.groups[0].pieces.size).toBe(3);
    });

    it('returns the surviving group after merge', () => {
        const { piece0, piece1 } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 });
        const group1 = makeGroup(1, 1, { x: 100, y: 0 });
        const state = makeGameState({ pieces: [piece0, piece1], groups: [group0, group1] });

        const result = processDrop(0, state);

        expect(result).not.toBeNull();
        expect(result!.group.pieces.size).toBe(2);
        expect(state.groups).toContain(result!.group);
    });
});
