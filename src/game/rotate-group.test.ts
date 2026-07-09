import { describe, it, expect } from 'vitest';
import type { Edge, Piece, PieceGroup } from '../model/types.js';
import { rotateGroup } from './rotate-group.js';
import { getGroupLocalBounds } from './group-bounds.js';
import { buildPiecesById } from '../test-helpers/fixtures.js';

function makeEdge(id: number, sx: number, sy: number, ex: number, ey: number): Edge {
    return { id, mateEdgeId: -1, matePieceId: -1, path: '', start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

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
    it('rotates by +90° and normalizes into [0, 360)', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 270,
        };

        rotateGroup(group, buildPiecesById([piece]), 90);
        expect(group.rotation).toBe(0);
    });

    it('rotates by -90° and wraps 0 → 270', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };

        rotateGroup(group, buildPiecesById([piece]), -90);
        expect(group.rotation).toBe(270);
    });

    it('accepts non-quarter-turn deltas (e.g. 47°)', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 0, y: 0 },
            rotation: 0,
        };

        rotateGroup(group, buildPiecesById([piece]), 47);
        expect(group.rotation).toBeCloseTo(47);
    });

    it('preserves the world-space bbox center across a +90° rotation', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };

        const bounds = getGroupLocalBounds(group, buildPiecesById([piece]));
        const worldCenterBefore = {
            x: group.position.x + bounds.minX + bounds.width / 2,
            y: group.position.y + bounds.minY + bounds.height / 2,
        };

        rotateGroup(group, buildPiecesById([piece]), 90);

        const localCenter = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        // 90° CW: (x,y) → (-y, x)
        const rotated = { x: -localCenter.y, y: localCenter.x };
        const worldCenterAfter = {
            x: group.position.x + rotated.x,
            y: group.position.y + rotated.y,
        };

        expect(worldCenterAfter.x).toBeCloseTo(worldCenterBefore.x);
        expect(worldCenterAfter.y).toBeCloseTo(worldCenterBefore.y);
    });

    it('is inverse-consistent: +90 then -90 returns to the starting state', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };
        const startPosition = { ...group.position };

        rotateGroup(group, buildPiecesById([piece]), 90);
        rotateGroup(group, buildPiecesById([piece]), -90);

        expect(group.rotation).toBe(0);
        expect(group.position.x).toBeCloseTo(startPosition.x);
        expect(group.position.y).toBeCloseTo(startPosition.y);
    });

    it('four +90° rotations restore rotation and position', () => {
        const piece = makeSquarePiece(0);
        const group: PieceGroup = {
            id: 0,
            pieces: new Map([[0, { x: 0, y: 0 }]]),
            position: { x: 200, y: 100 },
            rotation: 0,
        };
        const startPosition = { ...group.position };

        for (let i = 0; i < 4; i++) rotateGroup(group, buildPiecesById([piece]), 90);

        expect(group.rotation).toBe(0);
        expect(group.position.x).toBeCloseTo(startPosition.x);
        expect(group.position.y).toBeCloseTo(startPosition.y);
    });

    it('handles multi-piece groups by pivoting around the combined bbox center', () => {
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

        const boundsBefore = getGroupLocalBounds(group, buildPiecesById([p0, p1]));
        const worldCenterBefore = {
            x: group.position.x + boundsBefore.minX + boundsBefore.width / 2,
            y: group.position.y + boundsBefore.minY + boundsBefore.height / 2,
        };

        rotateGroup(group, buildPiecesById([p0, p1]), 90);

        const localCenter = {
            x: boundsBefore.minX + boundsBefore.width / 2,
            y: boundsBefore.minY + boundsBefore.height / 2,
        };
        const rotated = { x: -localCenter.y, y: localCenter.x };
        const worldCenterAfter = {
            x: group.position.x + rotated.x,
            y: group.position.y + rotated.y,
        };

        expect(worldCenterAfter.x).toBeCloseTo(worldCenterBefore.x);
        expect(worldCenterAfter.y).toBeCloseTo(worldCenterBefore.y);
    });

    it('produces identical results with precomputedCenterLocal and computed bounds', () => {
        const p0 = makeSquarePiece(0);
        const p1 = makeSquarePiece(1);
        const piecesById = buildPiecesById([p0, p1]);
        const makeGroup = (): PieceGroup => ({
            id: 0,
            pieces: new Map([
                [0, { x: 0, y: 0 }],
                [1, { x: 100, y: 0 }],
            ]),
            position: { x: 500, y: 500 },
            rotation: 30,
        });

        const computed = makeGroup();
        rotateGroup(computed, piecesById, 47);

        const precomputed = makeGroup();
        const bounds = getGroupLocalBounds(precomputed, piecesById);
        const centerLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        rotateGroup(precomputed, piecesById, 47, centerLocal);

        expect(precomputed.rotation).toBe(computed.rotation);
        expect(precomputed.position.x).toBeCloseTo(computed.position.x);
        expect(precomputed.position.y).toBeCloseTo(computed.position.y);
    });
});
