import { describe, it, expect } from 'vitest';
import { decimals, worstPrecision } from './precision.js';

/**
 * These helpers *define* the geometry-precision invariant (#487), so they're
 * unit-tested, not only through their two consumers — neither of which reaches
 * `decimals`'s exponential branch (both quantize near-zero values to 0 first),
 * the blindness that let it ship broken.
 */
describe('decimals', () => {
    it('counts the digits after the decimal point', () => {
        expect(decimals(1.23)).toBe(2);
        expect(decimals(-1.5)).toBe(1);
        // 0.30000000000000004 — the float residue the invariant exists to catch.
        expect(decimals(0.1 + 0.2)).toBe(17);
    });

    it('reports zero decimals for integers', () => {
        expect(decimals(0)).toBe(0);
        expect(decimals(-0)).toBe(0);
        expect(decimals(1000)).toBe(0);
    });

    // `String(1e-7)` is `"1e-7"`, which contains no `.` at all: splitting on
    // `.` alone reports 0 decimals for a number carrying 7 of them.
    it('expands negative exponents instead of reading them as zero decimals', () => {
        expect(decimals(1e-7)).toBe(7);
        expect(decimals(1.5e-7)).toBe(8);
        expect(decimals(1.234e-10)).toBe(13);
        expect(decimals(-2.5e-8)).toBe(9);
    });

    // The other end of the exponential range: `String(1e21)` is `"1e+21"`, so
    // the expansion must not report a *negative* decimal count.
    it('reports zero decimals for large exponents', () => {
        expect(decimals(1e21)).toBe(0);
        expect(decimals(1.5e21)).toBe(0);
    });

    // Non-finite values read as 0 decimals and sail through the invariant.
    // Pinned so nobody mistakes the precision check for a finiteness check —
    // quantizePieceGeometry passes non-finite inputs through by design.
    it('reports zero decimals for non-finite values', () => {
        expect(decimals(NaN)).toBe(0);
        expect(decimals(Infinity)).toBe(0);
        expect(decimals(-Infinity)).toBe(0);
    });
});

describe('worstPrecision', () => {
    it('reports the finest number along with its property path', () => {
        const root = {
            edges: [{ start: { x: 1.5, y: 2.25 } }, { start: { x: 3.125, y: 4 } }],
        };

        expect(worstPrecision(root)).toEqual({
            path: '.edges[1].start.x',
            value: 3.125,
            decimals: 3,
        });
    });

    it('walks nested arrays', () => {
        expect(worstPrecision([[{ curvePoints: [{ x: 0.1234 }] }]])).toEqual({
            path: '[0][0].curvePoints[0].x',
            value: 0.1234,
            decimals: 4,
        });
    });

    it('skips strings, so a formatted path is not read as a coordinate', () => {
        const worst = worstPrecision({ shape: 'M 0.123456 0', x: 0.5 });

        expect(worst).toEqual({ path: '.x', value: 0.5, decimals: 1 });
    });

    it('traverses past null and undefined', () => {
        const worst = worstPrecision({ a: null, b: undefined, c: { d: 0.125 } });

        expect(worst).toEqual({ path: '.c.d', value: 0.125, decimals: 3 });
    });

    it('returns a zero sample when nothing carries decimals', () => {
        expect(worstPrecision({ shape: 'M 0 0', id: 7 })).toEqual({
            path: '',
            value: 0,
            decimals: 0,
        });
    });

    // A Map's contents are invisible to Object.entries, so walking one would
    // report 0 decimals and pass vacuously — and the obvious next target,
    // state.groups, holds a Map (PieceGroup.pieces).
    it('throws rather than passing vacuously on a Map or Set', () => {
        expect(() => worstPrecision({ pieces: new Map([[1, { x: 0.125 }]]) }))
            .toThrow(/Map \(at `\.pieces`\)/);
        expect(() => worstPrecision(new Set([0.125]))).toThrow(/Set \(at `the root`\)/);
    });
});
