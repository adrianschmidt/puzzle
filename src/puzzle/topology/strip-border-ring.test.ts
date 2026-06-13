import { describe, it, expect } from 'vitest';
import { stripBorderRing } from './strip-border-ring.js';
import type { Piece, Edge } from '../../model/types.js';

// Minimal edge/piece factories for topology-level assertions.
function edge(id: number, matePieceId: number, mateEdgeId: number, path = 'L1,0'): Edge {
    return { id, matePieceId, mateEdgeId, path, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
}
function piece(id: number, edges: Edge[]): Piece {
    return { id, edges, shape: `shape-${id}`, imageOffset: { x: 0, y: 0 } };
}

describe('stripBorderRing', () => {
    it('removes pieces that have a border edge and keeps the rest', () => {
        // p0 is on the border (has a mate=-1 edge); p1 is interior, mated to p0.
        const p0 = piece(0, [edge(0, -1, -1), edge(1, 1, 10)]);
        const p1 = piece(1, [edge(10, 0, 1), edge(11, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 11), edge(21, 3, 30)]);
        const p3 = piece(3, [edge(30, 2, 21), edge(31, -1, -1)]); // also border

        const { pieces } = stripBorderRing([p0, p1, p2, p3], []);

        expect(pieces.map((p) => p.id).sort()).toEqual([1, 2]);
    });

    it('re-marks a survivor edge that pointed at a removed piece as a border edge', () => {
        const p0 = piece(0, [edge(0, -1, -1)]);            // border ring
        const p1 = piece(1, [edge(10, 0, 0), edge(11, 2, 20)]); // edge 10 → removed p0
        const p2 = piece(2, [edge(20, 1, 11)]);            // keep p2 so p1 isn't all-border

        const { pieces } = stripBorderRing([p0, p1, p2], []);

        const survivor = pieces.find((p) => p.id === 1)!;
        const exposed = survivor.edges.find((e) => e.id === 10)!;
        expect(exposed.matePieceId).toBe(-1);
        expect(exposed.mateEdgeId).toBe(-1);
        // Geometry (the inward tab) is retained, not straightened.
        expect(exposed.path).toBe('L1,0');
        // The still-internal edge is untouched.
        expect(survivor.edges.find((e) => e.id === 11)!.matePieceId).toBe(2);
    });

    it('leaves the piece shape untouched', () => {
        const p0 = piece(0, [edge(0, -1, -1)]);
        const p1 = piece(1, [edge(10, 0, 0), edge(11, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 11)]);
        const { pieces } = stripBorderRing([p0, p1, p2], []);
        expect(pieces.find((p) => p.id === 1)!.shape).toBe('shape-1');
    });

    it('reconciles autoGroups: drops removed pieces and 1-piece groups', () => {
        const p0 = piece(0, [edge(0, -1, -1)]);
        const p1 = piece(1, [edge(10, 0, 0), edge(11, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 11), edge(21, 3, 30)]);
        const p3 = piece(3, [edge(30, 2, 21), edge(31, 2, 22)]); // interior, mated only to survivors
        const groups = [
            { id: 0, pieceIds: [0, 1] }, // p0 removed → 1 piece left → dropped
            { id: 1, pieceIds: [2, 3] }, // both survive → kept
        ];
        const { pieces, autoGroups } = stripBorderRing([p0, p1, p2, p3], groups);
        expect(pieces.map((p) => p.id).sort()).toEqual([1, 2, 3]);
        expect(autoGroups).toEqual([{ id: 1, pieceIds: [2, 3] }]);
    });

    it('is a no-op on a graph with no border edges', () => {
        const p1 = piece(1, [edge(10, 2, 20)]);
        const p2 = piece(2, [edge(20, 1, 10)]);
        const { pieces } = stripBorderRing([p1, p2], []);
        expect(pieces.map((p) => p.id).sort()).toEqual([1, 2]);
    });
});
