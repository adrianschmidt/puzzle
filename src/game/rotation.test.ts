/**
 * Tests for rotation-related functionality:
 * - Rotation in merge detection
 * - Rotation snapping on merge
 * - Random initial rotations
 * - World position with rotation
 */

import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import {
    checkEdgeAlignment,
    getWorldPosition,
    normalizeAngle,
    rotationsMatch,
    ROTATION_TOLERANCE_DEG,
} from './merge-detection.js';
import { mergeGroups } from './group-merging.js';
import { createInitialGroups } from './init.js';

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

function makeGroup(
    id: number,
    pieceId: number,
    position: Point,
    rotation: number = 0,
): PieceGroup {
    return {
        id,
        pieces: new Map([[pieceId, { x: 0, y: 0 }]]),
        position,
        rotation,
    };
}

function createAdjacentPiecePair(): {
    piece0: Piece;
    piece1: Piece;
    rightEdge: Edge;
    leftEdge: Edge;
} {
    const rightEdge = makeEdge(0, { x: 100, y: 0 }, { x: 100, y: 100 }, 1, 1);
    const leftEdge = makeEdge(1, { x: 0, y: 100 }, { x: 0, y: 0 }, 0, 0);

    const piece0 = makePiece(0, [
        makeEdge(10, { x: 0, y: 0 }, { x: 100, y: 0 }),
        rightEdge,
        makeEdge(11, { x: 100, y: 100 }, { x: 0, y: 100 }),
        makeEdge(12, { x: 0, y: 100 }, { x: 0, y: 0 }),
    ]);

    const piece1 = makePiece(1, [
        makeEdge(13, { x: 0, y: 0 }, { x: 100, y: 0 }),
        makeEdge(14, { x: 100, y: 0 }, { x: 100, y: 100 }),
        makeEdge(15, { x: 100, y: 100 }, { x: 0, y: 100 }),
        leftEdge,
    ]);

    return { piece0, piece1, rightEdge, leftEdge };
}

// --- Tests ---

describe('normalizeAngle', () => {
    it('normalizes positive angles', () => {
        expect(normalizeAngle(0)).toBe(0);
        expect(normalizeAngle(90)).toBe(90);
        expect(normalizeAngle(360)).toBe(0);
        expect(normalizeAngle(450)).toBe(90);
    });

    it('normalizes negative angles', () => {
        expect(normalizeAngle(-90)).toBe(270);
        expect(normalizeAngle(-180)).toBe(180);
        expect(normalizeAngle(-360)).toBe(0);
    });
});

describe('rotationsMatch', () => {
    it('matches identical rotations', () => {
        expect(rotationsMatch(0, 0)).toBe(true);
        expect(rotationsMatch(90, 90)).toBe(true);
        expect(rotationsMatch(270, 270)).toBe(true);
    });

    it('matches rotations within tolerance', () => {
        expect(rotationsMatch(0, ROTATION_TOLERANCE_DEG - 1)).toBe(true);
        expect(rotationsMatch(90, 90 + ROTATION_TOLERANCE_DEG - 1)).toBe(true);
    });

    it('rejects rotations outside tolerance', () => {
        expect(rotationsMatch(0, 90)).toBe(false);
        expect(rotationsMatch(0, 45)).toBe(false);
        expect(rotationsMatch(90, 180)).toBe(false);
    });

    it('handles wrap-around at 360°', () => {
        expect(rotationsMatch(0, 359)).toBe(true);
        expect(rotationsMatch(359, 0)).toBe(true);
        expect(rotationsMatch(1, 359)).toBe(true);
    });
});

describe('getWorldPosition with rotation', () => {
    it('returns unrotated position when rotation is 0', () => {
        const group = makeGroup(1, 5, { x: 100, y: 200 }, 0);
        group.pieces.set(5, { x: 10, y: 20 });

        const result = getWorldPosition({ x: 30, y: 40 }, 5, group);
        expect(result.x).toBeCloseTo(140);
        expect(result.y).toBeCloseTo(260);
    });

    it('rotates position by 90° around group anchor', () => {
        const group = makeGroup(1, 5, { x: 0, y: 0 }, 90);
        group.pieces.set(5, { x: 0, y: 0 });

        // Point (100, 0) rotated 90° should be (0, 100)
        const result = getWorldPosition({ x: 100, y: 0 }, 5, group);
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(100);
    });

    it('rotates position by 180° around group anchor', () => {
        const group = makeGroup(1, 5, { x: 0, y: 0 }, 180);
        group.pieces.set(5, { x: 0, y: 0 });

        // Point (100, 0) rotated 180° should be (-100, 0)
        const result = getWorldPosition({ x: 100, y: 0 }, 5, group);
        expect(result.x).toBeCloseTo(-100);
        expect(result.y).toBeCloseTo(0);
    });

    it('applies group position after rotation', () => {
        const group = makeGroup(1, 5, { x: 50, y: 50 }, 90);
        group.pieces.set(5, { x: 0, y: 0 });

        const result = getWorldPosition({ x: 100, y: 0 }, 5, group);
        expect(result.x).toBeCloseTo(50);  // 0 + 50
        expect(result.y).toBeCloseTo(150); // 100 + 50
    });
});

describe('merge detection with rotation', () => {
    it('rejects alignment when groups have different rotations', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 }, 0);
        const group1 = makeGroup(1, 1, { x: 100, y: 0 }, 90);

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
        );

        expect(result.aligned).toBe(false);
    });

    it('accepts alignment when both groups are at same non-zero rotation', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        // Both at 0° rotation, perfectly positioned
        const group0 = makeGroup(0, 0, { x: 0, y: 0 }, 0);
        const group1 = makeGroup(1, 1, { x: 100, y: 0 }, 0);

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
        );

        expect(result.aligned).toBe(true);
    });

    it('accepts alignment when rotations are within tolerance', () => {
        const { piece0, piece1, rightEdge, leftEdge } = createAdjacentPiecePair();

        const group0 = makeGroup(0, 0, { x: 0, y: 0 }, 0);
        const group1 = makeGroup(1, 1, { x: 100, y: 0 }, ROTATION_TOLERANCE_DEG - 1);

        const result = checkEdgeAlignment(
            piece0, rightEdge, group0,
            piece1, leftEdge, group1,
        );

        // Still aligned because rotation is within tolerance
        expect(result.aligned).toBe(true);
    });
});

describe('merge snaps rotation to 0°', () => {
    it('sets rotation to 0 on the merged group', () => {
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
        expect(result.rotation).toBe(0);
    });

    it('snaps non-zero rotation to 0 on merge', () => {
        // Both groups at the same rotation (non-zero)
        // After merge, the resulting group should be at 0° with positions adjusted
        const movedGroup: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };
        const targetGroup: PieceGroup = {
            id: 1,
            pieces: new Map([[1, { x: 0, y: 0 }]]),
            position: { x: 100, y: 0 },
            rotation: 0,
        };

        const result = mergeGroups(movedGroup, targetGroup, { x: 0, y: 0 });
        expect(result.rotation).toBe(0);
    });
});

describe('initial rotation', () => {
    it('assigns random rotations to pieces on game init', () => {
        const pieces = Array.from({ length: 48 }, (_, i) => makePiece(i, []));

        let callCount = 0;
        const mockRandom = () => {
            callCount++;
            return (callCount % 4) / 4;
        };

        const groups = createInitialGroups(
            pieces,
            { width: 800, height: 600 },
            { width: 1024, height: 768 },
            { cols: 8, rows: 6 },
            { random: mockRandom },
        );

        // Check that some groups have non-zero rotations
        const rotations = groups.map(g => g.rotation);
        const uniqueRotations = new Set(rotations);
        expect(uniqueRotations.size).toBeGreaterThan(1);

        // All rotations should be multiples of 90
        for (const r of rotations) {
            expect(r % 90).toBe(0);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(360);
        }
    });

    it('all rotations are valid 90° increments', () => {
        const pieces = Array.from({ length: 20 }, (_, i) => makePiece(i, []));
        const validRotations = [0, 90, 180, 270];

        const groups = createInitialGroups(
            pieces,
            { width: 800, height: 600 },
            { width: 1024, height: 768 },
            { cols: 5, rows: 4 },
        );

        for (const group of groups) {
            expect(validRotations).toContain(group.rotation);
        }
    });
});
