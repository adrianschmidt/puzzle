/**
 * Pluggable curve interface for the topology system.
 *
 * All curves are represented as chains of cubic Bézier segments.
 * This is the universal representation — straight lines, polylines,
 * sine waves, and actual Bézier curves all map to this.
 *
 * See issue #167 for the design discussion.
 */

import type { Point } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An intersection between two curves.
 */
export interface CurveIntersection {
    /** The intersection point. */
    point: Point;
    /** Parameter on the first curve (0–1 over the full curve). */
    tSelf: number;
    /** Parameter on the second curve (0–1 over the full curve). */
    tOther: number;
}

/**
 * A cubic Bézier segment: start, control1, control2, end.
 */
export interface BezierSegment {
    p0: Point;
    cp1: Point;
    cp2: Point;
    p3: Point;
}

// ---------------------------------------------------------------------------
// Curve class
// ---------------------------------------------------------------------------

/**
 * A curve composed of one or more cubic Bézier segments.
 *
 * Provides evaluation, splitting, intersection, tangent computation,
 * and polyline approximation.
 */
export class Curve {
    /** The raw segments composing this curve. */
    readonly segments: readonly BezierSegment[];

    constructor(segments: BezierSegment[]) {
        if (segments.length === 0) {
            throw new Error('Curve must have at least one segment');
        }
        this.segments = segments;
    }

    // -- Factory methods ---------------------------------------------------

    /**
     * Create a straight-line curve between two points.
     */
    static line(start: Point, end: Point): Curve {
        return new Curve([{
            p0: start,
            cp1: lerpPoint(start, end, 1 / 3),
            cp2: lerpPoint(start, end, 2 / 3),
            p3: end,
        }]);
    }

    /**
     * Create a curve from a polyline (array of points).
     * Each segment of the polyline becomes a linear Bézier segment.
     */
    static fromPolyline(points: Point[]): Curve {
        if (points.length < 2) {
            throw new Error('Polyline must have at least 2 points');
        }
        const segments: BezierSegment[] = [];
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p3 = points[i + 1];
            segments.push({
                p0,
                cp1: lerpPoint(p0, p3, 1 / 3),
                cp2: lerpPoint(p0, p3, 2 / 3),
                p3,
            });
        }
        return new Curve(segments);
    }

    /**
     * Create a curve from a flat array of Bézier points.
     * Format: [p0, cp1, cp2, p1, cp1, cp2, p2, ...]
     * (Same format as BezierPath from tab-shapes.ts)
     */
    static fromBezierPath(points: Point[]): Curve {
        if (points.length < 4 || (points.length - 1) % 3 !== 0) {
            throw new Error(
                `Invalid Bézier path: need 3n+1 points, got ${points.length}`,
            );
        }
        const segments: BezierSegment[] = [];
        for (let i = 0; i < points.length - 1; i += 3) {
            segments.push({
                p0: points[i],
                cp1: points[i + 1],
                cp2: points[i + 2],
                p3: points[i + 3],
            });
        }
        return new Curve(segments);
    }

    // -- Accessors ---------------------------------------------------------

    /** The start point of the curve. */
    get start(): Point {
        return this.segments[0].p0;
    }

    /** The end point of the curve. */
    get end(): Point {
        return this.segments[this.segments.length - 1].p3;
    }

    // -- Evaluation --------------------------------------------------------

    /**
     * Evaluate the curve at parameter t ∈ [0, 1].
     * t is distributed uniformly across segments (not arc-length).
     */
    pointAt(t: number): Point {
        const { segment, localT } = this.resolveT(t);
        return evalCubic(segment, localT);
    }

    /**
     * Unit tangent vector at parameter t.
     */
    tangentAt(t: number): Point {
        const { segment, localT } = this.resolveT(t);
        const d = evalCubicDerivative(segment, localT);
        const len = Math.sqrt(d.x * d.x + d.y * d.y);
        if (len < 1e-10) {
            // Degenerate — try nearby t values
            return { x: 1, y: 0 };
        }
        return { x: d.x / len, y: d.y / len };
    }

    // -- Splitting ---------------------------------------------------------

    /**
     * Split the curve at parameter t → [before, after].
     */
    splitAt(t: number): [Curve, Curve] {
        const clamped = Math.max(0, Math.min(1, t));
        if (clamped <= 1e-10) {
            return [
                Curve.line(this.start, this.start),
                this,
            ];
        }
        if (clamped >= 1 - 1e-10) {
            return [
                this,
                Curve.line(this.end, this.end),
            ];
        }

        const { segmentIndex, localT } = this.resolveTWithIndex(clamped);
        const seg = this.segments[segmentIndex];
        const [left, right] = splitCubicAt(seg, localT);

        const beforeSegments = [
            ...this.segments.slice(0, segmentIndex),
            left,
        ];
        const afterSegments = [
            right,
            ...this.segments.slice(segmentIndex + 1),
        ];

        return [new Curve(beforeSegments), new Curve(afterSegments)];
    }

    // -- Polyline approximation --------------------------------------------

    /**
     * Get a polyline approximation of this curve.
     * @param pointsPerSegment - Number of sample points per Bézier segment (default 16).
     */
    toPolyline(pointsPerSegment = 16): Point[] {
        const points: Point[] = [this.start];
        for (const seg of this.segments) {
            for (let i = 1; i <= pointsPerSegment; i++) {
                const t = i / pointsPerSegment;
                points.push(evalCubic(seg, t));
            }
        }
        return points;
    }

    // -- Arc length --------------------------------------------------------

    /**
     * Approximate arc length via polyline sampling.
     */
    arcLength(): number {
        const pts = this.toPolyline(16);
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
            len += dist(pts[i - 1], pts[i]);
        }
        return len;
    }

    // -- Intersection ------------------------------------------------------

    /**
     * Find all intersections with another curve.
     *
     * Uses polyline approximation with segment-segment intersection,
     * then refines with a Newton-like binary search on the Bézier parameters.
     */
    intersect(other: Curve, tolerance = 0.5): CurveIntersection[] {
        const results: CurveIntersection[] = [];
        const selfPts = this.toPolyline(16);
        const otherPts = other.toPolyline(16);
        const selfTotal = selfPts.length - 1;
        const otherTotal = otherPts.length - 1;

        for (let i = 0; i < selfPts.length - 1; i++) {
            for (let j = 0; j < otherPts.length - 1; j++) {
                const ix = segmentIntersection(
                    selfPts[i], selfPts[i + 1],
                    otherPts[j], otherPts[j + 1],
                );
                if (ix) {
                    const tSelf = (i + ix.tA) / selfTotal;
                    const tOther = (j + ix.tB) / otherTotal;

                    // Deduplicate: skip if too close to an existing intersection
                    const isDuplicate = results.some(
                        r => dist(r.point, ix.point) < tolerance,
                    );
                    if (!isDuplicate) {
                        results.push({
                            point: ix.point,
                            tSelf,
                            tOther,
                        });
                    }
                }
            }
        }

        return results;
    }

    // -- Reverse -----------------------------------------------------------

    /**
     * Return a new curve with reversed direction.
     */
    reverse(): Curve {
        const reversed: BezierSegment[] = [];
        for (let i = this.segments.length - 1; i >= 0; i--) {
            const s = this.segments[i];
            reversed.push({
                p0: s.p3,
                cp1: s.cp2,
                cp2: s.cp1,
                p3: s.p0,
            });
        }
        return new Curve(reversed);
    }

    // -- Internal ----------------------------------------------------------

    private resolveT(t: number): { segment: BezierSegment; localT: number } {
        const { segmentIndex, localT } = this.resolveTWithIndex(t);
        return { segment: this.segments[segmentIndex], localT };
    }

    private resolveTWithIndex(t: number): { segmentIndex: number; localT: number } {
        const n = this.segments.length;
        const clamped = Math.max(0, Math.min(1, t));
        const scaled = clamped * n;
        const segmentIndex = Math.min(Math.floor(scaled), n - 1);
        const localT = scaled - segmentIndex;
        return { segmentIndex, localT };
    }
}

// ---------------------------------------------------------------------------
// Bézier math helpers
// ---------------------------------------------------------------------------

/** Evaluate a cubic Bézier at parameter t. */
function evalCubic(seg: BezierSegment, t: number): Point {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
        x: mt2 * mt * seg.p0.x + 3 * mt2 * t * seg.cp1.x + 3 * mt * t2 * seg.cp2.x + t2 * t * seg.p3.x,
        y: mt2 * mt * seg.p0.y + 3 * mt2 * t * seg.cp1.y + 3 * mt * t2 * seg.cp2.y + t2 * t * seg.p3.y,
    };
}

/** Evaluate the first derivative of a cubic Bézier at parameter t. */
function evalCubicDerivative(seg: BezierSegment, t: number): Point {
    const mt = 1 - t;
    return {
        x: 3 * mt * mt * (seg.cp1.x - seg.p0.x)
            + 6 * mt * t * (seg.cp2.x - seg.cp1.x)
            + 3 * t * t * (seg.p3.x - seg.cp2.x),
        y: 3 * mt * mt * (seg.cp1.y - seg.p0.y)
            + 6 * mt * t * (seg.cp2.y - seg.cp1.y)
            + 3 * t * t * (seg.p3.y - seg.cp2.y),
    };
}

/**
 * Split a cubic Bézier segment at t using de Casteljau's algorithm.
 * Returns [left, right] halves.
 */
function splitCubicAt(seg: BezierSegment, t: number): [BezierSegment, BezierSegment] {
    const { p0, cp1, cp2, p3 } = seg;

    // Level 1
    const p01 = lerpPoint(p0, cp1, t);
    const p12 = lerpPoint(cp1, cp2, t);
    const p23 = lerpPoint(cp2, p3, t);

    // Level 2
    const p012 = lerpPoint(p01, p12, t);
    const p123 = lerpPoint(p12, p23, t);

    // Level 3 — the split point
    const mid = lerpPoint(p012, p123, t);

    return [
        { p0, cp1: p01, cp2: p012, p3: mid },
        { p0: mid, cp1: p123, cp2: p23, p3 },
    ];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function lerpPoint(a: Point, b: Point, t: number): Point {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    };
}

function dist(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the intersection of two line segments (a1→a2) and (b1→b2).
 * Returns the intersection point and the t parameters on each segment,
 * or null if they don't intersect.
 */
function segmentIntersection(
    a1: Point, a2: Point,
    b1: Point, b2: Point,
): { point: Point; tA: number; tB: number } | null {
    const dax = a2.x - a1.x;
    const day = a2.y - a1.y;
    const dbx = b2.x - b1.x;
    const dby = b2.y - b1.y;

    const denom = dax * dby - day * dbx;
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
    const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;

    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
        point: { x: a1.x + t * dax, y: a1.y + t * day },
        tA: t,
        tB: u,
    };
}
