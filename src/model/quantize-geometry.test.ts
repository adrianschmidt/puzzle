import { describe, it, expect } from 'vitest';
import type { Edge, Piece } from './types.js';
import { GEOMETRY_PRECISION_DECIMALS, quantizePieceGeometry } from './quantize-geometry.js';
import { makePiece } from '../test-helpers/fixtures.js';
import { worstPrecision } from '../test-helpers/precision.js';

function makeEdge(overrides: Partial<Edge> = {}): Edge {
    return {
        id: 0,
        mateEdgeId: -1,
        matePieceId: -1,
        path: 'L 10.12 20.35',
        start: { x: 1.234567, y: 2.345678 },
        end: { x: 10.123456, y: 20.345678 },
        ...overrides,
    };
}

describe('quantizePieceGeometry', () => {
    it('rounds edge endpoints to 2 decimals', () => {
        const [piece] = quantizePieceGeometry([makePiece({ edges: [makeEdge()] })]);

        expect(piece.edges[0].start).toEqual({ x: 1.23, y: 2.35 });
        expect(piece.edges[0].end).toEqual({ x: 10.12, y: 20.35 });
    });

    it('rounds every curve point to 2 decimals', () => {
        const edge = makeEdge({
            curvePoints: [
                { x: 0, y: 0 },
                { x: 3.14159265, y: 2.71828182 },
                { x: 99.999999, y: -0.004999 },
            ],
        });

        const [piece] = quantizePieceGeometry([makePiece({ edges: [edge] })]);

        expect(piece.edges[0].curvePoints).toEqual([
            { x: 0, y: 0 },
            { x: 3.14, y: 2.72 },
            { x: 100, y: 0 },
        ]);
    });

    // A tiny negative coordinate rounds to -0, which JSON.stringify writes as
    // "0". Left alone, in-memory geometry would stop matching the geometry read
    // back from disk — the exact property this pass exists to guarantee.
    it('normalizes negative zero so it survives a JSON round-trip', () => {
        const edge = makeEdge({ start: { x: -0.001, y: -0.001 } });

        const [piece] = quantizePieceGeometry([makePiece({ edges: [edge] })]);
        const roundTripped = JSON.parse(JSON.stringify(piece)) as Piece;

        expect(Object.is(piece.edges[0].start.x, -0)).toBe(false);
        expect(piece.edges[0].start).toEqual(roundTripped.edges[0].start);
    });

    it('rounds the image offset to 2 decimals', () => {
        const piece = makePiece({ imageOffset: { x: -135.0000001, y: -89.987654 } });

        const [quantized] = quantizePieceGeometry([piece]);

        expect(quantized.imageOffset).toEqual({ x: -135, y: -89.99 });
    });

    it('leaves shape and edge path strings byte-identical', () => {
        const shape = 'M 0 0 L 10.12 0 C 1.5 2.25, 3.75 4.5, 10.12 20.35 Z';
        const path = 'C 1.5 2.25, 3.75 4.5, 10.12 20.35';

        const [piece] = quantizePieceGeometry([
            makePiece({ shape, edges: [makeEdge({ path })] }),
        ]);

        expect(piece.shape).toBe(shape);
        expect(piece.edges[0].path).toBe(path);
    });

    it('leaves an edge without curve points free of the field', () => {
        const [piece] = quantizePieceGeometry([makePiece({ edges: [makeEdge()] })]);

        expect('curvePoints' in piece.edges[0]).toBe(false);
    });

    it('preserves edge identity and mate wiring', () => {
        const edge = makeEdge({ id: 7, mateEdgeId: 8, matePieceId: 3 });

        const [piece] = quantizePieceGeometry([makePiece({ id: 5, edges: [edge] })]);

        expect(piece.id).toBe(5);
        expect(piece.edges[0]).toMatchObject({ id: 7, mateEdgeId: 8, matePieceId: 3 });
    });

    it('does not mutate the input pieces', () => {
        const edge = makeEdge({ curvePoints: [{ x: 3.14159265, y: 2.71828182 }] });
        const input = [makePiece({ edges: [edge], imageOffset: { x: -1.23456, y: 0 } })];

        quantizePieceGeometry(input);

        expect(input[0].edges[0].start).toEqual({ x: 1.234567, y: 2.345678 });
        expect(input[0].edges[0].curvePoints).toEqual([{ x: 3.14159265, y: 2.71828182 }]);
        expect(input[0].imageOffset).toEqual({ x: -1.23456, y: 0 });
    });

    it('is idempotent', () => {
        const input = [
            makePiece({
                edges: [makeEdge({ curvePoints: [{ x: 3.14159265, y: 2.71828182 }] })],
                imageOffset: { x: -1.23456, y: 0 },
            }),
        ];

        const once = quantizePieceGeometry(input);
        const twice = quantizePieceGeometry(once);

        expect(twice).toEqual(once);
    });

    it('emits coordinates that serialize with no more than 2 decimals', () => {
        const edge = makeEdge({
            curvePoints: [
                { x: 1 / 3, y: 2 / 3 },
                { x: 1234.56789, y: 0.005 },
            ],
        });

        const [piece] = quantizePieceGeometry([
            makePiece({ edges: [edge], imageOffset: { x: -1 / 7, y: 1e-9 } }),
        ]);

        const worst = worstPrecision(piece);

        expect(worst.decimals, `${worst.path} = ${worst.value}`)
            .toBeLessThanOrEqual(GEOMETRY_PRECISION_DECIMALS);
    });

    // Math.round(v * 100) overflows to Infinity above ~1.798e306, and
    // JSON.stringify writes a non-finite number as `null` — a value nothing on
    // the load path re-validates. Unreachable from any real generator, but
    // rounding must not be the step that makes a coordinate unrepresentable.
    it('leaves a coordinate too large to scale untouched', () => {
        const huge = 1.5e308;
        const edge = makeEdge({ start: { x: huge, y: -huge } });

        const [piece] = quantizePieceGeometry([makePiece({ edges: [edge] })]);

        expect(piece.edges[0].start).toEqual({ x: huge, y: -huge });
    });

    // Characterization, not coverage of the guard above: `Math.round(NaN * 100)
    // / 100` is already `NaN`, so this passes with the guard deleted. What it
    // pins is that the pass rounds coordinates rather than policing them — a
    // non-finite input survives, and the finite coordinate beside it is still
    // rounded normally.
    it('passes non-finite coordinates through unchanged', () => {
        const edge = makeEdge({
            start: { x: NaN, y: Infinity },
            end: { x: -Infinity, y: 20.345678 },
        });

        const [piece] = quantizePieceGeometry([makePiece({ edges: [edge] })]);

        expect(piece.edges[0].start.x).toBeNaN();
        expect(piece.edges[0].start.y).toBe(Infinity);
        expect(piece.edges[0].end.x).toBe(-Infinity);
        expect(piece.edges[0].end.y).toBe(20.35);
    });
});
