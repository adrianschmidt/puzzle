/**
 * Tests for group bounds primitives.
 */

import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    getGroupBounds,
    getGroupOffsetBounds,
    getGroupLocalBounds,
    getGroupVisualBounds,
} from './group-bounds.js';
import { buildPiecesById, makePiece, makeRectPiece } from '../test-helpers/fixtures.js';

function makeGroup(id: number, x: number, y: number): PieceGroup {
    return { id, pieces: new Map([[id, { x: 0, y: 0 }]]), position: { x, y }, rotation: 0 };
}

function makeMultiGroup(
    id: number,
    position: { x: number; y: number },
    pieceOffsets: Array<[number, { x: number; y: number }]>,
): PieceGroup {
    return { id, pieces: new Map(pieceOffsets), position, rotation: 0 };
}

function makeEdge(
    id: number,
    start: Point,
    end: Point,
    path: string = '',
): Edge {
    return { id, mateEdgeId: -1, matePieceId: -1, path, start, end };
}

/**
 * 100×100 piece with straight edges and empty path strings.
 * Path geometry equals corner endpoints, so includePathGeometry has no effect.
 */
function makeSquarePiece(id: number): Piece {
    const base = id * 4;
    return makePiece({ id, edges: [
        makeEdge(base,     { x: 0,   y: 0   }, { x: 100, y: 0   }),
        makeEdge(base + 1, { x: 100, y: 0   }, { x: 100, y: 100 }),
        makeEdge(base + 2, { x: 100, y: 100 }, { x: 0,   y: 100 }),
        makeEdge(base + 3, { x: 0,   y: 100 }, { x: 0,   y: 0   }),
    ] });
}

/**
 * 100×100 piece whose top edge bulges UP by 30 units via a cubic bezier.
 * The control points sit at y = -30, well outside the start/end endpoints
 * — so includePathGeometry shifts minY from 0 down to -30.
 */
function makeTabbedPiece(id: number): Piece {
    const base = id * 4;
    return makePiece({ id, edges: [
        // Top edge: cubic with control points above the start/end line.
        makeEdge(
            base,
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            'M0,0 C30,-30 70,-30 100,0',
        ),
        makeEdge(base + 1, { x: 100, y: 0 },   { x: 100, y: 100 }),
        makeEdge(base + 2, { x: 100, y: 100 }, { x: 0,   y: 100 }),
        makeEdge(base + 3, { x: 0,   y: 100 }, { x: 0,   y: 0   }),
    ] });
}

describe('getGroupBounds (unified primitive)', () => {
    describe('local space', () => {
        it('walks edge endpoints in piece-offset frame', () => {
            const piece = makeSquarePiece(0);
            const group = makeGroup(0, 200, 300); // position is ignored
            const bounds = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'local',
                includePathGeometry: false,
            });
            expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
        });

        it('ignores group rotation', () => {
            const piece = makeSquarePiece(0);
            const group = makeGroup(0, 0, 0);
            group.rotation = 90; // 90° CW
            const bounds = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'local',
                includePathGeometry: false,
            });
            expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
        });

        it('expands to include bezier control points when requested', () => {
            const piece = makeTabbedPiece(0);
            const group = makeGroup(0, 0, 0);

            const noPaths = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'local',
                includePathGeometry: false,
            });
            expect(noPaths).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });

            const withPaths = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'local',
                includePathGeometry: true,
            });
            expect(withPaths.minY).toBe(-30);
            expect(withPaths.minX).toBe(0);
            expect(withPaths.maxX).toBe(100);
            expect(withPaths.maxY).toBe(100);
        });

        it('walks all pieces in a multi-piece group', () => {
            const piece0 = makeSquarePiece(0);
            const piece1 = makeSquarePiece(1);
            const group = makeMultiGroup(0, { x: 999, y: 999 }, [
                [0, { x: 0,   y: 0 }],
                [1, { x: 100, y: 0 }],
            ]);

            const bounds = getGroupBounds(group, buildPiecesById([piece0, piece1]), {
                space: 'local',
                includePathGeometry: false,
            });
            expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
        });
    });

    describe('world space', () => {
        it('translates by group.position when rotation is 0', () => {
            const piece = makeSquarePiece(0);
            const group = makeGroup(0, 50, 75);

            const bounds = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'world',
                includePathGeometry: false,
            });
            expect(bounds).toEqual({ minX: 50, minY: 75, maxX: 150, maxY: 175 });
        });

        it('handles negative group positions', () => {
            const piece = makeSquarePiece(0);
            const group = makeGroup(0, -50, -30);

            const bounds = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'world',
                includePathGeometry: false,
            });
            expect(bounds).toEqual({ minX: -50, minY: -30, maxX: 50, maxY: 70 });
        });

        it('handles non-zero piece offsets within the group', () => {
            const piece = makeSquarePiece(0);
            const group: PieceGroup = {
                id: 0,
                pieces: new Map([[0, { x: 50, y: 25 }]]),
                position: { x: 100, y: 100 },
                rotation: 0,
            };

            const bounds = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'world',
                includePathGeometry: false,
            });
            expect(bounds).toEqual({ minX: 150, minY: 125, maxX: 250, maxY: 225 });
        });

        it('accounts for group rotation', () => {
            // 100×100 piece, group rotated 90° CW at world (100,100).
            // Local corners (0,0)..(100,100) rotate to (-100,0)..(0,100),
            // then translate to world (0..100) × (100..200).
            const piece = makeSquarePiece(0);
            const group: PieceGroup = {
                id: 0,
                pieces: new Map([[0, { x: 0, y: 0 }]]),
                position: { x: 100, y: 100 },
                rotation: 90,
            };

            const bounds = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'world',
                includePathGeometry: false,
            });
            expect(bounds.minX).toBeCloseTo(0);
            expect(bounds.minY).toBeCloseTo(100);
            expect(bounds.maxX).toBeCloseTo(100);
            expect(bounds.maxY).toBeCloseTo(200);
        });

        it('combines rotation and path geometry', () => {
            // Tabbed piece rotated 90° CW. The tab originally bulges up
            // (toward y=-30); after 90° CW (x,y)→(-y,x), tab control points
            // land at x=30. The rotated square corners span x=[-100..0].
            const piece = makeTabbedPiece(0);
            const group: PieceGroup = {
                id: 0,
                pieces: new Map([[0, { x: 0, y: 0 }]]),
                position: { x: 0, y: 0 },
                rotation: 90,
            };

            const noPaths = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'world',
                includePathGeometry: false,
            });
            // Without path geometry, just the rotated square: x=[-100..0].
            expect(noPaths.minX).toBeCloseTo(-100);
            expect(noPaths.minY).toBeCloseTo(0);
            expect(noPaths.maxX).toBeCloseTo(0);
            expect(noPaths.maxY).toBeCloseTo(100);

            const withPaths = getGroupBounds(group, buildPiecesById([piece]), {
                space: 'world',
                includePathGeometry: true,
            });
            // Tab control points at x=30 push maxX out beyond the square.
            expect(withPaths.maxX).toBeCloseTo(30);
            expect(withPaths.minX).toBeCloseTo(-100);
        });
    });
});

describe('getGroupOffsetBounds', () => {
    it('should return zero bounds for a single piece at origin', () => {
        const group = makeGroup(1, 0, 0);
        expect(getGroupOffsetBounds(group)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });

    it('should compute correct bounds for multi-piece group', () => {
        const group = makeMultiGroup(1, { x: 0, y: 0 }, [
            [0, { x: -50, y: -50 }],
            [1, { x: 50, y: 0 }],
            [2, { x: 50, y: 50 }],
        ]);
        expect(getGroupOffsetBounds(group)).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    });
});

describe('getGroupLocalBounds', () => {
    it('ignores rotation and returns un-rotated bounds', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 90; // CW 90°

        expect(getGroupLocalBounds(group, buildPiecesById([piece]))).toEqual({
            minX: 0,
            minY: 0,
            width: 100,
            height: 40,
        });
    });
});

describe('getGroupVisualBounds', () => {
    it('matches local bounds at rotation 0', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);

        expect(getGroupVisualBounds(group, buildPiecesById([piece]))).toEqual(
            getGroupLocalBounds(group, buildPiecesById([piece])),
        );
    });

    it('swaps width and height at rotation 1 (90° CW)', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 90;

        const bounds = getGroupVisualBounds(group, buildPiecesById([piece]));

        expect(bounds.width).toBeCloseTo(40);
        expect(bounds.height).toBeCloseTo(100);
    });

    it('swaps width and height at rotation 3 (270° CW)', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 270;

        const bounds = getGroupVisualBounds(group, buildPiecesById([piece]));

        expect(bounds.width).toBeCloseTo(40);
        expect(bounds.height).toBeCloseTo(100);
    });

    it('keeps width and height at rotation 2 (180°)', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 180;

        const bounds = getGroupVisualBounds(group, buildPiecesById([piece]));

        expect(bounds.width).toBeCloseTo(100);
        expect(bounds.height).toBeCloseTo(40);
    });
});
