import { describe, it, expect } from 'vitest';
import {
    getMateEdge,
    findGroupForPiece,
    moveGroup,
    getBorderEdges,
    normaliseQuarterTurns,
    rotatePoint,
} from './helpers.js';
import type { Piece, PieceGroup, Edge } from './types.js';

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
        const result = getMateEdge(p, p.edges[0], [p]);
        expect(result).toBeUndefined();
    });

    it('returns the mate piece and edge for a connected edge', () => {
        const e1 = edge(0, 1, 1); // edge 0 on piece 0, mates with edge 1 on piece 1
        const e2 = edge(1, 0, 0); // edge 1 on piece 1, mates with edge 0 on piece 0
        const p0 = piece(0, [e1]);
        const p1 = piece(1, [e2]);

        const result = getMateEdge(p0, e1, [p0, p1]);

        expect(result).toBeDefined();
        expect(result!.piece.id).toBe(1);
        expect(result!.edge.id).toBe(1);
    });

    it('throws if mate piece is not found', () => {
        const e1 = edge(0, 1, 99); // references non-existent piece 99
        const p0 = piece(0, [e1]);

        expect(() => getMateEdge(p0, e1, [p0])).toThrow('Piece 99 not found');
    });

    it('throws if mate edge is not found on the mate piece', () => {
        const e1 = edge(0, 99, 1); // references non-existent edge 99 on piece 1
        const p0 = piece(0, [e1]);
        const p1 = piece(1, [edge(2)]); // piece 1 has edge 2, not edge 99

        expect(() => getMateEdge(p0, e1, [p0, p1])).toThrow(
            'Mate edge 99 not found on piece 1',
        );
    });
});

describe('findGroupForPiece', () => {
    it('finds the group containing a piece', () => {
        const g1 = group(0, [0, 1]);
        const g2 = group(1, [2, 3]);

        expect(findGroupForPiece(0, [g1, g2]).id).toBe(0);
        expect(findGroupForPiece(2, [g1, g2]).id).toBe(1);
        expect(findGroupForPiece(3, [g1, g2]).id).toBe(1);
    });

    it('throws if piece is not in any group', () => {
        const g1 = group(0, [0, 1]);

        expect(() => findGroupForPiece(99, [g1])).toThrow(
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

        const borders = getBorderEdges(g1, [p0, p1], [g1, g2]);

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

        const borders = getBorderEdges(g1, [p0, p1], [g1]);

        expect(borders).toHaveLength(0);
    });

    it('excludes border edges of the puzzle (no mate)', () => {
        const borderEdge = edge(0); // no mate
        const p0 = piece(0, [borderEdge]);
        const g1 = group(0, [0]);

        const borders = getBorderEdges(g1, [p0], [g1]);

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

        const borders = getBorderEdges(gA, [p0, p1, p2, p3], [gA, gB]);

        expect(borders).toHaveLength(2);
        expect(borders.map((b) => b.piece.id).sort()).toEqual([0, 1]);
    });
});

describe('rotatePoint', () => {
    it('returns the point unchanged at 0 quarter-turns', () => {
        expect(rotatePoint({ x: 3, y: 7 }, 0)).toEqual({ x: 3, y: 7 });
    });

    it('rotates 90° clockwise', () => {
        // (10, 0) -> (0, 10) under clockwise rotation in screen coords (y-down)
        const r = rotatePoint({ x: 10, y: 0 }, 1);
        expect(r.x).toBeCloseTo(0);
        expect(r.y).toBeCloseTo(10);
    });

    it('rotates 180°', () => {
        const r = rotatePoint({ x: 3, y: 7 }, 2);
        expect(r.x).toBeCloseTo(-3);
        expect(r.y).toBeCloseTo(-7);
    });

    it('rotates 270° (= 90° CCW)', () => {
        const r = rotatePoint({ x: 10, y: 0 }, 3);
        expect(r.x).toBeCloseTo(0);
        expect(r.y).toBeCloseTo(-10);
    });

    it('is its own inverse at 4 quarter-turns', () => {
        const p = { x: 11, y: -4 };
        let r = p;
        for (let i = 0; i < 4; i++) r = rotatePoint(r, 1);
        expect(r.x).toBeCloseTo(p.x);
        expect(r.y).toBeCloseTo(p.y);
    });
});

describe('normaliseQuarterTurns', () => {
    it('leaves in-range values alone', () => {
        expect(normaliseQuarterTurns(0)).toBe(0);
        expect(normaliseQuarterTurns(1)).toBe(1);
        expect(normaliseQuarterTurns(2)).toBe(2);
        expect(normaliseQuarterTurns(3)).toBe(3);
    });

    it('wraps values above 3', () => {
        expect(normaliseQuarterTurns(4)).toBe(0);
        expect(normaliseQuarterTurns(7)).toBe(3);
    });

    it('wraps negative values', () => {
        expect(normaliseQuarterTurns(-1)).toBe(3);
        expect(normaliseQuarterTurns(-4)).toBe(0);
        expect(normaliseQuarterTurns(-5)).toBe(3);
    });
});
