import { describe, expect, it } from 'vitest';
import { sealPieceGeometry } from './seal-geometry.js';
import { computePieceBounds } from './derive.js';
import type { GeneratedPiece, Piece } from './types.js';

function curvedPiece(): GeneratedPiece {
    return {
        id: 7,
        imageOffset: { x: -10, y: -20 },
        shape: 'M 0 0 L 10 0 L 10 10 L 0 10 Z',
        edges: [
            {
                id: 0, mateEdgeId: -1, matePieceId: -1,
                path: 'L 10 0', start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
                // Sample dips below the endpoint box — must extend the bbox.
                curvePoints: [{ x: 0, y: 0 }, { x: 5, y: -2.5 }, { x: 10, y: 0 }],
            },
            {
                id: 1, mateEdgeId: -1, matePieceId: -1,
                path: 'L 0 10', start: { x: 10, y: 0 }, end: { x: 0, y: 10 },
            },
        ],
    };
}

describe('sealPieceGeometry', () => {
    it('stores bounds equal to the curve-aware walk', () => {
        const input = curvedPiece();
        const [sealed] = sealPieceGeometry([input]);
        expect(sealed.bounds).toEqual(computePieceBounds(input));
        expect(sealed.bounds).toEqual({ minX: 0, minY: -2.5, maxX: 10, maxY: 10 });
    });

    it('strips curvePoints from every edge', () => {
        const [sealed] = sealPieceGeometry([curvedPiece()]);
        for (const e of sealed.edges) {
            expect('curvePoints' in e).toBe(false);
        }
    });

    it('leaves shape, edge paths, endpoints, and imageOffset untouched', () => {
        const input = curvedPiece();
        const [sealed] = sealPieceGeometry([input]);
        expect(sealed.shape).toBe(input.shape);
        expect(sealed.imageOffset).toBe(input.imageOffset);
        sealed.edges.forEach((e, i) => {
            expect(e.path).toBe(input.edges[i].path);
            expect(e.start).toBe(input.edges[i].start);
            expect(e.end).toBe(input.edges[i].end);
        });
    });

    it('does not mutate its input', () => {
        const input = curvedPiece();
        sealPieceGeometry([input]);
        expect(input.edges[0].curvePoints).toHaveLength(3);
        expect((input as Partial<Piece>).bounds).toBeUndefined();
    });

    it('reuses edge objects that carry no curvePoints', () => {
        const input = curvedPiece();
        const [sealed] = sealPieceGeometry([input]);
        expect(sealed.edges[1]).toBe(input.edges[1]);
    });

    it('is idempotent', () => {
        const once = sealPieceGeometry([curvedPiece()]);
        const twice = sealPieceGeometry(once);
        expect(twice).toEqual(once);
    });
});
