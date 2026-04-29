/**
 * Tests for group bounds primitives.
 */

import { describe, it, expect } from 'vitest';
import type { PieceGroup } from '../model/types.js';
import {
    getGroupOffsetBounds,
    getGroupLocalBounds,
    getGroupVisualBounds,
} from './group-bounds.js';
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
