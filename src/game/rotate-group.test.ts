import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup } from '../model/types.js';
import { rotateGroup } from './rotate-group.js';
import { getGroupLocalBounds } from './group-bounds.js';

function makeEdge(id: number, sx: number, sy: number, ex: number, ey: number): Edge {
    return {
        id,
        mateEdgeId: -1,
        matePieceId: -1,
        path: '',
        start: { x: sx, y: sy },
        end: { x: ex, y: ey },
    };
}

/** 100×100 piece with four plain edges. */
function makeSquarePiece(id: number): Piece {
    return {
        id,
        edges: [
            makeEdge(id * 10, 0, 0, 100, 0),
            makeEdge(id * 10 + 1, 100, 0, 100, 100),
            makeEdge(id * 10 + 2, 100, 100, 0, 100),
            makeEdge(id * 10 + 3, 0, 100, 0, 0),
        ],
        shape: '',
        imageOffset: { x: 0, y: 0 },
    };
}

describe('rotateGroup', () => {
    it('increments rotation clockwise, wrapping 3 → 0', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 3,
        };

        rotateGroup(group, [piece], 'cw');
        expect(group.rotation).toBe(0);
    });

    it('decrements rotation counter-clockwise, wrapping 0 → 3', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };

        rotateGroup(group, [piece], 'ccw');
        expect(group.rotation).toBe(3);
    });

    it('preserves the world-space bbox centre across a CW rotation', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };

        const bounds = getGroupLocalBounds(group, [piece]);
        const worldCentreBefore = {
            x: group.position.x + bounds.minX + bounds.width / 2,
            y: group.position.y + bounds.minY + bounds.height / 2,
        };

        rotateGroup(group, [piece], 'cw');

        // After rotation, the bbox is still a 100×100 region in local coords,
        // but the group's world-space centre must not have moved.
        // World centre after = position + R(centre_local).
        // bounds minX/minY/width/height stay the same (they're in local space).
        const localCentre = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        // R=1 (CW): (x,y) → (-y, x)
        const rotated = { x: -localCentre.y, y: localCentre.x };
        const worldCentreAfter = {
            x: group.position.x + rotated.x,
            y: group.position.y + rotated.y,
        };

        expect(worldCentreAfter.x).toBeCloseTo(worldCentreBefore.x);
        expect(worldCentreAfter.y).toBeCloseTo(worldCentreBefore.y);
    });

    it('is inverse-consistent: CW then CCW returns to the starting state', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };
        const startPosition = { ...group.position };

        rotateGroup(group, [piece], 'cw');
        rotateGroup(group, [piece], 'ccw');

        expect(group.rotation).toBe(0);
        expect(group.position.x).toBeCloseTo(startPosition.x);
        expect(group.position.y).toBeCloseTo(startPosition.y);
    });

    it('four CW rotations restore rotation and position', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };
        const startPosition = { ...group.position };

        for (let i = 0; i < 4; i++) rotateGroup(group, [piece], 'cw');

        expect(group.rotation).toBe(0);
        expect(group.position.x).toBeCloseTo(startPosition.x);
        expect(group.position.y).toBeCloseTo(startPosition.y);
    });

    it('handles multi-piece groups by pivoting around the combined bbox centre', () => {
        // Two pieces side-by-side: combined bbox 200×100, centre at local (100, 50)
        const p0 = makeSquarePiece(0);
        const p1 = makeSquarePiece(1);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 500, y: 500 },
            rotation: 0,
        };

        const boundsBefore = getGroupLocalBounds(group, [p0, p1]);
        const worldCentreBefore = {
            x: group.position.x + boundsBefore.minX + boundsBefore.width / 2,
            y: group.position.y + boundsBefore.minY + boundsBefore.height / 2,
        };

        rotateGroup(group, [p0, p1], 'cw');

        // Bounds are in un-rotated local space, so they are unchanged
        const localCentre = {
            x: boundsBefore.minX + boundsBefore.width / 2,
            y: boundsBefore.minY + boundsBefore.height / 2,
        };
        // R=1 CW
        const rotated = { x: -localCentre.y, y: localCentre.x };
        const worldCentreAfter = {
            x: group.position.x + rotated.x,
            y: group.position.y + rotated.y,
        };

        expect(worldCentreAfter.x).toBeCloseTo(worldCentreBefore.x);
        expect(worldCentreAfter.y).toBeCloseTo(worldCentreBefore.y);
    });
});
