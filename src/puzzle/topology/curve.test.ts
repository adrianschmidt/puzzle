import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import type { Point } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function approxPoint(p: Point, x: number, y: number, _tolerance = 0.5) {
    expect(p.x).toBeCloseTo(x, 0);
    expect(p.y).toBeCloseTo(y, 0);
}

function expectClose(a: number, b: number, tolerance = 0.01) {
    expect(Math.abs(a - b)).toBeLessThan(tolerance);
}

// ---------------------------------------------------------------------------
// Curve.line
// ---------------------------------------------------------------------------

describe('Curve.line', () => {
    it('creates a single-segment curve', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expect(c.segments).toHaveLength(1);
    });

    it('starts and ends at the given points', () => {
        const c = Curve.line({ x: 3, y: 5 }, { x: 13, y: 25 });
        expect(c.start).toEqual({ x: 3, y: 5 });
        expect(c.end).toEqual({ x: 13, y: 25 });
    });

    it('evaluates midpoint correctly', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 20 });
        const mid = c.pointAt(0.5);
        approxPoint(mid, 5, 10);
    });

    it('evaluates start and end exactly', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        approxPoint(c.pointAt(0), 0, 0);
        approxPoint(c.pointAt(1), 100, 0);
    });
});

// ---------------------------------------------------------------------------
// Curve.fromPolyline
// ---------------------------------------------------------------------------

describe('Curve.fromPolyline', () => {
    it('creates segments from points', () => {
        const c = Curve.fromPolyline([
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 0 },
        ]);
        expect(c.segments).toHaveLength(2);
    });

    it('preserves start and end', () => {
        const c = Curve.fromPolyline([
            { x: 1, y: 2 },
            { x: 3, y: 4 },
            { x: 5, y: 6 },
        ]);
        expect(c.start).toEqual({ x: 1, y: 2 });
        expect(c.end).toEqual({ x: 5, y: 6 });
    });

    it('throws for fewer than 2 points', () => {
        expect(() => Curve.fromPolyline([{ x: 0, y: 0 }])).toThrow();
    });

    it('evaluates points along the polyline', () => {
        const c = Curve.fromPolyline([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
        ]);
        // t=0.25 is midpoint of first segment
        approxPoint(c.pointAt(0.25), 5, 0);
        // t=0.5 is the junction between segments
        approxPoint(c.pointAt(0.5), 10, 0);
        // t=0.75 is midpoint of second segment
        approxPoint(c.pointAt(0.75), 15, 0);
    });
});

// ---------------------------------------------------------------------------
// Curve.fromBezierPath
// ---------------------------------------------------------------------------

describe('Curve.fromBezierPath', () => {
    it('creates segments from flat point array', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 1, y: 2 },
            { x: 3, y: 2 },
            { x: 4, y: 0 },
        ]);
        expect(c.segments).toHaveLength(1);
        expect(c.start).toEqual({ x: 0, y: 0 });
        expect(c.end).toEqual({ x: 4, y: 0 });
    });

    it('handles multi-segment paths', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 0 },
            { x: 4, y: -1 }, { x: 5, y: -1 }, { x: 6, y: 0 },
        ]);
        expect(c.segments).toHaveLength(2);
    });

    it('throws for invalid point count', () => {
        expect(() => Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 1, y: 1 },
        ])).toThrow('Invalid Bézier path');
    });
});

// ---------------------------------------------------------------------------
// pointAt
// ---------------------------------------------------------------------------

describe('pointAt', () => {
    it('clamps t below 0', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        approxPoint(c.pointAt(-0.5), 0, 0);
    });

    it('clamps t above 1', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        approxPoint(c.pointAt(1.5), 10, 0);
    });

    it('evaluates a cubic Bézier segment correctly', () => {
        // Semicircle-ish curve: starts at (0,0), bulges up, ends at (10,0)
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 5 },
            { x: 10, y: 5 },
            { x: 10, y: 0 },
        ]);
        const mid = c.pointAt(0.5);
        // Midpoint should be above the x-axis
        expect(mid.y).toBeGreaterThan(3);
        expect(mid.x).toBeCloseTo(5, 0);
    });
});

// ---------------------------------------------------------------------------
// tangentAt
// ---------------------------------------------------------------------------

describe('tangentAt', () => {
    it('returns horizontal tangent for horizontal line', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const t = c.tangentAt(0.5);
        expectClose(t.x, 1);
        expectClose(t.y, 0);
    });

    it('returns unit vector', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 10 });
        const t = c.tangentAt(0.3);
        const len = Math.sqrt(t.x * t.x + t.y * t.y);
        expectClose(len, 1);
    });

    it('returns correct direction for a diagonal line', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 10 });
        const t = c.tangentAt(0.5);
        expectClose(t.x, Math.SQRT1_2, 0.01);
        expectClose(t.y, Math.SQRT1_2, 0.01);
    });

    it('varies along a curved segment', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
        ]);
        const tStart = c.tangentAt(0);
        const tEnd = c.tangentAt(1);
        // At start, tangent should point upward (toward cp1)
        expect(tStart.y).toBeGreaterThan(0.5);
        // At end, tangent should point downward (from cp2 to end)
        expect(tEnd.y).toBeLessThan(-0.5);
    });
});

// ---------------------------------------------------------------------------
// splitAt
// ---------------------------------------------------------------------------

describe('splitAt', () => {
    it('splits a line at midpoint', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const [left, right] = c.splitAt(0.5);

        approxPoint(left.start, 0, 0);
        approxPoint(left.end, 5, 0);
        approxPoint(right.start, 5, 0);
        approxPoint(right.end, 10, 0);
    });

    it('preserves endpoints when splitting at t=0', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const [, right] = c.splitAt(0);
        approxPoint(right.start, 0, 0);
        approxPoint(right.end, 10, 0);
    });

    it('preserves endpoints when splitting at t=1', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const [left] = c.splitAt(1);
        approxPoint(left.start, 0, 0);
        approxPoint(left.end, 10, 0);
    });

    it('splits a multi-segment curve correctly', () => {
        const c = Curve.fromPolyline([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
        ]);
        // t=0.5 is the junction between the two segments
        const [left, right] = c.splitAt(0.5);
        approxPoint(left.start, 0, 0);
        approxPoint(left.end, 10, 0);
        approxPoint(right.start, 10, 0);
        approxPoint(right.end, 20, 0);
    });

    it('splits within a segment of a multi-segment curve', () => {
        const c = Curve.fromPolyline([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
        ]);
        // t=0.25 is midpoint of first segment
        const [left, right] = c.splitAt(0.25);
        approxPoint(left.end, 5, 0);
        approxPoint(right.start, 5, 0);
        approxPoint(right.end, 20, 0);
        expect(right.segments).toHaveLength(2); // rest of seg1 + all of seg2
    });
});

// ---------------------------------------------------------------------------
// toPolyline
// ---------------------------------------------------------------------------

describe('toPolyline', () => {
    it('returns correct number of points', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const pts = c.toPolyline(8);
        // 1 segment × 8 points + 1 start point = 9
        expect(pts).toHaveLength(9);
    });

    it('starts and ends at curve endpoints', () => {
        const c = Curve.line({ x: 3, y: 7 }, { x: 13, y: 17 });
        const pts = c.toPolyline(4);
        expect(pts[0]).toEqual({ x: 3, y: 7 });
        approxPoint(pts[pts.length - 1], 13, 17);
    });

    it('multi-segment curve returns correct point count', () => {
        const c = Curve.fromPolyline([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
        ]);
        const pts = c.toPolyline(4);
        // 2 segments × 4 points + 1 start = 9
        expect(pts).toHaveLength(9);
    });
});

// ---------------------------------------------------------------------------
// arcLength
// ---------------------------------------------------------------------------

describe('arcLength', () => {
    it('computes correct length for a straight line', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expectClose(c.arcLength(), 10, 0.1);
    });

    it('computes correct length for a diagonal', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 3, y: 4 });
        expectClose(c.arcLength(), 5, 0.1);
    });

    it('curved path is longer than straight distance', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
        ]);
        const straight = 10; // direct distance start→end
        expect(c.arcLength()).toBeGreaterThan(straight);
    });
});

// ---------------------------------------------------------------------------
// reverse
// ---------------------------------------------------------------------------

describe('reverse', () => {
    it('swaps start and end for a line', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 5 });
        const r = c.reverse();
        expect(r.start).toEqual({ x: 10, y: 5 });
        expect(r.end).toEqual({ x: 0, y: 0 });
    });

    it('preserves shape (reversed pointAt matches)', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
        ]);
        const r = c.reverse();
        // pointAt(0.3) on original ≈ pointAt(0.7) on reversed
        const p1 = c.pointAt(0.3);
        const p2 = r.pointAt(0.7);
        approxPoint(p2, p1.x, p1.y, 0.1);
    });

    it('double-reverse returns to original', () => {
        const c = Curve.line({ x: 5, y: 10 }, { x: 15, y: 20 });
        const rr = c.reverse().reverse();
        expect(rr.start).toEqual(c.start);
        expect(rr.end).toEqual(c.end);
    });

    it('reverses a multi-segment curve', () => {
        const c = Curve.fromPolyline([
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 10, y: 0 },
        ]);
        const r = c.reverse();
        expect(r.start).toEqual({ x: 10, y: 0 });
        expect(r.end).toEqual({ x: 0, y: 0 });
        expect(r.segments).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// intersect
// ---------------------------------------------------------------------------

describe('intersect', () => {
    it('finds intersection of two crossing lines', () => {
        const h = Curve.line({ x: 0, y: 5 }, { x: 10, y: 5 });
        const v = Curve.line({ x: 5, y: 0 }, { x: 5, y: 10 });
        const ix = h.intersect(v);
        expect(ix).toHaveLength(1);
        approxPoint(ix[0].point, 5, 5);
        expectClose(ix[0].tSelf, 0.5, 0.05);
        expectClose(ix[0].tOther, 0.5, 0.05);
    });

    it('finds no intersection for parallel lines', () => {
        const a = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const b = Curve.line({ x: 0, y: 5 }, { x: 10, y: 5 });
        expect(a.intersect(b)).toHaveLength(0);
    });

    it('finds no intersection for non-overlapping segments', () => {
        const a = Curve.line({ x: 0, y: 0 }, { x: 5, y: 0 });
        const b = Curve.line({ x: 6, y: -5 }, { x: 6, y: 5 });
        expect(a.intersect(b)).toHaveLength(0);
    });

    it('finds intersection of a line and a curve', () => {
        // Horizontal line at y=3
        const h = Curve.line({ x: 0, y: 3 }, { x: 10, y: 3 });
        // Curve that arcs from (5,0) up to (5,6) and back
        const arc = Curve.fromBezierPath([
            { x: 5, y: 0 },
            { x: 5, y: 4 },
            { x: 5, y: 8 },
            { x: 5, y: 12 },
        ]);
        const ix = h.intersect(arc);
        expect(ix.length).toBeGreaterThanOrEqual(1);
        // All intersections should be near y=3
        for (const i of ix) {
            expect(i.point.y).toBeCloseTo(3, 0);
        }
    });

    it('finds multiple intersections with a sine-like polyline', () => {
        // Horizontal line at y=0
        const h = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        // Sine wave crossing y=0 multiple times
        const pts: Point[] = [];
        for (let i = 0; i <= 40; i++) {
            const x = (i / 40) * 100;
            const y = 10 * Math.sin((i / 40) * 2 * Math.PI * 2);
            pts.push({ x, y });
        }
        const sine = Curve.fromPolyline(pts);
        const ix = h.intersect(sine);
        // 2 full sine waves crossing y=0 → ~4 crossings (excluding endpoints)
        expect(ix.length).toBeGreaterThanOrEqual(3);
    });

    it('deduplicates nearby intersections', () => {
        const a = Curve.line({ x: 0, y: 5 }, { x: 10, y: 5 });
        const b = Curve.line({ x: 5, y: 0 }, { x: 5, y: 10 });
        const ix = a.intersect(b);
        // Should be exactly 1, not duplicated
        expect(ix).toHaveLength(1);
    });
});
