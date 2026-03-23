/**
 * Tests for the gather pieces logic.
 */

import { describe, it, expect } from 'vitest';
import type { PieceGroup } from '../model/types.js';
import {
    computeGatheredPositions,
    applyGatheredPositions,
    getGroupOffsetBounds,
} from './gather.js';
import type { WorldRect } from './gather.js';

/** Helper to create a simple single-piece group at a given position. */
function makeGroup(id: number, x: number, y: number): PieceGroup {
    return {
        id,
        pieces: new Map([[id, { x: 0, y: 0 }]]),
        position: { x, y },
        rotation: 0,
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
        rotation: 0,
    };
}

const defaultVisibleArea: WorldRect = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
};

const pieceWidth = 100;
const pieceHeight = 100;

describe('getGroupOffsetBounds', () => {
    it('should return zero bounds for a single-piece group at origin', () => {
        const group = makeGroup(1, 0, 0);
        const bounds = getGroupOffsetBounds(group);

        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });

    it('should return correct bounds for a multi-piece group', () => {
        const group = makeMultiGroup(1, { x: 0, y: 0 }, [
            [1, { x: 0, y: 0 }],
            [2, { x: 100, y: 0 }],
            [3, { x: 0, y: 100 }],
            [4, { x: 100, y: 100 }],
        ]);

        const bounds = getGroupOffsetBounds(group);

        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    });

    it('should handle negative offsets', () => {
        const group = makeMultiGroup(1, { x: 50, y: 50 }, [
            [1, { x: -50, y: -50 }],
            [2, { x: 50, y: 50 }],
        ]);

        const bounds = getGroupOffsetBounds(group);

        expect(bounds).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    });
});

describe('computeGatheredPositions', () => {
    it('should return an empty map for no groups', () => {
        const result = computeGatheredPositions(
            [],
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );

        expect(result.size).toBe(0);
    });

    it('should centre a single group in the visible area', () => {
        const groups = [makeGroup(1, 1000, 2000)];
        const result = computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );

        expect(result.size).toBe(1);

        const pos = result.get(1)!;
        // Centre of 800x600 = (400, 300)
        // Single piece group (100x100): centre minus half size
        expect(pos.x).toBe(350);
        expect(pos.y).toBe(250);
    });

    it('should produce positions for all groups', () => {
        const groups = [
            makeGroup(1, 0, 0),
            makeGroup(2, 500, 500),
            makeGroup(3, -100, -200),
            makeGroup(4, 1000, 1000),
        ];

        const result = computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );

        expect(result.size).toBe(4);

        for (const group of groups) {
            expect(result.has(group.id)).toBe(true);
        }
    });

    it('should scatter groups within the puzzle-relative area', () => {
        const groups = [
            makeGroup(1, 0, 0),
            makeGroup(2, 1000, 0),
            makeGroup(3, 0, 1000),
            makeGroup(4, 1000, 1000),
        ];

        const result = computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
            8, // puzzleCols
            6, // puzzleRows
        );

        // All 4 groups should get positions
        expect(result.size).toBe(4);

        // Scatter area is 2.5× puzzle size = 2000×1500, centred on visible area
        // Positions should be within a reasonable range of the centre
        const centreX = 400;
        const centreY = 300;
        const maxDist = 1500; // generous bound

        for (const pos of result.values()) {
            expect(Math.abs(pos.x - centreX)).toBeLessThan(maxDist);
            expect(Math.abs(pos.y - centreY)).toBeLessThan(maxDist);
        }
    });

    it('should produce different positions on repeated calls (shuffle + jitter)', () => {
        const groups = Array.from({ length: 10 }, (_, i) =>
            makeGroup(i, i * 100, i * 100),
        );

        const result1 = computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );
        const result2 = computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );

        // At least some positions should differ (extremely unlikely to match)
        let anyDifferent = false;
        for (const group of groups) {
            const p1 = result1.get(group.id)!;
            const p2 = result2.get(group.id)!;
            if (p1.x !== p2.x || p1.y !== p2.y) {
                anyDifferent = true;
                break;
            }
        }
        expect(anyDifferent).toBe(true);
    });

    it('should handle a visible area with non-zero origin', () => {
        const visibleArea: WorldRect = { x: -200, y: -100, width: 400, height: 300 };
        const groups = [makeGroup(1, 0, 0)];

        const result = computeGatheredPositions(
            groups,
            visibleArea,
            pieceWidth,
            pieceHeight,
        );

        const pos = result.get(1)!;
        // Centre: (-200 + 400/2, -100 + 300/2) = (0, 50)
        // Centred single piece: (0 - 50, 50 - 50) = (-50, 0)
        expect(pos.x).toBe(-50);
        expect(pos.y).toBe(0);
    });

    it('should handle many groups without overlapping positions', () => {
        const groups = Array.from({ length: 20 }, (_, i) =>
            makeGroup(i, i * 500, i * 500),
        );

        const result = computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );

        // All positions should be unique
        const positions = [...result.values()];
        const positionStrings = positions.map((p) => `${p.x},${p.y}`);
        const uniquePositions = new Set(positionStrings);

        expect(uniquePositions.size).toBe(20);
    });

    it('should not mutate the original groups', () => {
        const groups = [
            makeGroup(1, 100, 200),
            makeGroup(2, 300, 400),
        ];

        const originalPositions = groups.map((g) => ({ ...g.position }));

        computeGatheredPositions(
            groups,
            defaultVisibleArea,
            pieceWidth,
            pieceHeight,
        );

        // Positions should be unchanged
        groups.forEach((g, i) => {
            expect(g.position).toEqual(originalPositions[i]);
        });
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

    it('should not affect groups not in the positions map', () => {
        const groups = [makeGroup(1, 100, 200), makeGroup(2, 300, 400)];

        const positions = new Map([[1, { x: 10, y: 20 }]]);

        applyGatheredPositions(groups, positions);

        expect(groups[0].position).toEqual({ x: 10, y: 20 });
        expect(groups[1].position).toEqual({ x: 300, y: 400 });
    });

    it('should create new position objects (not share references)', () => {
        const groups = [makeGroup(1, 100, 200)];
        const newPos = { x: 10, y: 20 };
        const positions = new Map([[1, newPos]]);

        applyGatheredPositions(groups, positions);

        // Mutating the source should not affect the applied position
        newPos.x = 999;
        expect(groups[0].position.x).toBe(10);
    });
});
