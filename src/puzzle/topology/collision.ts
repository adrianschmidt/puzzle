/**
 * Pluggable collision detection and conflict resolution for tab lines
 * and base cut excess intersections.
 *
 * ## Tab collisions (issue #215)
 *
 * When a tab is being added to a cut line, the tab's path may intersect
 * other existing paths in the puzzle. This module provides interfaces
 * for detecting such collisions and deciding how to resolve them.
 *
 * ## Excess base cut intersections (issues #219, #220)
 *
 * Two base cuts (e.g., sine waves with similar frequency but offset phase)
 * can intersect more times than expected when amplitude is high enough.
 * Extra intersections come in pairs, creating tiny lens-shaped "bonus"
 * pieces. The detection and resolution interfaces below handle finding
 * these excess pairs and merging the lens regions back into adjacent pieces.
 *
 * The detection and resolution concerns are separated so they can be
 * swapped independently.
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import { diagnostics } from '../../diagnostics.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Detects whether a proposed tab path collides with existing paths.
 */
export interface CollisionDetector {
    /**
     * Check if a proposed tab curve collides with any existing curve.
     *
     * @param proposed - The tab curve in world coordinates (not yet merged)
     * @param existing - All cut curves in the puzzle
     * @param selfIndex - Index of the curve the tab is being added to.
     *                    The parent curve is still checked (so a tab that
     *                    loops back across another part of its own cut
     *                    line is caught); implementations rely on endpoint
     *                    filtering to ignore the two expected splice-point
     *                    joins.
     * @returns true if a collision is detected
     */
    hasCollision(
        proposed: Curve,
        existing: Curve[],
        selfIndex: number,
    ): boolean;
}

/**
 * Decides what to do when a collision is detected for a proposed tab.
 */
export interface ConflictResolver {
    /**
     * Resolve a collision (or lack thereof) for a tab merge.
     *
     * @param originalSegment - The unmodified edge segment (no tab)
     * @param mergedCurve - The curve with the tab merged in (null if
     *                      tab generation failed)
     * @param collides - Whether a collision was detected
     * @returns The curve to use — either the merged curve or the original
     */
    resolve(
        originalSegment: Curve,
        mergedCurve: Curve | null,
        collides: boolean,
    ): Curve;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

/**
 * Default collision detector: any intersection between the proposed tab
 * and another curve counts as a collision.
 *
 * The parent curve (at `selfIndex`) is checked too, so a tab that loops
 * back across another part of its own cut line is caught. The tab joins
 * its parent curve at exactly two splice points (its start and end);
 * those tangent touches, like any cut-line endpoint meeting, are filtered
 * out by `endpointTolerance`.
 */
export function createTabCollisionDetector(
    endpointTolerance = 2,
): CollisionDetector {
    return {
        hasCollision(proposed, existing, _selfIndex) {
            const propStart = proposed.start;
            const propEnd = proposed.end;

            for (let i = 0; i < existing.length; i++) {
                const intersections = proposed.intersect(existing[i]);

                // Filter out intersections near the tab's own endpoints,
                // which are expected where the tab rejoins its cut line
                // (both for other curves that meet at grid corners and for
                // the parent curve's own splice points).
                const real = intersections.filter(ix => {
                    const dx1 = ix.point.x - propStart.x;
                    const dy1 = ix.point.y - propStart.y;
                    const dx2 = ix.point.x - propEnd.x;
                    const dy2 = ix.point.y - propEnd.y;
                    const distToStart = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                    const distToEnd = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                    return distToStart > endpointTolerance
                        && distToEnd > endpointTolerance;
                });

                if (real.length > 0) return true;
            }

            return false;
        },
    };
}

/**
 * Default conflict resolver: skip the tab when a collision is detected.
 * The original (flat) segment is kept instead.
 */
export function createSkipOnCollisionResolver(): ConflictResolver {
    return {
        resolve(originalSegment, mergedCurve, collides) {
            if (collides || mergedCurve === null) return originalSegment;
            return mergedCurve;
        },
    };
}

// ---------------------------------------------------------------------------
// Excess base cut intersection detection (issue #219)
// ---------------------------------------------------------------------------

/**
 * A pair of excess intersection points between two base cuts.
 * The two points bound a lens-shaped region that creates a bonus piece.
 */
export interface ExcessIntersectionPair {
    /** First intersection point of the excess pair. */
    point1: Point;
    /** Second intersection point of the excess pair. */
    point2: Point;
    /** Parameter on curve A at point1. */
    tA1: number;
    /** Parameter on curve A at point2. */
    tA2: number;
    /** Parameter on curve B at point1. */
    tB1: number;
    /** Parameter on curve B at point2. */
    tB2: number;
}

/**
 * A collision between two base cuts that have excess intersections.
 */
export interface BaseCutCollision {
    /** Index of the first curve in the curves array. */
    curveIndexA: number;
    /** Index of the second curve in the curves array. */
    curveIndexB: number;
    /** The excess intersection pairs found between the two curves. */
    excessPairs: ExcessIntersectionPair[];
}

/**
 * Detects excess intersections between base cuts.
 */
export interface BaseCutCollisionDetector {
    /**
     * Find all curve pairs that have more intersections than expected.
     *
     * @param curves - All curves (borders + internal cuts)
     * @param borderCount - Number of leading curves that are borders
     *                      (excluded from detection)
     * @returns Collisions with excess intersection pairs
     */
    detect(curves: Curve[], borderCount: number): BaseCutCollision[];
}

/**
 * Create a detector that finds excess intersections between base cuts.
 *
 * For each pair of non-border curves, computes the expected number of
 * intersections by checking how many times their baselines (straight
 * lines from start to end) cross. Any actual intersections beyond that
 * count are excess, grouped into consecutive pairs.
 *
 * Intersections near curve endpoints are excluded since cuts naturally
 * meet at the puzzle border.
 */
export function createExcessIntersectionDetector(
    endpointTolerance = 3,
): BaseCutCollisionDetector {
    return {
        detect(curves, borderCount) {
            const collisions: BaseCutCollision[] = [];

            for (let i = borderCount; i < curves.length; i++) {
                for (let j = i + 1; j < curves.length; j++) {
                    const pairs = findExcessPairs(
                        curves[i], curves[j], endpointTolerance,
                    );
                    if (pairs.length > 0) {
                        collisions.push({
                            curveIndexA: i,
                            curveIndexB: j,
                            excessPairs: pairs,
                        });
                    }
                }
            }

            return collisions;
        },
    };
}

/**
 * Find excess intersection pairs between two curves.
 *
 * 1. Find all intersection points (excluding near endpoints)
 * 2. Determine the expected count from baseline straight lines
 * 3. Match actual intersections to expected ones by proximity
 * 4. Group remaining (unmatched) intersections into consecutive pairs
 */
function findExcessPairs(
    curveA: Curve,
    curveB: Curve,
    endpointTolerance: number,
): ExcessIntersectionPair[] {
    const actual = curveA.intersect(curveB);

    // Filter out intersections near any endpoint of either curve
    const endpoints = [curveA.start, curveA.end, curveB.start, curveB.end];
    const filtered = actual.filter(ix => {
        for (const ep of endpoints) {
            const d = Math.sqrt(
                (ix.point.x - ep.x) ** 2 + (ix.point.y - ep.y) ** 2,
            );
            if (d < endpointTolerance) return false;
        }
        return true;
    });

    // Compute expected intersection count from baselines
    const baseA = Curve.line(curveA.start, curveA.end);
    const baseB = Curve.line(curveB.start, curveB.end);
    const baseIntersections = baseA.intersect(baseB);
    const expectedCount = baseIntersections.filter(ix => {
        for (const ep of endpoints) {
            const d = Math.sqrt(
                (ix.point.x - ep.x) ** 2 + (ix.point.y - ep.y) ** 2,
            );
            if (d < endpointTolerance) return false;
        }
        return true;
    }).length;

    diagnostics.log('excess-pairs', `CurveA↔CurveB: actual=${filtered.length}, expected=${expectedCount}, raw=${actual.length}`, {
        filteredPoints: filtered.map(ix => ({ x: ix.point.x.toFixed(1), y: ix.point.y.toFixed(1), tSelf: ix.tSelf, tOther: ix.tOther })),
    });

    if (filtered.length <= expectedCount) return [];

    // Sort by tSelf (parameter on curve A)
    const sorted = [...filtered].sort((a, b) => a.tSelf - b.tSelf);

    // Match actual intersections to expected by proximity to baseline
    // intersection points. Matched intersections are "expected" and kept.
    const matched = new Set<number>();

    if (expectedCount > 0) {
        const baseFiltered = baseIntersections.filter(ix => {
            for (const ep of endpoints) {
                const d = Math.sqrt(
                    (ix.point.x - ep.x) ** 2 + (ix.point.y - ep.y) ** 2,
                );
                if (d < endpointTolerance) return false;
            }
            return true;
        });

        for (const baseIx of baseFiltered) {
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let k = 0; k < sorted.length; k++) {
                if (matched.has(k)) continue;
                const d = Math.sqrt(
                    (sorted[k].point.x - baseIx.point.x) ** 2 +
                    (sorted[k].point.y - baseIx.point.y) ** 2,
                );
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = k;
                }
            }
            if (bestIdx >= 0) matched.add(bestIdx);
        }
    }

    // Unmatched intersections are excess — pair them consecutively
    const excess = sorted
        .map((ix, k) => ({ ix, k }))
        .filter(({ k }) => !matched.has(k))
        .map(({ ix }) => ix);

    const pairs: ExcessIntersectionPair[] = [];
    for (let k = 0; k < excess.length - 1; k += 2) {
        pairs.push({
            point1: excess[k].point,
            point2: excess[k + 1].point,
            tA1: excess[k].tSelf,
            tA2: excess[k + 1].tSelf,
            tB1: excess[k].tOther,
            tB2: excess[k + 1].tOther,
        });
    }

    return pairs;
}

// ---------------------------------------------------------------------------
// Skip-point collector (issue #220)
// ---------------------------------------------------------------------------

/**
 * Per-pair cap telling the DCEL how many intersections to keep.
 * Any intersections beyond this count are excess (lens-forming)
 * and should be discarded.
 */
export interface IntersectionCap {
    curveIndexA: number;
    curveIndexB: number;
    /** Maximum number of interior intersections to keep. */
    expectedCount: number;
    /** Baseline crossing points — used to rank which intersections to keep. */
    expectedPoints: Point[];
}

/**
 * Build per-pair intersection caps from the detected collisions.
 *
 * For each pair of curves with excess intersections, computes the
 * expected intersection count (from baseline straight-line crossings)
 * and the expected crossing locations. The DCEL uses these to keep
 * only the N closest intersections to the baseline crossings, discarding
 * the rest.
 *
 * This avoids modifying curve geometry, sidestepping the
 * near-coincident-segment problem (bezier-js reports spurious crossings
 * when two curves overlap).
 */
export function buildIntersectionCaps(
    curves: Curve[],
    collisions: BaseCutCollision[],
    endpointTolerance = 3,
): IntersectionCap[] {
    const caps: IntersectionCap[] = [];
    for (const { curveIndexA, curveIndexB } of collisions) {
        const curveA = curves[curveIndexA];
        const curveB = curves[curveIndexB];

        // Compute expected crossing points from baselines
        const baseA = Curve.line(curveA.start, curveA.end);
        const baseB = Curve.line(curveB.start, curveB.end);
        const baseIx = baseA.intersect(baseB);
        const endpoints = [curveA.start, curveA.end, curveB.start, curveB.end];
        const expectedPoints = baseIx
            .filter(ix => {
                for (const ep of endpoints) {
                    const d = Math.sqrt(
                        (ix.point.x - ep.x) ** 2 + (ix.point.y - ep.y) ** 2,
                    );
                    if (d < endpointTolerance) return false;
                }
                return true;
            })
            .map(ix => ix.point);

        caps.push({
            curveIndexA,
            curveIndexB,
            expectedCount: expectedPoints.length,
            expectedPoints,
        });
    }
    return caps;
}

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------

/**
 * Detect excess intersections between base cuts and return per-pair
 * intersection caps for diagnostics.
 */
export function detectExcessIntersections(
    curves: Curve[],
    borderCount: number,
    detector?: BaseCutCollisionDetector,
): IntersectionCap[] {
    const det = detector ?? createExcessIntersectionDetector();
    const collisions = det.detect(curves, borderCount);
    if (collisions.length === 0) return [];
    return buildIntersectionCaps(curves, collisions);
}

/**
 * Resolve excess intersections by splicing out lens segments.
 *
 * For each excess intersection pair (A, B) between two curves, removes
 * one curve's segment between A and B. The other curve's segment
 * remains as the sole path through that region. The spliced curve
 * becomes two (or more) sub-curves.
 *
 * This avoids near-coincident paths that cause phantom intersections
 * in bezier-js. The DCEL naturally handles the resulting T-junctions
 * (sub-curve endpoints lying on the other curve).
 *
 * @param curves - All curves (borders + internal cuts)
 * @param borderCount - Number of leading border curves (not modified)
 * @param detector - Optional custom detector
 * @returns New curves array with lens segments removed
 */
export function resolveExcessIntersections(
    curves: Curve[],
    borderCount: number,
    detector?: BaseCutCollisionDetector,
): Curve[] {
    const det = detector ?? createExcessIntersectionDetector();
    const collisions = det.detect(curves, borderCount);

    diagnostics.log('excess-detect', `Detected ${collisions.length} excess collision pairs`, {
        collisions: collisions.map(c => ({
            curveA: c.curveIndexA,
            curveB: c.curveIndexB,
            pairs: c.excessPairs.length,
            details: c.excessPairs.map(p => ({
                p1: p.point1,
                p2: p.point2,
                tA: [p.tA1, p.tA2],
                tB: [p.tB1, p.tB2],
            })),
        })),
    });

    if (collisions.length === 0) return curves;

    // Collect all removal intervals per curve index.
    // For each excess pair, we remove the segment from curveA.
    const removalsByIndex = new Map<number, { t1: number; t2: number }[]>();
    for (const collision of collisions) {
        const idx = collision.curveIndexA;
        if (!removalsByIndex.has(idx)) removalsByIndex.set(idx, []);
        for (const pair of collision.excessPairs) {
            const t1 = Math.min(pair.tA1, pair.tA2);
            const t2 = Math.max(pair.tA1, pair.tA2);
            removalsByIndex.get(idx)!.push({ t1, t2 });
        }
    }

    // Process each curve: extract sub-curves that skip removal intervals
    const result: Curve[] = [];
    for (let i = 0; i < curves.length; i++) {
        const removals = removalsByIndex.get(i);
        if (!removals || removals.length === 0) {
            result.push(curves[i]);
            continue;
        }

        // Sort removals by t1 and merge overlapping intervals
        removals.sort((a, b) => a.t1 - b.t1);
        const merged: { t1: number; t2: number }[] = [removals[0]];
        for (let k = 1; k < removals.length; k++) {
            const last = merged[merged.length - 1];
            if (removals[k].t1 <= last.t2) {
                last.t2 = Math.max(last.t2, removals[k].t2);
            } else {
                merged.push(removals[k]);
            }
        }

        // Extract sub-curves for kept intervals using segment-level splitting.
        // Kept intervals: [0, r0.t1], [r0.t2, r1.t1], ..., [rN.t2, 1]
        const keptIntervals: { t1: number; t2: number }[] = [];
        let prevEnd = 0;
        for (const r of merged) {
            if (r.t1 > prevEnd + 1e-10) {
                keptIntervals.push({ t1: prevEnd, t2: r.t1 });
            }
            prevEnd = r.t2;
        }
        if (prevEnd < 1 - 1e-10) {
            keptIntervals.push({ t1: prevEnd, t2: 1 });
        }

        for (const interval of keptIntervals) {
            const sub = extractSubCurve(curves[i], interval.t1, interval.t2);
            if (sub !== null) {
                result.push(sub);
            }
        }
    }

    return result;
}

/**
 * Extract a sub-curve from a Curve between two global t parameters.
 * Works at the segment level to avoid parameter space drift.
 */
function extractSubCurve(curve: Curve, t1: number, t2: number): Curve | null {
    if (t2 - t1 < 1e-10) return null;

    const r1 = curve.resolveTWithIndex(Math.max(0, t1));
    const r2 = curve.resolveTWithIndex(Math.min(1, t2));

    if (r1.segmentIndex === r2.segmentIndex) {
        // Both endpoints within the same segment — extract sub-segment
        const seg = curve.segments[r1.segmentIndex];
        const [, right] = splitCubicBezier(seg, r1.localT);
        const range = 1 - r1.localT;
        if (range < 1e-10) return null;
        const adjT2 = (r2.localT - r1.localT) / range;
        const [sub] = splitCubicBezier(right, Math.min(1, adjT2));
        return new Curve([sub]);
    }

    // Multiple segments — assemble from parts
    const segments: BezierSegment[] = [];

    // First partial segment
    if (r1.localT > 1e-10) {
        const [, right] = splitCubicBezier(curve.segments[r1.segmentIndex], r1.localT);
        segments.push(right);
    } else {
        segments.push(curve.segments[r1.segmentIndex]);
    }

    // Full middle segments
    for (let s = r1.segmentIndex + 1; s < r2.segmentIndex; s++) {
        segments.push(curve.segments[s]);
    }

    // Last partial segment
    if (r2.segmentIndex > r1.segmentIndex) {
        if (r2.localT < 1 - 1e-10) {
            const [left] = splitCubicBezier(curve.segments[r2.segmentIndex], r2.localT);
            segments.push(left);
        } else {
            segments.push(curve.segments[r2.segmentIndex]);
        }
    }

    if (segments.length === 0) return null;
    return new Curve(segments);
}

/**
 * Split a cubic Bézier segment at parameter t using de Casteljau.
 */
function splitCubicBezier(
    seg: BezierSegment,
    t: number,
): [BezierSegment, BezierSegment] {
    const { p0, cp1, cp2, p3 } = seg;

    const a = lerp(p0, cp1, t);
    const b = lerp(cp1, cp2, t);
    const c = lerp(cp2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    const f = lerp(d, e, t);

    return [
        { p0, cp1: a, cp2: d, p3: f },
        { p0: f, cp1: e, cp2: c, p3 },
    ];
}

function lerp(a: Point, b: Point, t: number): Point {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
