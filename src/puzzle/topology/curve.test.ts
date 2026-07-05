import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import type { Point } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approxPoint(p: Point, x: number, y: number) {
    expect(p.x).toBeCloseTo(x, 0);
    expect(p.y).toBeCloseTo(y, 0);
}

function expectClose(a: number, b: number, tolerance = 0.01) {
    expect(Math.abs(a - b)).toBeLessThan(tolerance);
}

/** Create a multi-segment Bézier curve (two linear segments for testing). */
function twoSegmentLine(x0: number, xMid: number, xEnd: number): Curve {
    return Curve.fromBezierPath([
        { x: x0, y: 0 },
        { x: x0 + (xMid - x0) / 3, y: 0 },
        { x: x0 + 2 * (xMid - x0) / 3, y: 0 },
        { x: xMid, y: 0 },
        { x: xMid + (xEnd - xMid) / 3, y: 0 },
        { x: xMid + 2 * (xEnd - xMid) / 3, y: 0 },
        { x: xEnd, y: 0 },
    ]);
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
// Multi-segment curves
// ---------------------------------------------------------------------------

describe('multi-segment curves', () => {
    it('creates segments from Bézier path', () => {
        const c = twoSegmentLine(0, 10, 20);
        expect(c.segments).toHaveLength(2);
    });

    it('preserves start and end', () => {
        const c = twoSegmentLine(1, 5, 9);
        approxPoint(c.start, 1, 0);
        approxPoint(c.end, 9, 0);
    });

    it('evaluates points along the curve', () => {
        const c = twoSegmentLine(0, 10, 20);
        approxPoint(c.pointAt(0.25), 5, 0);
        approxPoint(c.pointAt(0.5), 10, 0);
        approxPoint(c.pointAt(0.75), 15, 0);
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
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 5 },
            { x: 10, y: 5 },
            { x: 10, y: 0 },
        ]);
        const mid = c.pointAt(0.5);
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
        expect(tStart.y).toBeGreaterThan(0.5);
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
        const c = twoSegmentLine(0, 10, 20);
        const [left, right] = c.splitAt(0.5);
        approxPoint(left.start, 0, 0);
        approxPoint(left.end, 10, 0);
        approxPoint(right.start, 10, 0);
        approxPoint(right.end, 20, 0);
    });

    it('splits within a segment of a multi-segment curve', () => {
        const c = twoSegmentLine(0, 10, 20);
        const [left, right] = c.splitAt(0.25);
        approxPoint(left.end, 5, 0);
        approxPoint(right.start, 5, 0);
        approxPoint(right.end, 20, 0);
        expect(right.segments).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// sample
// ---------------------------------------------------------------------------

describe('sample', () => {
    it('returns correct number of points', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const pts = c.sample(8);
        // 1 segment × 8 points + 1 start point = 9
        expect(pts).toHaveLength(9);
    });

    it('starts and ends at curve endpoints', () => {
        const c = Curve.line({ x: 3, y: 7 }, { x: 13, y: 17 });
        const pts = c.sample(4);
        expect(pts[0]).toEqual({ x: 3, y: 7 });
        approxPoint(pts[pts.length - 1], 13, 17);
    });

    it('multi-segment curve returns correct point count', () => {
        const c = twoSegmentLine(0, 10, 20);
        const pts = c.sample(4);
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
        expect(c.arcLength()).toBeGreaterThan(10);
    });
});

// ---------------------------------------------------------------------------
// nearestT
// ---------------------------------------------------------------------------

describe('nearestT', () => {
    it('finds t=0 for start point', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        expectClose(c.nearestT({ x: 0, y: 0 }), 0, 0.01);
    });

    it('finds t=1 for end point', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        expectClose(c.nearestT({ x: 100, y: 0 }), 1, 0.01);
    });

    it('finds t≈0.5 for midpoint', () => {
        const c = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        expectClose(c.nearestT({ x: 50, y: 0 }), 0.5, 0.01);
    });

    it('works for curved segments', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
        ]);
        const p = c.pointAt(0.3);
        expectClose(c.nearestT(p), 0.3, 0.01);
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
        const p1 = c.pointAt(0.3);
        const p2 = r.pointAt(0.7);
        approxPoint(p2, p1.x, p1.y);
    });

    it('double-reverse returns to original', () => {
        const c = Curve.line({ x: 5, y: 10 }, { x: 15, y: 20 });
        const rr = c.reverse().reverse();
        expect(rr.start).toEqual(c.start);
        expect(rr.end).toEqual(c.end);
    });

    it('reverses a multi-segment curve', () => {
        const c = twoSegmentLine(0, 5, 10);
        const r = c.reverse();
        approxPoint(r.start, 10, 0);
        approxPoint(r.end, 0, 0);
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

    it('finds intersection of a line and a Bézier curve', () => {
        const h = Curve.line({ x: 0, y: 3 }, { x: 10, y: 3 });
        const arc = Curve.fromBezierPath([
            { x: 5, y: 0 },
            { x: 5, y: 4 },
            { x: 5, y: 8 },
            { x: 5, y: 12 },
        ]);
        const ix = h.intersect(arc);
        expect(ix.length).toBeGreaterThanOrEqual(1);
        for (const i of ix) {
            expect(i.point.y).toBeCloseTo(3, 0);
        }
    });

    it('finds multiple intersections between a line and a multi-segment curve', () => {
        const h = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        // S-curve that crosses y=0 multiple times
        const sCurve = Curve.fromBezierPath([
            { x: 0, y: -10 },
            { x: 15, y: 20 }, { x: 35, y: 20 }, { x: 50, y: -10 },
            { x: 65, y: -40 }, { x: 85, y: 20 }, { x: 100, y: 10 },
        ]);
        const ix = h.intersect(sCurve);
        expect(ix.length).toBeGreaterThanOrEqual(2);
    });

    it('deduplicates nearby intersections', () => {
        const a = Curve.line({ x: 0, y: 5 }, { x: 10, y: 5 });
        const b = Curve.line({ x: 5, y: 0 }, { x: 5, y: 10 });
        const ix = a.intersect(b);
        expect(ix).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Curve.circle
// ---------------------------------------------------------------------------

describe('Curve.circle', () => {
    it('produces a closed curve through the four cardinal points', () => {
        const c = Curve.circle({ x: 100, y: 100 }, 50);
        expect(c.segments).toHaveLength(4);
        // start should be on the rightmost cardinal point
        expect(c.start.x).toBeCloseTo(150);
        expect(c.start.y).toBeCloseTo(100);
        // end equals start (closed)
        expect(c.end.x).toBeCloseTo(c.start.x, 6);
        expect(c.end.y).toBeCloseTo(c.start.y, 6);
    });

    it('approximates radius accurately at midpoints of each arc', () => {
        const c = Curve.circle({ x: 0, y: 0 }, 100);
        // Sample heavily and check distance from center
        const samples = c.sample(20);
        for (const p of samples) {
            const r = Math.hypot(p.x, p.y);
            expect(r).toBeCloseTo(100, 0); // 4-segment kappa fit is ~0.0005 off
        }
    });
});

describe('Curve.boundingBox', () => {
    it('covers all control points (superset of the drawn curve)', () => {
        // A single cubic whose control points bulge above the chord.
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 10, y: -50 },
            { x: 90, y: -50 },
            { x: 100, y: 0 },
        ]);
        const box = c.boundingBox();
        expect(box.minX).toBeCloseTo(0);
        expect(box.maxX).toBeCloseTo(100);
        expect(box.minY).toBeCloseTo(-50);
        expect(box.maxY).toBeCloseTo(0);

        // The box must contain every point actually on the curve.
        for (const p of c.sample(16)) {
            expect(p.x).toBeGreaterThanOrEqual(box.minX - 1e-9);
            expect(p.x).toBeLessThanOrEqual(box.maxX + 1e-9);
            expect(p.y).toBeGreaterThanOrEqual(box.minY - 1e-9);
            expect(p.y).toBeLessThanOrEqual(box.maxY + 1e-9);
        }
    });

    it('unions across multiple segments', () => {
        const c = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 },
            { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 50, y: 30 },
        ]);
        const box = c.boundingBox();
        expect(box.minX).toBeCloseTo(0);
        expect(box.maxX).toBeCloseTo(50);
        expect(box.minY).toBeCloseTo(0);
        expect(box.maxY).toBeCloseTo(30);
    });
});

// ---------------------------------------------------------------------------
// suppressTabs propagation
// ---------------------------------------------------------------------------

describe('suppressTabs propagation', () => {
    it('defaults to false and is set via options', () => {
        expect(Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 }).suppressTabs).toBe(false);
        const c = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 }, { suppressTabs: true });
        expect(c.suppressTabs).toBe(true);
    });

    it('survives splitAt, splitAtSegmentLocal, and reverse', () => {
        const c = Curve.circle({ x: 0, y: 0 }, 10);
        const flagged = new Curve([...c.segments], { suppressTabs: true });
        const [a, b] = flagged.splitAt(0.5);
        expect(a.suppressTabs).toBe(true);
        expect(b.suppressTabs).toBe(true);
        const [d, e] = flagged.splitAtSegmentLocal(1, 0.5);
        expect(d.suppressTabs).toBe(true);
        expect(e.suppressTabs).toBe(true);
        expect(flagged.reverse().suppressTabs).toBe(true);
    });
});
