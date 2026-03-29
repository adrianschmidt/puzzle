/**
 * Tab merging for the topology-driven pipeline.
 *
 * Merges tab shapes into cut lines by REPLACING a segment of the cut
 * with the tab path. The tab becomes part of the cut line itself.
 *
 * Uses the curve-clamping approach from tab-clamping-reference.md:
 * - Bisection to find anchor points at a fixed chord distance
 * - Tangent/normal frame from the anchor chord
 * - Tab shape transformed and spliced into the curve
 *
 * Pipeline:
 * 1. For each cut line, identify intersections → edge segments
 * 2. For each internal edge segment, bisect for anchor points
 * 3. Transform tab shape onto the anchor chord
 * 4. Replace the curve segment between anchors with the tab
 * 5. Reassemble modified edges back into full cut lines
 *
 * See issue #169 and docs/composable-reference/tab-clamping-reference.md
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import type { BezierPath, TabTemplate } from '../composable/tab-shapes.js';
import { mirrorBezierPathY } from '../composable/tab-shapes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parameters controlling tab placement on edges.
 */
export interface TabPlacementConfig {
    /** Minimum edge arc length (in pixels) to receive a tab. */
    minEdgeLength: number;
    /** Fixed chord length for the tab anchor points (in pixels). */
    tabChordLength: number;
    /** Allowed range for tab centre position along the edge (0–1). */
    centreRange: [number, number];
}

export const DEFAULT_TAB_PLACEMENT: TabPlacementConfig = {
    minEdgeLength: 30,
    tabChordLength: 35,
    centreRange: [0.3, 0.7],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge a tab shape into a curve using the bisection/chord-clamping approach.
 *
 * @param curve - The edge curve segment
 * @param tCenter - Where on the curve to place the tab (0–1)
 * @param isTab - True for protrusion, false for socket
 * @param chordLength - Fixed chord length in pixels
 * @param template - Tab shape template
 * @param random - Seeded PRNG for shape variation
 * @returns A new Curve with the tab spliced in
 */
export function mergeTabIntoCurve(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    chordLength: number,
    template: TabTemplate,
    random: () => number,
): Curve {
    // Generate tab shape in normalized space
    let normalizedPath = template.generate(random);
    if (!isTab) {
        normalizedPath = mirrorBezierPathY(normalizedPath);
    }

    // Bisect to find delta such that chord length = desired
    const delta = bisectForChord(curve, tCenter, chordLength);
    const tLeft = Math.max(0.001, tCenter - delta);
    const tRight = Math.min(0.999, tCenter + delta);

    // Get anchor points on the curve
    const pLeft = curve.pointAt(tLeft);
    const pRight = curve.pointAt(tRight);

    // Transform tab from normalized space to edge coordinates
    const transformedPath = transformTabToChord(normalizedPath, pLeft, pRight);

    // Split the curve using segment-local coordinates to avoid
    // global-t remapping precision loss. The uniform t distribution
    // across segments breaks down after splitting because the first
    // segment of `rest` is a partial segment with different arc length
    // than full segments, yet pointAt/splitAt treat all segments equally.
    const leftResolved = curve.resolveTWithIndex(tLeft);
    const rightResolved = curve.resolveTWithIndex(tRight);

    const [before, rest] = curve.splitAtSegmentLocal(
        leftResolved.segmentIndex, leftResolved.localT,
    );

    // Compute the right split point relative to `rest`.
    // `rest` starts with the right portion of the segment that was split.
    // If tRight is in a different segment than tLeft, we need to adjust
    // the segment index (subtract the segments consumed by `before`).
    // If tRight is in the SAME segment as tLeft, we need to remap localT
    // within the remaining portion of that segment.
    let restSegIndex: number;
    let restLocalT: number;

    if (rightResolved.segmentIndex === leftResolved.segmentIndex) {
        // Same segment: rest's first segment is the right portion after
        // splitting at leftResolved.localT. Remap rightResolved.localT
        // into [0,1] of the remaining portion.
        restSegIndex = 0;
        const remainingRange = 1 - leftResolved.localT;
        restLocalT = remainingRange > 1e-10
            ? (rightResolved.localT - leftResolved.localT) / remainingRange
            : 0.5;
    } else {
        // Different segment: rest's segment 0 is the tail of the split
        // segment, then segments follow in order. The right split point
        // is in segment (rightResolved.segmentIndex - leftResolved.segmentIndex)
        // of `rest`, with the same localT.
        restSegIndex = rightResolved.segmentIndex - leftResolved.segmentIndex;
        restLocalT = rightResolved.localT;
    }

    const [_middle, after] = rest.splitAtSegmentLocal(restSegIndex, restLocalT);

    // Snap the transformed tab endpoints to the exact split points
    // to ensure perfect continuity (no gaps between segments).
    const snappedPath = [...transformedPath];
    snappedPath[0] = { ...before.end };
    snappedPath[snappedPath.length - 1] = { ...after.start };

    const tabCurve = Curve.fromBezierPath(snappedPath);
    return joinCurves([before, tabCurve, after]);
}

/**
 * Determine if and where to place a tab on an edge segment.
 *
 * @returns { tCenter, isTab } or null if the edge is too short
 */
export function computeTabPlacement(
    curve: Curve,
    config: TabPlacementConfig,
    random: () => number,
): { tCenter: number; isTab: boolean } | null {
    const length = curve.arcLength();

    if (length < config.minEdgeLength) {
        return null;
    }

    // Don't place tabs if the edge is barely longer than the chord
    if (length < config.tabChordLength * 1.5) {
        return null;
    }

    const tCenter = lerp(config.centreRange[0], config.centreRange[1], random());
    const isTab = random() > 0.5;

    return { tCenter, isTab };
}

/**
 * Merge tabs into all internal edges of a set of cut lines.
 *
 * This is the high-level function: takes raw cuts, finds intersections
 * to identify edge segments, places tabs on each internal segment,
 * and returns modified curves ready for DCEL construction.
 */
export function mergeTabsIntoCuts(
    curves: Curve[],
    borderIndices: Set<number>,
    template: TabTemplate,
    config: TabPlacementConfig,
    random: () => number,
): Curve[] {
    const result: Curve[] = [];

    for (let i = 0; i < curves.length; i++) {
        if (borderIndices.has(i)) {
            result.push(curves[i]);
            continue;
        }

        // Find intersections with all other curves → split parameters
        const splitTs = findSplitParameters(curves[i], curves, i);

        if (splitTs.length === 0) {
            // Single edge, place one tab
            const placement = computeTabPlacement(curves[i], config, random);
            if (placement) {
                result.push(mergeTabIntoCurve(
                    curves[i], placement.tCenter, placement.isTab,
                    config.tabChordLength, template, random,
                ));
            } else {
                result.push(curves[i]);
            }
            continue;
        }

        // Split into edge segments, merge tab into each, rejoin
        const modifiedCurve = mergeTabsIntoSegments(
            curves[i], splitTs, config, template, random,
        );
        result.push(modifiedCurve);
    }

    return result;
}

// ---------------------------------------------------------------------------
// Bisection solver
// ---------------------------------------------------------------------------

/**
 * Find delta such that the chord between curve(tCenter-delta) and
 * curve(tCenter+delta) equals the desired length.
 */
function bisectForChord(
    curve: Curve,
    tCenter: number,
    desiredChord: number,
): number {
    let lo = 0;
    let hi = 0.5;

    for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const pL = curve.pointAt(Math.max(0, tCenter - mid));
        const pR = curve.pointAt(Math.min(1, tCenter + mid));
        const dx = pR.x - pL.x;
        const dy = pR.y - pL.y;
        const chord = Math.sqrt(dx * dx + dy * dy);
        if (chord < desiredChord) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Tab transformation
// ---------------------------------------------------------------------------

/**
 * Transform a tab BezierPath from normalized space ((0,0)→(1,0))
 * to chord coordinates (pLeft→pRight) using tangent/normal frame.
 */
function transformTabToChord(
    path: BezierPath,
    pLeft: Point,
    pRight: Point,
): BezierPath {
    const dx = pRight.x - pLeft.x;
    const dy = pRight.y - pLeft.y;
    // Perpendicular — tab protrudes left of travel direction
    const px = -dy;
    const py = dx;

    // The template may not span [0,1] — normalize to [0,1] first.
    const xMin = path[0].x;
    const xMax = path[path.length - 1].x;
    const xRange = xMax - xMin || 1;

    return path.map(p => {
        const nx = (p.x - xMin) / xRange;  // normalize to [0,1]
        const ny = p.y / xRange;            // scale y proportionally
        return {
            x: pLeft.x + nx * dx + ny * px,
            y: pLeft.y + nx * dy + ny * py,
        };
    });
}

// ---------------------------------------------------------------------------
// Intersection and splitting helpers
// ---------------------------------------------------------------------------

/**
 * Find all t-parameters where other curves intersect this curve.
 */
function findSplitParameters(
    curve: Curve,
    allCurves: Curve[],
    selfIndex: number,
): number[] {
    const ts: number[] = [];

    for (let j = 0; j < allCurves.length; j++) {
        if (j === selfIndex) continue;

        const intersections = curve.intersect(allCurves[j]);
        for (const ix of intersections) {
            ts.push(ix.tSelf);
        }

        // T-junctions: other curve endpoints on this curve
        for (const endpoint of [allCurves[j].start, allCurves[j].end]) {
            const t = curve.nearestT(endpoint);
            const projected = curve.pointAt(t);
            const d = Math.sqrt(
                (projected.x - endpoint.x) ** 2 +
                (projected.y - endpoint.y) ** 2,
            );
            if (d < 3 && t > 0.01 && t < 0.99) {
                ts.push(t);
            }
        }
    }

    // Sort and deduplicate
    return [...new Set(ts.map(t => Math.round(t * 1e4) / 1e4))]
        .sort((a, b) => a - b)
        .filter(t => t > 0.01 && t < 0.99);
}

/**
 * Split a curve at the given t-parameters, merge a tab into each segment,
 * and rejoin into a single curve.
 */
function mergeTabsIntoSegments(
    curve: Curve,
    splitTs: number[],
    config: TabPlacementConfig,
    template: TabTemplate,
    random: () => number,
): Curve {
    // Split into segments
    const segments: Curve[] = [];
    let remaining = curve;
    let consumed = 0;

    for (const t of splitTs) {
        const remapped = (t - consumed) / (1 - consumed);
        if (remapped <= 0.01 || remapped >= 0.99) continue;

        const [left, right] = remaining.splitAt(remapped);
        segments.push(left);
        remaining = right;
        consumed = t;
    }
    segments.push(remaining);

    // Merge tab into each segment
    const modified: Curve[] = [];
    for (const seg of segments) {
        const placement = computeTabPlacement(seg, config, random);
        if (placement) {
            modified.push(mergeTabIntoCurve(
                seg, placement.tCenter, placement.isTab,
                config.tabChordLength, template, random,
            ));
        } else {
            modified.push(seg);
        }
    }

    return joinCurves(modified);
}

// ---------------------------------------------------------------------------
// Curve joining
// ---------------------------------------------------------------------------

/**
 * Join multiple curves into a single curve by concatenating segments.
 */
function joinCurves(curves: Curve[]): Curve {
    const allSegments: BezierSegment[] = [];
    for (const c of curves) {
        for (const seg of c.segments) {
            const len = Math.sqrt(
                (seg.p3.x - seg.p0.x) ** 2 + (seg.p3.y - seg.p0.y) ** 2,
            );
            if (len < 1e-6) continue;
            allSegments.push(seg);
        }
    }

    if (allSegments.length === 0) {
        return curves[0];
    }

    return new Curve(allSegments);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
