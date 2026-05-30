/**
 * Pluggable curve interface for the topology system.
 *
 * All curves are represented as chains of cubic Bézier segments,
 * backed by bezier-js for precise intersection, projection, and
 * arc-length computation.
 *
 * See issue #167 for the design discussion.
 */

import type { Point } from '../../model/types.js';
import { Bezier } from 'bezier-js';

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
    /** Segment index on the first curve. */
    segSelf: number;
    /** Local t within segSelf. */
    tLocalSelf: number;
    /** Segment index on the second curve. */
    segOther: number;
    /** Local t within segOther. */
    tLocalOther: number;
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

/** Axis-aligned bounding box in screen coordinates. */
export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

// ---------------------------------------------------------------------------
// Curve class
// ---------------------------------------------------------------------------

/**
 * A curve composed of one or more cubic Bézier segments.
 *
 * Provides evaluation, splitting, intersection, tangent computation,
 * and arc-length measurement — all using exact Bézier math via bezier-js.
 */
export class Curve {
    /** The raw segments composing this curve. */
    readonly segments: readonly BezierSegment[];

    /** Cached bezier-js instances (one per segment). */
    private _beziers?: Bezier[];

    constructor(segments: BezierSegment[]) {
        if (segments.length === 0) {
            throw new Error('Curve must have at least one segment');
        }
        this.segments = segments;
    }

    // -- bezier-js interop -------------------------------------------------

    /** Get bezier-js instances for each segment (lazily created). */
    private get beziers(): Bezier[] {
        if (!this._beziers) {
            this._beziers = this.segments.map(s => new Bezier(
                s.p0.x, s.p0.y,
                s.cp1.x, s.cp1.y,
                s.cp2.x, s.cp2.y,
                s.p3.x, s.p3.y,
            ));
        }
        return this._beziers;
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

    /**
     * Construct a circular curve as four cubic Bézier segments using
     * the standard kappa = 4*(sqrt(2)-1)/3 approximation.
     *
     * Starts at the rightmost point (centre + (radius, 0)) and goes CCW.
     */
    static circle(center: Point, radius: number): Curve {
        const k = 0.5522847498307933;  // 4*(sqrt(2)-1)/3
        const r = radius, kr = k * r;
        const cx = center.x, cy = center.y;
        const right  = { x: cx + r,  y: cy };
        const top    = { x: cx,      y: cy - r };
        const left   = { x: cx - r,  y: cy };
        const bottom = { x: cx,      y: cy + r };

        return Curve.fromBezierPath([
            right,
            { x: cx + r,  y: cy + kr }, { x: cx + kr, y: cy + r },  bottom,
            { x: cx - kr, y: cy + r  }, { x: cx - r,  y: cy + kr }, left,
            { x: cx - r,  y: cy - kr }, { x: cx - kr, y: cy - r  }, top,
            { x: cx + kr, y: cy - r  }, { x: cx + r,  y: cy - kr }, right,
        ]);
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
            return [Curve.line(this.start, this.start), this];
        }
        if (clamped >= 1 - 1e-10) {
            return [this, Curve.line(this.end, this.end)];
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

    /**
     * Split the curve at a specific segment index + local t.
     * No global t conversion — uses the exact segment and parameter.
     */
    splitAtSegmentLocal(segmentIndex: number, localT: number): [Curve, Curve] {
        if (localT <= 1e-10) {
            // Split at the start of this segment
            if (segmentIndex === 0) {
                return [Curve.line(this.start, this.start), this];
            }
            return [
                new Curve([...this.segments.slice(0, segmentIndex)]),
                new Curve([...this.segments.slice(segmentIndex)]),
            ];
        }
        if (localT >= 1 - 1e-10) {
            // Split at the end of this segment
            if (segmentIndex === this.segments.length - 1) {
                return [this, Curve.line(this.end, this.end)];
            }
            return [
                new Curve([...this.segments.slice(0, segmentIndex + 1)]),
                new Curve([...this.segments.slice(segmentIndex + 1)]),
            ];
        }

        const [left, right] = splitCubicAt(this.segments[segmentIndex], localT);
        return [
            new Curve([...this.segments.slice(0, segmentIndex), left]),
            new Curve([right, ...this.segments.slice(segmentIndex + 1)]),
        ];
    }

    // -- Arc length --------------------------------------------------------

    /**
     * Arc length computed via bezier-js (Legendre-Gauss quadrature).
     */
    arcLength(): number {
        return this.beziers.reduce((sum, b) => sum + b.length(), 0);
    }

    /**
     * Convert an arc-length fraction s ∈ [0, 1] to uniform parameter t.
     *
     * Finds the segment containing the target arc length, then uses
     * bisection within that segment to find the precise local t.
     * Returns global uniform t = (segIndex + localT) / N.
     */
    arcLengthToT(s: number): number {
        const clamped = Math.max(0, Math.min(1, s));
        if (clamped <= 1e-10) return 0;
        if (clamped >= 1 - 1e-10) return 1;

        const totalLen = this.arcLength();
        const targetLen = clamped * totalLen;

        const n = this.segments.length;
        let accumulated = 0;

        for (let i = 0; i < n; i++) {
            const segLen = this.beziers[i].length();
            if (accumulated + segLen >= targetLen - 1e-6) {
                // Target is within this segment
                const remaining = targetLen - accumulated;

                // Bisect for precise localT (bezier-js arc length
                // is nonlinear in t)
                let lo = 0, hi = 1;
                for (let iter = 0; iter < 20; iter++) {
                    const mid = (lo + hi) / 2;
                    const midLen = this.beziers[i].split(0, mid).length();
                    if (midLen < remaining) {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                const localT = (lo + hi) / 2;
                return (i + localT) / n;
            }
            accumulated += segLen;
        }

        return 1;
    }

    // -- Nearest point -----------------------------------------------------

    /**
     * Find the parameter t ∈ [0, 1] where this curve is closest to a point.
     * Uses bezier-js project() for each segment, picks the closest.
     */
    nearestT(point: Point): number {
        const n = this.segments.length;
        let bestT = 0;
        let bestDist = Infinity;

        for (let i = 0; i < n; i++) {
            const proj = this.beziers[i].project({ x: point.x, y: point.y });
            const d = dist(proj, point);
            if (d < bestDist) {
                bestDist = d;
                // Convert segment-local t to global t
                bestT = (i + proj.t!) / n;
            }
        }

        return bestT;
    }

    // -- Intersection ------------------------------------------------------

    /**
     * Find all intersections with another curve.
     *
     * Uses bezier-js curve-curve intersection for each segment pair.
     * Returns precise intersection points with accurate t-parameters.
     */
    intersect(other: Curve, tolerance = 0.5): CurveIntersection[] {
        const results: CurveIntersection[] = [];
        const selfN = this.segments.length;
        const otherN = other.segments.length;

        // Pre-compute bounding boxes for all segments to skip
        // non-overlapping pairs (avoids expensive bezier-js calls).
        const selfBoxes = this.segments.map(segmentBBox);
        const otherBoxes = other.segments.map(segmentBBox);

        for (let i = 0; i < selfN; i++) {
            for (let j = 0; j < otherN; j++) {
                // Skip pairs whose bounding boxes don't overlap
                if (!bboxOverlap(selfBoxes[i], otherBoxes[j], tolerance)) {
                    continue;
                }

                const segA = this.segments[i];
                const segB = other.segments[j];
                const aIsLinear = isLinearSegment(segA);
                const bIsLinear = isLinearSegment(segB);

                let pairs: Array<{ tA: number; tB: number; point: Point }>;

                if (aIsLinear && bIsLinear) {
                    // Line-line: use direct formula
                    pairs = lineLineIntersect(segA, segB);
                } else if (aIsLinear) {
                    // Line-curve: use bezier-js lineIntersects
                    const bz = other.beziers[j];
                    const line = { p1: segA.p0, p2: segA.p3 };
                    const ts = bz.lineIntersects(line);
                    pairs = ts.map(tB => {
                        const pt = evalCubic(segB, tB);
                        // Find tA on the line
                        const tA = projectOntoLine(segA.p0, segA.p3, pt);
                        return { tA, tB, point: pt };
                    }).filter(p => p.tA >= -0.001 && p.tA <= 1.001);
                } else if (bIsLinear) {
                    // Curve-line: use bezier-js lineIntersects
                    const bz = this.beziers[i];
                    const line = { p1: segB.p0, p2: segB.p3 };
                    const ts = bz.lineIntersects(line);
                    pairs = ts.map(tA => {
                        const pt = evalCubic(segA, tA);
                        const tB = projectOntoLine(segB.p0, segB.p3, pt);
                        return { tA, tB, point: pt };
                    }).filter(p => p.tB >= -0.001 && p.tB <= 1.001);
                } else {
                    // Curve-curve: use bezier-js intersects
                    const rawPairs = this.beziers[i].intersects(other.beziers[j]);
                    pairs = rawPairs.filter(p => typeof p === 'string').map(p => {
                        const [t1str, t2str] = (p as string).split('/');
                        const tA = parseFloat(t1str);
                        const tB = parseFloat(t2str);
                        return { tA, tB, point: evalCubic(segA, tA) };
                    });
                }

                for (const { tA, tB, point } of pairs) {
                    const clampedTA = Math.max(0, Math.min(1, tA));
                    const clampedTB = Math.max(0, Math.min(1, tB));
                    const tSelf = (i + clampedTA) / selfN;
                    const tOther = (j + clampedTB) / otherN;

                    const isDuplicate = results.some(
                        r => dist(r.point, point) < tolerance,
                    );
                    if (!isDuplicate) {
                        results.push({
                            point, tSelf, tOther,
                            segSelf: i, tLocalSelf: clampedTA,
                            segOther: j, tLocalOther: clampedTB,
                        });
                    }
                }
            }
        }

        return results;
    }

    // -- Sampling ----------------------------------------------------------

    /**
     * Sample the curve at regular intervals (e.g. for rendering or hit-testing).
     * @param pointsPerSegment - Number of sample points per segment (default 8).
     */
    sample(pointsPerSegment = 8): Point[] {
        const points: Point[] = [this.start];
        for (const seg of this.segments) {
            for (let i = 1; i <= pointsPerSegment; i++) {
                const t = i / pointsPerSegment;
                points.push(evalCubic(seg, t));
            }
        }
        return points;
    }

    /**
     * Axis-aligned bounding box from the segments' control points.
     *
     * This is a conservative superset of the drawn curve (a cubic is
     * contained in its control polygon's hull), which is exactly what a
     * crossing pre-filter wants: boxes that don't overlap guarantee the
     * curves can't intersect, so the expensive intersect call is safe to
     * skip. Cheap — O(segments), no bezier-js objects.
     *
     * Assumes the curve has >= 1 segment (guaranteed by the constructor,
     * which rejects empty segment lists); on a hypothetical empty curve it
     * would return inverted Infinity bounds.
     */
    boundingBox(): BoundingBox {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        // One closure per call (not the per-segment array literal a
        // `for...of [p0,cp1,cp2,p3]` would allocate) keeps this allocation-
        // free across segments on the generation hot path.
        const include = (p: Point): void => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        };
        for (const s of this.segments) {
            include(s.p0); include(s.cp1); include(s.cp2); include(s.p3);
        }
        return { minX, minY, maxX, maxY };
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

    resolveTWithIndex(t: number): { segmentIndex: number; localT: number } {
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
 */
function splitCubicAt(seg: BezierSegment, t: number): [BezierSegment, BezierSegment] {
    const { p0, cp1, cp2, p3 } = seg;
    const p01 = lerpPoint(p0, cp1, t);
    const p12 = lerpPoint(cp1, cp2, t);
    const p23 = lerpPoint(cp2, p3, t);
    const p012 = lerpPoint(p01, p12, t);
    const p123 = lerpPoint(p12, p23, t);
    const mid = lerpPoint(p012, p123, t);

    return [
        { p0, cp1: p01, cp2: p012, p3: mid },
        { p0: mid, cp1: p123, cp2: p23, p3 },
    ];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Check if a cubic Bézier segment is effectively a straight line.
 * (Control points are close to the line from p0 to p3.)
 */
function isLinearSegment(seg: BezierSegment, tolerance = 0.1): boolean {
    const dx = seg.p3.x - seg.p0.x;
    const dy = seg.p3.y - seg.p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return true;

    const nx = -dy / len;
    const ny = dx / len;

    for (const p of [seg.cp1, seg.cp2]) {
        const deviation = Math.abs((p.x - seg.p0.x) * nx + (p.y - seg.p0.y) * ny);
        if (deviation > tolerance) return false;
    }
    return true;
}

/**
 * Line-line intersection for two linear Bézier segments.
 */
function lineLineIntersect(
    segA: BezierSegment,
    segB: BezierSegment,
): Array<{ tA: number; tB: number; point: Point }> {
    const a1 = segA.p0, a2 = segA.p3;
    const b1 = segB.p0, b2 = segB.p3;

    const dax = a2.x - a1.x;
    const day = a2.y - a1.y;
    const dbx = b2.x - b1.x;
    const dby = b2.y - b1.y;

    const denom = dax * dby - day * dbx;
    if (Math.abs(denom) < 1e-10) return [];

    const tA = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
    const tB = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;

    if (tA < -0.001 || tA > 1.001 || tB < -0.001 || tB > 1.001) return [];

    return [{
        tA: Math.max(0, Math.min(1, tA)),
        tB: Math.max(0, Math.min(1, tB)),
        point: { x: a1.x + tA * dax, y: a1.y + tA * day },
    }];
}

/**
 * Project a point onto a line segment, returning the t parameter (0–1).
 */
function projectOntoLine(a: Point, b: Point, p: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) return 0;
    return ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Bounding-box helpers for intersection pre-filtering
// ---------------------------------------------------------------------------

interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Compute the axis-aligned bounding box of a cubic Bézier segment. */
function segmentBBox(seg: BezierSegment): BBox {
    return {
        minX: Math.min(seg.p0.x, seg.cp1.x, seg.cp2.x, seg.p3.x),
        minY: Math.min(seg.p0.y, seg.cp1.y, seg.cp2.y, seg.p3.y),
        maxX: Math.max(seg.p0.x, seg.cp1.x, seg.cp2.x, seg.p3.x),
        maxY: Math.max(seg.p0.y, seg.cp1.y, seg.cp2.y, seg.p3.y),
    };
}

/** Check if two bounding boxes overlap, with a tolerance margin. */
function bboxOverlap(a: BBox, b: BBox, margin: number): boolean {
    return (
        a.minX - margin <= b.maxX &&
        a.maxX + margin >= b.minX &&
        a.minY - margin <= b.maxY &&
        a.maxY + margin >= b.minY
    );
}
