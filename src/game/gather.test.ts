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

/**
 * Helper to create a mock piece with edges defining a rectangular bounding box.
 */
function makePiece(id: number, width: number, height: number): Piece {
    return {
        id,
        edges: [
            { id: id * 100, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 0, y: 0 }, end: { x: width, y: 0 } },
            { id: id * 100 + 1, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: width, y: 0 }, end: { x: width, y: height } },
            { id: id * 100 + 2, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: width, y: height }, end: { x: 0, y: height } },
            { id: id * 100 + 3, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 0, y: height }, end: { x: 0, y: 0 } },
        ],
        shape: '',
        imageOffset: { x: 0, y: 0 },
    };
}

function makeGroup(id: number, x: number, y: number): PieceGroup {
    return { id, pieces: new Map([[id, { x: 0, y: 0 }]]), position: { x, y } };
}

function makeMultiGroup(
    id: number,
    position: { x: number; y: number },
    pieceOffsets: Array<[number, { x: number; y: number }]>,
): PieceGroup {
    return { id, pieces: new Map(pieceOffsets), position };
}

const landscapeAspect = 800 / 600; // 1.33

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

describe('computeGatheredPositions', () => {
    it('should return empty result for no groups', () => {
        const { positions } = computeGatheredPositions([], landscapeAspect, []);
        expect(positions.size).toBe(0);
    });

    it('should return a position for a single group', () => {
        const pieces = [makePiece(1, 100, 100)];
        const groups = [makeGroup(1, 1000, 2000)];
        const { positions } = computeGatheredPositions(groups, landscapeAspect, pieces);

        expect(positions.size).toBe(1);
        expect(positions.has(1)).toBe(true);
    });

    it('should produce positions for all groups', () => {
        const pieces = [makePiece(1, 100, 100), makePiece(2, 100, 100), makePiece(3, 100, 100)];
        const groups = [makeGroup(1, 0, 0), makeGroup(2, 500, 500), makeGroup(3, -200, 100)];
        const { positions } = computeGatheredPositions(groups, landscapeAspect, pieces);

        expect(positions.size).toBe(3);
        expect(positions.has(1)).toBe(true);
        expect(positions.has(2)).toBe(true);
        expect(positions.has(3)).toBe(true);
    });

    it('should not stack pieces on top of each other', () => {
        const pieces = Array.from({ length: 6 }, (_, i) => makePiece(i, 100, 100));
        const groups = pieces.map(p => makeGroup(p.id, p.id * 10, p.id * 10));
        const { positions } = computeGatheredPositions(groups, landscapeAspect, pieces);

        const posArray = Array.from(positions.values());
        for (let i = 0; i < posArray.length; i++) {
            for (let j = i + 1; j < posArray.length; j++) {
                const dx = Math.abs(posArray[i].x - posArray[j].x);
                const dy = Math.abs(posArray[i].y - posArray[j].y);
                expect(dx > 10 || dy > 10).toBe(true);
            }
        }
    });

    it('should return layout bounds that contain all positions', () => {
        const pieces = Array.from({ length: 4 }, (_, i) => makePiece(i, 100, 100));
        const groups = pieces.map(p => makeGroup(p.id, 0, 0));
        const { positions, layoutBounds } = computeGatheredPositions(groups, landscapeAspect, pieces);

        for (const pos of positions.values()) {
            expect(pos.x).toBeGreaterThanOrEqual(layoutBounds.x);
            expect(pos.y).toBeGreaterThanOrEqual(layoutBounds.y);
        }

        expect(layoutBounds.width).toBeGreaterThan(0);
        expect(layoutBounds.height).toBeGreaterThan(0);
    });

    it('should handle groups with varying sizes', () => {
        const pieces = [makePiece(0, 100, 100), makePiece(1, 100, 100), makePiece(2, 100, 100)];
        const bigGroup = makeMultiGroup(10, { x: 0, y: 0 }, [
            [0, { x: 0, y: 0 }],
            [1, { x: 100, y: 0 }],
        ]);
        const smallGroup = makeGroup(2, 500, 500);
        const { positions } = computeGatheredPositions([bigGroup, smallGroup], landscapeAspect, pieces);

        expect(positions.size).toBe(2);
    });
});

describe('applyGatheredPositions', () => {
    it('should update group positions from the map', () => {
        const groups = [makeGroup(1, 100, 200), makeGroup(2, 300, 400)];
        const positions = new Map([
            [1, { x: 10, y: 20 }],
            [2, { x: 30, y: 40 }],
        ]);
        applyGatheredPositions(groups, positions);
        expect(groups[0].position).toEqual({ x: 10, y: 20 });
        expect(groups[1].position).toEqual({ x: 30, y: 40 });
    });

    it('should skip groups not in the positions map', () => {
        const groups = [makeGroup(1, 100, 200), makeGroup(2, 300, 400)];
        applyGatheredPositions(groups, new Map([[1, { x: 50, y: 60 }]]));
        expect(groups[0].position).toEqual({ x: 50, y: 60 });
        expect(groups[1].position).toEqual({ x: 300, y: 400 });
    });
});
