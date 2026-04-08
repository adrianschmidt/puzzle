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
     * @param selfIndex - Index of the curve the tab is being added to
     *                    (excluded from collision checks)
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
 * Endpoint proximity (within `endpointTolerance` pixels) is ignored,
 * since cut lines naturally meet at grid intersections.
 */
export function createTabCollisionDetector(
    endpointTolerance = 2,
): CollisionDetector {
    return {
        hasCollision(proposed, existing, selfIndex) {
            const propStart = proposed.start;
            const propEnd = proposed.end;

            for (let i = 0; i < existing.length; i++) {
                if (i === selfIndex) continue;

                const intersections = proposed.intersect(existing[i]);

                // Filter out intersections near the tab's own endpoints,
                // which are expected where the tab rejoins its cut line.
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
 * Resolves excess intersections by modifying curves.
 */
export interface BaseCutConflictResolver {
    /**
     * Resolve all excess intersections by modifying the affected curves.
     *
     * @param curves - All curves (will not be mutated)
     * @param collisions - Detected excess intersections
     * @param random - Seeded PRNG for random choices
     * @returns New array of curves with excess intersections resolved
     */
    resolve(
        curves: Curve[],
        collisions: BaseCutCollision[],
        random: () => number,
    ): Curve[];
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
// Segment removal resolver (issue #220)
// ---------------------------------------------------------------------------

/**
 * Create a resolver that removes path segments to eliminate excess
 * intersections.
 *
 * For each excess pair, one of the two lens-bounding path segments is
 * replaced with the other curve's segment between the same two points.
 * Which segment to remove is chosen randomly, so the lens region
 * attaches to either adjacent piece with equal probability.
 *
 * All pairs within a single collision modify the same curve (chosen
 * randomly per collision) to avoid t-parameter invalidation across
 * interleaved modifications.
 */
export function createSegmentRemovalResolver(): BaseCutConflictResolver {
    return {
        resolve(curves, collisions, random) {
            const result = [...curves];

            for (const collision of collisions) {
                const { curveIndexA, curveIndexB, excessPairs } = collision;
                const modifyA = random() > 0.5;

                if (modifyA) {
                    result[curveIndexA] = applySegmentRemovals(
                        result[curveIndexA],
                        result[curveIndexB],
                        excessPairs.map(p => ({
                            tTarget1: p.tA1,
                            tTarget2: p.tA2,
                            tSource1: p.tB1,
                            tSource2: p.tB2,
                        })),
                    );
                } else {
                    result[curveIndexB] = applySegmentRemovals(
                        result[curveIndexB],
                        result[curveIndexA],
                        excessPairs.map(p => ({
                            tTarget1: Math.min(p.tB1, p.tB2),
                            tTarget2: Math.max(p.tB1, p.tB2),
                            tSource1: p.tB1 <= p.tB2 ? p.tA1 : p.tA2,
                            tSource2: p.tB1 <= p.tB2 ? p.tA2 : p.tA1,
                        })),
                    );
                }
            }

            return result;
        },
    };
}

interface SegmentRemoval {
    /** Start parameter on the target curve (tTarget1 < tTarget2). */
    tTarget1: number;
    /** End parameter on the target curve. */
    tTarget2: number;
    /** Start parameter on the source curve (corresponds to tTarget1's point). */
    tSource1: number;
    /** End parameter on the source curve (corresponds to tTarget2's point). */
    tSource2: number;
}

/**
 * Apply multiple segment removals to a target curve, replacing each
 * removed segment with the corresponding source curve's segment.
 *
 * Splits the ORIGINAL target curve at all removal boundaries at once
 * (using the backwards strategy from tab-merge.ts to preserve segment
 * indices), then replaces the appropriate chunks with exact copies of
 * the source curve's segments (split via de Casteljau). After
 * replacement, both curves share the same path in each lens region,
 * eliminating the island piece.
 */
function applySegmentRemovals(
    target: Curve,
    source: Curve,
    removals: SegmentRemoval[],
): Curve {
    if (removals.length === 0) return target;

    // Sort removals by tTarget1 ascending
    const sorted = [...removals].sort((a, b) => a.tTarget1 - b.tTarget1);

    // Collect all split t-values: [start1, end1, start2, end2, ...]
    const allTs: number[] = [];
    for (const r of sorted) {
        allTs.push(r.tTarget1, r.tTarget2);
    }

    // Resolve all t-values on the ORIGINAL (unsplit) curve
    const resolved = allTs
        .filter(t => t > 0.001 && t < 0.999)
        .map(t => ({ t, ...target.resolveTWithIndex(t) }));

    // Split backwards to preserve earlier segment indices
    const chunks: Curve[] = [];
    let remaining = target;
    const segTruncation = new Map<number, number>();

    for (let i = resolved.length - 1; i >= 0; i--) {
        const { segmentIndex, localT } = resolved[i];

        let adjustedLocalT = localT;
        const truncatedAt = segTruncation.get(segmentIndex);
        if (truncatedAt !== undefined && truncatedAt > 1e-10) {
            adjustedLocalT = localT / truncatedAt;
        }

        if (segmentIndex < 0 || segmentIndex >= remaining.segments.length) {
            continue;
        }

        const [left, right] = remaining.splitAtSegmentLocal(
            segmentIndex, adjustedLocalT,
        );
        chunks.push(right);
        remaining = left;
        segTruncation.set(segmentIndex, localT);
    }
    chunks.push(remaining);
    chunks.reverse();

    // chunks layout: [before_start1, start1→end1, end1→start2, start2→end2, ..., after_endN]
    // Odd-indexed chunks (1, 3, 5, ...) are the removal regions

    const resultChunks: Curve[] = [];
    for (let i = 0; i < chunks.length; i++) {
        if (i % 2 === 1) {
            // This chunk is a removal region — replace with source segment
            const removalIdx = (i - 1) / 2;
            const removal = sorted[removalIdx];

            // Extract the source curve's segment between the two
            // intersection points. This is an exact copy (split via
            // de Casteljau), so the two curves will share the same path
            // in this region — no lens, no island piece.
            const sourceChunk = extractSourceSegment(
                source, removal.tSource1, removal.tSource2,
            );

            resultChunks.push(sourceChunk);
        } else {
            resultChunks.push(chunks[i]);
        }
    }

    return joinResolvedCurves(resultChunks);
}

/**
 * Extract a segment from a curve between two t-parameters.
 */
function extractSourceSegment(
    source: Curve,
    sStart: number,
    sEnd: number,
): Curve {
    const sLow = Math.min(sStart, sEnd);
    const sHigh = Math.max(sStart, sEnd);

    const sLowResolved = source.resolveTWithIndex(sLow);
    const sHighResolved = source.resolveTWithIndex(sHigh);

    const [, sRest] = source.splitAtSegmentLocal(
        sLowResolved.segmentIndex, sLowResolved.localT,
    );

    let sRestSegIndex: number;
    let sRestLocalT: number;
    if (sHighResolved.segmentIndex === sLowResolved.segmentIndex) {
        sRestSegIndex = 0;
        const remainingRange = 1 - sLowResolved.localT;
        sRestLocalT = remainingRange > 1e-10
            ? (sHighResolved.localT - sLowResolved.localT) / remainingRange
            : 0.5;
    } else {
        sRestSegIndex = sHighResolved.segmentIndex - sLowResolved.segmentIndex;
        sRestLocalT = sHighResolved.localT;
    }

    const [sourceMiddle] = sRest.splitAtSegmentLocal(sRestSegIndex, sRestLocalT);
    return sStart <= sEnd ? sourceMiddle : sourceMiddle.reverse();
}

/**
 * Join multiple curves, snapping endpoints and filtering degenerates.
 */
function joinResolvedCurves(curves: Curve[]): Curve {
    const allSegments: { p0: Point; cp1: Point; cp2: Point; p3: Point }[] = [];

    for (const c of curves) {
        for (const seg of c.segments) {
            const len = Math.sqrt(
                (seg.p3.x - seg.p0.x) ** 2 + (seg.p3.y - seg.p0.y) ** 2,
            );
            if (len > 1e-6) {
                allSegments.push({ ...seg });
            }
        }
    }

    // Snap consecutive segment endpoints for continuity
    for (let i = 1; i < allSegments.length; i++) {
        allSegments[i].p0 = { ...allSegments[i - 1].p3 };
    }

    if (allSegments.length === 0) return curves[0];
    return new Curve(allSegments);
}

// ---------------------------------------------------------------------------
// Pipeline helper
// ---------------------------------------------------------------------------

/**
 * Detect and resolve excess intersections between base cuts.
 *
 * This is the high-level function to call in the generator pipeline
 * after base cuts are generated but before tabs are merged or the
 * DCEL is built.
 */
export function resolveExcessIntersections(
    curves: Curve[],
    borderCount: number,
    random: () => number,
    detector?: BaseCutCollisionDetector,
    resolver?: BaseCutConflictResolver,
): Curve[] {
    const det = detector ?? createExcessIntersectionDetector();
    const res = resolver ?? createSegmentRemovalResolver();

    const collisions = det.detect(curves, borderCount);
    if (collisions.length === 0) return curves;

    return res.resolve(curves, collisions, random);
}
