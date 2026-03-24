/**
 * Tests for the gather pieces logic.
 */

import { describe, it, expect } from 'vitest';
import type { Piece, PieceGroup } from '../model/types.js';
import {
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupOffsetBounds,

} from './gather.js';
import type { WorldRect } from './gather.js';

/**
 * Helper to create a mock piece with edges defining a rectangular bounding box.
 * The piece spans from (0,0) to (width, height) in piece-local space.
 */
function makePiece(id: number, width: number, height: number): Piece {
    return {
        id,
        edges: [
            {
                id: id * 100,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L ${width} 0`,
                start: { x: 0, y: 0 },
                end: { x: width, y: 0 },
            },
            {
                id: id * 100 + 1,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L ${width} ${height}`,
                start: { x: width, y: 0 },
                end: { x: width, y: height },
            },
            {
                id: id * 100 + 2,
                mateEdgeId: -1,
                matePieceId: -1,
                path: `L 0 ${height}`,
                start: { x: width, y: height },
                end: { x: 0, y: height },
            },
            {
                id: id * 100 + 3,
                mateEdgeId: -1,
                matePieceId: -1,
                path: 'L 0 0',
                start: { x: 0, y: height },
                end: { x: 0, y: 0 },
            },
        ],
        shape: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
        imageOffset: { x: 0, y: 0 },
    };
}

/** Helper to create a simple single-piece group at a given position. */
function makeGroup(id: number, x: number, y: number): PieceGroup {
    return {
        id,
        pieces: new Map([[id, { x: 0, y: 0 }]]),
        position: { x, y },
    };
}

/** Helper to create a multi-piece group. */
function makeMultiGroup(
    id: number,
    position: { x: number; y: number },
    pieceOffsets: Array<[number, { x: number; y: number }]>,
): PieceGroup {
    return {
        id,
        pieces: new Map(pieceOffsets),
        position,
    };
}

const defaultVisibleArea: WorldRect = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
};

const pieceSize = 100;

describe('getGroupOffsetBounds', () => {
    it('should return zero bounds for a single piece at origin', () => {
        const group = makeGroup(1, 0, 0);
        const bounds = getGroupOffsetBounds(group);
        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });

    it('should compute correct bounds for multi-piece group', () => {
        const group = makeMultiGroup(1, { x: 0, y: 0 }, [
            [0, { x: -50, y: -50 }],
            [1, { x: 50, y: 0 }],
            [2, { x: 50, y: 50 }],
        ]);

        const bounds = getGroupOffsetBounds(group);
        expect(bounds).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    });
});

describe('computeGatheredPositions', () => {
    it('should return an empty map for no groups', () => {
        const result = computeGatheredPositions([], defaultVisibleArea, []);
        expect(result.size).toBe(0);
    });

    it('should centre a single group in the visible area', () => {
        const pieces = [makePiece(1, pieceSize, pieceSize)];
        const groups = [makeGroup(1, 1000, 2000)];
        const result = computeGatheredPositions(groups, defaultVisibleArea, pieces);

        expect(result.size).toBe(1);
        const pos = result.get(1)!;
        // Should be roughly centred in 800×600
        expect(pos.x).toBeGreaterThan(300);
        expect(pos.x).toBeLessThan(400);
        expect(pos.y).toBeGreaterThan(200);
        expect(pos.y).toBeLessThan(300);
    });

    it('should produce positions for all groups', () => {
        const pieces = [
            makePiece(1, pieceSize, pieceSize),
            makePiece(2, pieceSize, pieceSize),
            makePiece(3, pieceSize, pieceSize),
        ];
        const groups = [makeGroup(1, 0, 0), makeGroup(2, 500, 500), makeGroup(3, -200, 100)];
        const result = computeGatheredPositions(groups, defaultVisibleArea, pieces);

        expect(result.size).toBe(3);
        expect(result.has(1)).toBe(true);
        expect(result.has(2)).toBe(true);
        expect(result.has(3)).toBe(true);
    });

    it('should not stack pieces on top of each other', () => {
        const pieces = Array.from({ length: 6 }, (_, i) =>
            makePiece(i, pieceSize, pieceSize),
        );
        const groups = pieces.map((p, i) => makeGroup(p.id, i * 10, i * 10));

        const result = computeGatheredPositions(groups, defaultVisibleArea, pieces);

        // Collect all positions
        const positions = Array.from(result.values());

        // No two groups should be at the same position
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                const dx = Math.abs(positions[i].x - positions[j].x);
                const dy = Math.abs(positions[i].y - positions[j].y);
                // They should differ by at least pieceSize (no stacking)
                expect(dx > 10 || dy > 10).toBe(true);
            }
        }
    });

    it('should handle groups with varying sizes', () => {
        const pieces = [
            makePiece(0, pieceSize, pieceSize),
            makePiece(1, pieceSize, pieceSize),
            makePiece(2, pieceSize, pieceSize),
        ];
        // A multi-piece group (pieces 0 and 1 side by side)
        const bigGroup = makeMultiGroup(10, { x: 0, y: 0 }, [
            [0, { x: 0, y: 0 }],
            [1, { x: pieceSize, y: 0 }],
        ]);
        const smallGroup = makeGroup(2, 500, 500);

        const result = computeGatheredPositions(
            [bigGroup, smallGroup],
            defaultVisibleArea,
            pieces,
        );

        expect(result.size).toBe(2);
        expect(result.has(10)).toBe(true);
        expect(result.has(2)).toBe(true);
    });
});

describe('applyGatheredPositions', () => {
    it('should update group positions from the map', () => {
        const groups = [makeGroup(1, 100, 200), makeGroup(2, 300, 400)];

        const positions = new Map<number, { x: number; y: number }>([
            [1, { x: 10, y: 20 }],
            [2, { x: 30, y: 40 }],
        ]);

        applyGatheredPositions(groups, positions);

        expect(groups[0].position).toEqual({ x: 10, y: 20 });
        expect(groups[1].position).toEqual({ x: 30, y: 40 });
    });

    it('should skip groups not in the positions map', () => {
        const groups = [makeGroup(1, 100, 200), makeGroup(2, 300, 400)];
        const positions = new Map([[1, { x: 50, y: 60 }]]);

        applyGatheredPositions(groups, positions);

        expect(groups[0].position).toEqual({ x: 50, y: 60 });
        expect(groups[1].position).toEqual({ x: 300, y: 400 });
    });
});
