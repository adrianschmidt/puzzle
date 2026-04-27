/**
 * Tests for the gather pieces logic.
 */

import { describe, it, expect } from 'vitest';
import type { Piece, PieceGroup } from '../model/types.js';
import {
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupOffsetBounds,
    getGroupLocalBounds,
    getGroupVisualBounds,
    getPathBounds,
} from './gather.js';
import { makeRectPiece } from '../test-helpers/fixtures.js';

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
        const pieces = [makeRectPiece({ id: 1, width: 100, height: 100 })];
        const groups = [makeGroup(1, 1000, 2000)];
        const { positions } = computeGatheredPositions(groups, landscapeAspect, pieces);

        expect(positions.size).toBe(1);
        expect(positions.has(1)).toBe(true);
    });

    it('should produce positions for all groups', () => {
        const pieces = [makeRectPiece({ id: 1, width: 100, height: 100 }), makeRectPiece({ id: 2, width: 100, height: 100 }), makeRectPiece({ id: 3, width: 100, height: 100 })];
        const groups = [makeGroup(1, 0, 0), makeGroup(2, 500, 500), makeGroup(3, -200, 100)];
        const { positions } = computeGatheredPositions(groups, landscapeAspect, pieces);

        expect(positions.size).toBe(3);
        expect(positions.has(1)).toBe(true);
        expect(positions.has(2)).toBe(true);
        expect(positions.has(3)).toBe(true);
    });

    it('should not stack pieces on top of each other', () => {
        const pieces = Array.from({ length: 6 }, (_, i) => makeRectPiece({ id: i, width: 100, height: 100 }));
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
        const pieces = Array.from({ length: 4 }, (_, i) => makeRectPiece({ id: i, width: 100, height: 100 }));
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
        const pieces = [makeRectPiece({ id: 0, width: 100, height: 100 }), makeRectPiece({ id: 1, width: 100, height: 100 }), makeRectPiece({ id: 2, width: 100, height: 100 })];
        const bigGroup = makeMultiGroup(10, { x: 0, y: 0 }, [
            [0, { x: 0, y: 0 }],
            [1, { x: 100, y: 0 }],
        ]);
        const smallGroup = makeGroup(2, 500, 500);
        const { positions } = computeGatheredPositions([bigGroup, smallGroup], landscapeAspect, pieces);

        expect(positions.size).toBe(2);
    });
});

describe('getPathBounds', () => {
    it('should return start point bounds for empty path', () => {
        const bounds = getPathBounds('', { x: 10, y: 20 });
        expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 10, maxY: 20 });
    });

    it('should handle absolute line commands', () => {
        const bounds = getPathBounds('M 0 0 L 100 50 L 50 100', { x: 0, y: 0 });
        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    });

    it('should handle relative line commands', () => {
        const bounds = getPathBounds('l 100 0 l 0 80', { x: 10, y: 10 });
        expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 110, maxY: 90 });
    });

    it('should include cubic bezier control points (absolute)', () => {
        // Control points at (50, -30) and (50, 130) extend beyond endpoints
        const bounds = getPathBounds('C 50 -30, 50 130, 100 50', { x: 0, y: 0 });
        expect(bounds.minY).toBe(-30);
        expect(bounds.maxY).toBe(130);
        expect(bounds.maxX).toBe(100);
    });

    it('should include cubic bezier control points (relative)', () => {
        const bounds = getPathBounds('c 20 -40, 80 -40, 100 0', { x: 0, y: 50 });
        expect(bounds.minY).toBe(10); // 50 + (-40)
        expect(bounds.maxX).toBe(100);
    });

    it('should include quadratic bezier control points', () => {
        const bounds = getPathBounds('Q 50 -20, 100 0', { x: 0, y: 0 });
        expect(bounds.minY).toBe(-20);
        expect(bounds.maxX).toBe(100);
    });

    it('should handle H and V commands', () => {
        const bounds = getPathBounds('H 200 V 150', { x: 10, y: 10 });
        expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 200, maxY: 150 });
    });

    it('should handle relative h and v commands', () => {
        const bounds = getPathBounds('h 50 v 30', { x: 10, y: 10 });
        expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 60, maxY: 40 });
    });

    it('should handle S (smooth cubic) commands', () => {
        const bounds = getPathBounds('S 50 -20, 100 0', { x: 0, y: 0 });
        expect(bounds.minY).toBe(-20);
        expect(bounds.maxX).toBe(100);
    });

    it('should handle Z command without error', () => {
        const bounds = getPathBounds('L 100 100 Z', { x: 0, y: 0 });
        expect(bounds.maxX).toBe(100);
        expect(bounds.maxY).toBe(100);
    });

    it('should handle a realistic jigsaw tab path', () => {
        // Simulates a tab that bulges outward (negative y = upward)
        const path = 'L 30 0 C 35 -25, 65 -25, 70 0 L 100 0';
        const bounds = getPathBounds(path, { x: 0, y: 0 });
        expect(bounds.minY).toBe(-25);
        expect(bounds.maxX).toBe(100);
        expect(bounds.minX).toBe(0);
    });
});

describe('computeGatheredPositions with tab paths', () => {
    it('should account for tab geometry in layout spacing', () => {
        // Create pieces with tabs that extend 30px beyond the edge
        const pieceWithTab: Piece = {
            id: 1,
            edges: [
                { id: 100, mateEdgeId: -1, matePieceId: -1, path: 'L 30 0 C 35 -30, 65 -30, 70 0 L 100 0', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
                { id: 101, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
                { id: 102, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
                { id: 103, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
            ],
            shape: '',
            imageOffset: { x: 0, y: 0 },
        };

        const plainPiece: Piece = {
            id: 2,
            edges: [
                { id: 200, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
                { id: 201, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
                { id: 202, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
                { id: 203, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
            ],
            shape: '',
            imageOffset: { x: 0, y: 0 },
        };

        const groups: PieceGroup[] = [
            { id: 1, pieces: new Map([[1, { x: 0, y: 0 }]]), position: { x: 0, y: 0 }, rotation: 0 },
            { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]), position: { x: 200, y: 0 }, rotation: 0 },
        ];

        const { layoutBounds } = computeGatheredPositions(groups, 1.33, [pieceWithTab, plainPiece]);

        // The layout should be taller than 100px to account for the 30px tab
        expect(layoutBounds.height).toBeGreaterThan(100);
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

describe('getGroupLocalBounds', () => {
    it('ignores rotation and returns un-rotated bounds', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 1; // CW 90°

        expect(getGroupLocalBounds(group, [piece])).toEqual({
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

        expect(getGroupVisualBounds(group, [piece])).toEqual(
            getGroupLocalBounds(group, [piece]),
        );
    });

    it('swaps width and height at rotation 1 (90° CW)', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 1;

        const bounds = getGroupVisualBounds(group, [piece]);

        expect(bounds.width).toBeCloseTo(40);
        expect(bounds.height).toBeCloseTo(100);
    });

    it('swaps width and height at rotation 3 (270° CW)', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 3;

        const bounds = getGroupVisualBounds(group, [piece]);

        expect(bounds.width).toBeCloseTo(40);
        expect(bounds.height).toBeCloseTo(100);
    });

    it('keeps width and height at rotation 2 (180°)', () => {
        const piece = makeRectPiece({ id: 1, width: 100, height: 40 });
        const group = makeGroup(1, 0, 0);
        group.rotation = 2;

        const bounds = getGroupVisualBounds(group, [piece]);

        expect(bounds.width).toBeCloseTo(100);
        expect(bounds.height).toBeCloseTo(40);
    });
});
