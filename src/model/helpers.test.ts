import { describe, it, expect } from 'vitest';
import {
    getBorderEdges,
    getGroupForPiece,
    getMateEdge,
    getWorldPosition,
    localToWorld,
    moveGroup,
    normaliseDegrees,
    rotatePoint,
    signedAngularDelta,
} from './helpers.js';
import type { Piece, PieceGroup, Edge } from './types.js';
import { makeGameState } from '../test-helpers/fixtures.js';

/** Create a minimal edge for testing. */
function edge(
    id: number,
    mateEdgeId = -1,
    matePieceId = -1,
): Edge {
    return {
        id,
        mateEdgeId,
        matePieceId,
        path: 'L 10 0',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
    };
}

/** Create a minimal piece for testing. */
function piece(id: number, edges: Edge[]): Piece {
    return {
        id,
        edges,
        shape: 'M 0 0 L 10 0 L 10 10 L 0 10 Z',
        imageOffset: { x: 0, y: 0 },
    };
}

/** Create a group with given piece IDs. */
function group(id: number, pieceIds: number[]): PieceGroup {
    const pieces = new Map(pieceIds.map((pid) => [pid, { x: 0, y: 0 }]));
    return { id, pieces, position: { x: 0, y: 0 }, rotation: 0 };
}

describe('getMateEdge', () => {
    it('returns undefined for a border edge', () => {
        const p = piece(0, [edge(0)]);
        const state = makeGameState({ pieces: [p] });
        const result = getMateEdge(p, p.edges[0], state);
        expect(result).toBeUndefined();
    });

    it('returns the mate piece and edge for a connected edge', () => {
        const e1 = edge(0, 1, 1); // edge 0 on piece 0, mates with edge 1 on piece 1
        const e2 = edge(1, 0, 0); // edge 1 on piece 1, mates with edge 0 on piece 0
        const p0 = piece(0, [e1]);
        const p1 = piece(1, [e2]);

        const result = getMateEdge(p0, e1, makeGameState({ pieces: [p0, p1] }));

        expect(result).toBeDefined();
        expect(result!.piece.id).toBe(1);
        expect(result!.edge.id).toBe(1);
    });

    it('throws if mate piece is not found', () => {
        const e1 = edge(0, 1, 99); // references non-existent piece 99
        const p0 = piece(0, [e1]);

        expect(() => getMateEdge(p0, e1, makeGameState({ pieces: [p0] }))).toThrow(
            'Piece 99 not found',
        );
    });

    it('throws if mate edge is not found on the mate piece', () => {
        const e1 = edge(0, 99, 1); // references non-existent edge 99 on piece 1
        const p0 = piece(0, [e1]);
        const p1 = piece(1, [edge(2)]); // piece 1 has edge 2, not edge 99

        expect(() =>
            getMateEdge(p0, e1, makeGameState({ pieces: [p0, p1] })),
        ).toThrow('Mate edge 99 not found on piece 1');
    });
});

describe('getGroupForPiece', () => {
    it('finds the group containing a piece', () => {
        const g1 = group(0, [0, 1]);
        const g2 = group(1, [2, 3]);
        const state = makeGameState({ groups: [g1, g2] });

        expect(getGroupForPiece(state, 0).id).toBe(0);
        expect(getGroupForPiece(state, 2).id).toBe(1);
        expect(getGroupForPiece(state, 3).id).toBe(1);
    });

    it('throws if piece is not in any group', () => {
        const g1 = group(0, [0, 1]);
        const state = makeGameState({ groups: [g1] });

        expect(() => getGroupForPiece(state, 99)).toThrow(
            'Piece 99 is not in any group',
        );
    });
});

describe('moveGroup', () => {
    it('moves a group by the given delta', () => {
        const g = group(0, [0]);
        g.position = { x: 100, y: 200 };

        moveGroup(g, { x: 15, y: -10 });

        expect(g.position).toEqual({ x: 115, y: 190 });
    });

    it('handles zero delta', () => {
        const g = group(0, [0]);
        g.position = { x: 50, y: 50 };

        moveGroup(g, { x: 0, y: 0 });

        expect(g.position).toEqual({ x: 50, y: 50 });
    });

    it('accumulates multiple moves', () => {
        const g = group(0, [0]);
        g.position = { x: 0, y: 0 };

        moveGroup(g, { x: 10, y: 20 });
        moveGroup(g, { x: 5, y: -3 });

        expect(g.position).toEqual({ x: 15, y: 17 });
    });
});

describe('getBorderEdges', () => {
    it('returns edges whose mates are in a different group', () => {
        // Two pieces with mated edges, in different groups
        const e1 = edge(0, 1, 1);
        const e2 = edge(1, 0, 0);
        const p0 = piece(0, [e1]);
        const p1 = piece(1, [e2]);
        const g1 = group(0, [0]);
        const g2 = group(1, [1]);

        const borders = getBorderEdges(
            g1,
            makeGameState({ pieces: [p0, p1], groups: [g1, g2] }),
        );

        expect(borders).toHaveLength(1);
        expect(borders[0].piece.id).toBe(0);
        expect(borders[0].edge.id).toBe(0);
        expect(borders[0].matePiece.id).toBe(1);
        expect(borders[0].mateEdge.id).toBe(1);
        expect(borders[0].mateGroup.id).toBe(1);
    });

    it('excludes edges whose mates are in the same group', () => {
        // Two pieces with mated edges, in the SAME group
        const e1 = edge(0, 1, 1);
        const e2 = edge(1, 0, 0);
        const p0 = piece(0, [e1]);
        const p1 = piece(1, [e2]);
        const g1 = group(0, [0, 1]); // both pieces in same group

        const borders = getBorderEdges(
            g1,
            makeGameState({ pieces: [p0, p1], groups: [g1] }),
        );

        expect(borders).toHaveLength(0);
    });

    it('excludes border edges of the puzzle (no mate)', () => {
        const borderEdge = edge(0); // no mate
        const p0 = piece(0, [borderEdge]);
        const g1 = group(0, [0]);

        const borders = getBorderEdges(
            g1,
            makeGameState({ pieces: [p0], groups: [g1] }),
        );

        expect(borders).toHaveLength(0);
    });

    it('returns multiple border edges from different pieces in the group', () => {
        // Piece 0 has mate with piece 2, piece 1 has mate with piece 3
        // Pieces 0,1 in group A; pieces 2,3 in group B
        const e0 = edge(0, 4, 2);
        const e1 = edge(1, 5, 3);
        const e2 = edge(2); // border
        const e3 = edge(3); // border
        const e4 = edge(4, 0, 0);
        const e5 = edge(5, 1, 1);

        const p0 = piece(0, [e0, e2]);
        const p1 = piece(1, [e1, e3]);
        const p2 = piece(2, [e4]);
        const p3 = piece(3, [e5]);

        const gA = group(0, [0, 1]);
        const gB = group(1, [2, 3]);

        const borders = getBorderEdges(
            gA,
            makeGameState({ pieces: [p0, p1, p2, p3], groups: [gA, gB] }),
        );

        expect(borders).toHaveLength(2);
        expect(borders.map((b) => b.piece.id).sort()).toEqual([0, 1]);
    });
});

describe('rotatePoint (degrees)', () => {
    it('handles the four canonical quarter-turn angles', () => {
        const p = { x: 1, y: 0 };
        expect(rotatePoint(p, 0)).toEqual({ x: 1, y: 0 });
        const at90 = rotatePoint(p, 90);
        expect(at90.x).toBeCloseTo(0);
        expect(at90.y).toBeCloseTo(1);
        const at180 = rotatePoint(p, 180);
        expect(at180.x).toBeCloseTo(-1);
        expect(at180.y).toBeCloseTo(0);
        const at270 = rotatePoint(p, 270);
        expect(at270.x).toBeCloseTo(0);
        expect(at270.y).toBeCloseTo(-1);
    });

    it('handles non-quarter-turn angles', () => {
        const p = { x: 1, y: 0 };
        const r = rotatePoint(p, 47);
        // 47° clockwise rotation of (1, 0) around origin in screen-y-down coords.
        expect(r.x).toBeCloseTo(0.6820, 3);
        expect(r.y).toBeCloseTo(0.7314, 3);
    });

    it('handles negative and >360° inputs (no normalisation needed at this layer)', () => {
        const p = { x: 1, y: 0 };
        // -90° == +270°
        const a = rotatePoint(p, -90);
        const b = rotatePoint(p, 270);
        expect(a.x).toBeCloseTo(b.x);
        expect(a.y).toBeCloseTo(b.y);
    });
});

describe('localToWorld', () => {
    it('translates by group position when rotation is 0', () => {
        const g: PieceGroup = {
            id: 1,
            pieces: new Map(),
            position: { x: 100, y: 200 },
            rotation: 0,
        };
        expect(localToWorld({ x: 10, y: 20 }, g)).toEqual({ x: 110, y: 220 });
    });

    it('rotates around the group origin before translating', () => {
        // Local (10, 0) rotated 90° CW → (0, 10); + position (100, 200)
        const g: PieceGroup = {
            id: 1,
            pieces: new Map(),
            position: { x: 100, y: 200 },
            rotation: 90,
        };
        expect(localToWorld({ x: 10, y: 0 }, g)).toEqual({ x: 100, y: 210 });
    });

    it('handles 180° rotation', () => {
        // Local (10, 5) rotated 180° → (-10, -5); + position (50, 50)
        const g: PieceGroup = {
            id: 1,
            pieces: new Map(),
            position: { x: 50, y: 50 },
            rotation: 180,
        };
        expect(localToWorld({ x: 10, y: 5 }, g)).toEqual({ x: 40, y: 45 });
    });
});

describe('getWorldPosition', () => {
    function singlePieceGroup(id: number, pieceId: number, position: { x: number; y: number }): PieceGroup {
        return {
            id,
            pieces: new Map([[pieceId, { x: 0, y: 0 }]]),
            position,
            rotation: 0,
        };
    }

    it('computes world position from group position + offset + point', () => {
        const g: PieceGroup = {
            id: 1,
            pieces: new Map([[5, { x: 10, y: 20 }]]),
            position: { x: 100, y: 200 },
            rotation: 0,
        };

        expect(getWorldPosition({ x: 30, y: 40 }, 5, g)).toEqual({ x: 140, y: 260 });
    });

    it('handles zero offset (single-piece group)', () => {
        const g = singlePieceGroup(1, 5, { x: 50, y: 75 });
        expect(getWorldPosition({ x: 10, y: 20 }, 5, g)).toEqual({ x: 60, y: 95 });
    });

    it('throws if piece is not in the group', () => {
        const g = singlePieceGroup(1, 5, { x: 0, y: 0 });
        expect(() => getWorldPosition({ x: 0, y: 0 }, 99, g)).toThrow();
    });

    it('applies rotation to the local point before translating', () => {
        // Group at world (100, 200), rotated 90° CW, single piece at local (0,0)
        const g: PieceGroup = {
            id: 1,
            pieces: new Map([[5, { x: 0, y: 0 }]]),
            position: { x: 100, y: 200 },
            rotation: 90,
        };

        // Local point (10, 0) rotated 90° CW → (0, 10); then + position
        expect(getWorldPosition({ x: 10, y: 0 }, 5, g)).toEqual({ x: 100, y: 210 });
    });

    it('applies rotation with a non-zero piece offset', () => {
        // Offset + point = local (10, 0); rotated 180° → (-10, 0)
        const g: PieceGroup = {
            id: 1,
            pieces: new Map([[5, { x: 10, y: 0 }]]),
            position: { x: 50, y: 50 },
            rotation: 180,
        };

        expect(getWorldPosition({ x: 0, y: 0 }, 5, g)).toEqual({ x: 40, y: 50 });
    });
});

describe('normaliseDegrees', () => {
    it('returns values in [0, 360) for any input', () => {
        expect(normaliseDegrees(0)).toBe(0);
        expect(normaliseDegrees(90)).toBe(90);
        expect(normaliseDegrees(360)).toBe(0);
        expect(normaliseDegrees(720)).toBe(0);
        expect(normaliseDegrees(-90)).toBe(270);
        expect(normaliseDegrees(-450)).toBe(270);
    });

    it('preserves fractional values', () => {
        expect(normaliseDegrees(47.3)).toBeCloseTo(47.3);
        expect(normaliseDegrees(360.5)).toBeCloseTo(0.5);
        expect(normaliseDegrees(-0.5)).toBeCloseTo(359.5);
    });
});

describe('signedAngularDelta', () => {
    it('returns 0 for equal angles', () => {
        expect(signedAngularDelta(0, 0)).toBe(0);
        expect(signedAngularDelta(90, 90)).toBe(0);
    });

    it('returns the smallest signed delta in (-180, 180]', () => {
        expect(signedAngularDelta(10, 0)).toBe(10);
        expect(signedAngularDelta(0, 10)).toBe(-10);
        expect(signedAngularDelta(170, 10)).toBe(160);
        expect(signedAngularDelta(10, 170)).toBe(-160);
    });

    it('wraps correctly across the 0/360 boundary', () => {
        expect(signedAngularDelta(359, 1)).toBe(-2);
        expect(signedAngularDelta(1, 359)).toBe(2);
        expect(signedAngularDelta(355, 5)).toBe(-10);
        expect(signedAngularDelta(5, 355)).toBe(10);
    });

    it('returns +180 (not -180) for an exactly opposite pair', () => {
        // Convention: (-180, 180]. Boundary value is +180, not -180.
        expect(signedAngularDelta(180, 0)).toBe(180);
    });

    it('handles unnormalised inputs', () => {
        expect(signedAngularDelta(720, 0)).toBe(0);
        expect(signedAngularDelta(-90, 0)).toBe(-90);
    });
});
