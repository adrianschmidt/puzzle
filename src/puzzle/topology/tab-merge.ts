/**
 * Tab merging for the topology-driven pipeline.
 *
 * Merges tab shapes into cut lines by REPLACING a segment of the cut
 * with the tab path. The tab becomes part of the cut line itself.
 *
 * Pipeline:
 * 1. For each cut line, identify where tabs should be placed
 * 2. Split the cut at the tab's start/end points
 * 3. Remove the middle segment, splice in the tab path
 * 4. Return modified curves for DCEL construction
 *
 * See issue #169 for design discussion.
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
 * Describes where a tab should be placed on a curve.
 */
export interface TabPlacement {
    /** Parameter along the curve where the tab starts (0–1). */
    tStart: number;
    /** Parameter along the curve where the tab ends (0–1). */
    tEnd: number;
    /** Whether this is a tab (protrudes +Y) or blank (protrudes −Y). */
    isTab: boolean;
}

/**
 * Parameters controlling tab placement on edges.
 * All are parameterized (not hardcoded) per #130/#132 decisions.
 */
export interface TabPlacementConfig {
    /** Minimum edge arc length (in pixels) to receive a tab. Below this → no tab. */
    minEdgeLength: number;
    /** Tab width as fraction of edge length (0–1). Default ~0.4. */
    tabWidthFraction: number;
    /** Centre position along the edge (0–1). Default 0.5. Randomized per edge. */
    centreRange: [number, number];
}

export const DEFAULT_TAB_PLACEMENT: TabPlacementConfig = {
    minEdgeLength: 20,
    tabWidthFraction: 0.4,
    centreRange: [0.35, 0.65],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge a tab shape into a curve, replacing the segment between tStart and tEnd
 * with the transformed tab path.
 *
 * @param curve - The original curve (cut line segment)
 * @param placement - Where on the curve to place the tab
 * @param template - Tab shape template
 * @param random - Seeded PRNG for shape variation
 * @returns A new Curve with the tab spliced in
 */
export function mergeTabIntoCurve(
    curve: Curve,
    placement: TabPlacement,
    template: TabTemplate,
    random: () => number,
): Curve {
    const { tStart, tEnd, isTab } = placement;

    // Generate tab shape in normalized space
    let normalizedPath = template.generate(random);
    if (!isTab) {
        normalizedPath = mirrorBezierPathY(normalizedPath);
    }

    // Get the start and end points on the curve
    const pStart = curve.pointAt(tStart);
    const pEnd = curve.pointAt(tEnd);

    // Transform tab from normalized space to edge coordinates
    const transformedPath = transformTabToEdge(normalizedPath, pStart, pEnd);

    // Split the curve at tStart and tEnd
    const [before, rest] = curve.splitAt(tStart);
    // Remap tEnd into the remaining curve's parameter space
    const tEndRemapped = (tEnd - tStart) / (1 - tStart);
    const [_middle, after] = rest.splitAt(tEndRemapped);

    // Build the spliced curve: before + tab + after
    const tabCurve = Curve.fromBezierPath(transformedPath);

    return joinCurves([before, tabCurve, after]);
}

/**
 * Compute tab placement for an edge (segment of a cut line between two intersections).
 *
 * @param edgeCurve - The edge curve segment
 * @param config - Placement configuration
 * @param random - Seeded PRNG
 * @returns TabPlacement or null if the edge is too short for a tab
 */
export function computeTabPlacement(
    edgeCurve: Curve,
    config: TabPlacementConfig,
    random: () => number,
): TabPlacement | null {
    const length = edgeCurve.arcLength();

    if (length < config.minEdgeLength) {
        return null;
    }

    // Randomize centre position
    const centre = lerp(config.centreRange[0], config.centreRange[1], random());
    const halfWidth = config.tabWidthFraction / 2;
    const tStart = Math.max(0.01, centre - halfWidth);
    const tEnd = Math.min(0.99, centre + halfWidth);

    // Random tab/blank assignment
    const isTab = random() > 0.5;

    return { tStart, tEnd, isTab };
}

/**
 * Merge tabs into all internal edges of a set of cut lines.
 *
 * This is the high-level function that takes raw cut lines,
 * finds intersections to identify edges, places tabs on internal edges,
 * and returns modified curves ready for DCEL construction.
 *
 * @param curves - The input cut lines (border + internal)
 * @param borderIndices - Indices of border curves (no tabs on these edges)
 * @param template - Tab shape template
 * @param config - Tab placement configuration
 * @param random - Seeded PRNG
 * @returns Modified curves with tabs merged in
 */
export function mergeTabsIntoCuts(
    curves: Curve[],
    borderIndices: Set<number>,
    template: TabTemplate,
    config: TabPlacementConfig,
    random: () => number,
): Curve[] {
    // For each non-border curve, compute intersections with all other curves
    // to find the edge segments, then place tabs on each segment.
    const result: Curve[] = [];

    for (let i = 0; i < curves.length; i++) {
        if (borderIndices.has(i)) {
            // Border curves pass through unchanged
            result.push(curves[i]);
            continue;
        }

        // Find all intersection t-parameters on this curve
        const splitTs = findSplitParameters(curves[i], curves, i);

        if (splitTs.length === 0) {
            // No intersections — single edge, place one tab
            const placement = computeTabPlacement(curves[i], config, random);
            if (placement) {
                result.push(mergeTabIntoCurve(curves[i], placement, template, random));
            } else {
                result.push(curves[i]);
            }
            continue;
        }

        // Split curve into edge segments, merge tab into each, rejoin
        const modifiedCurve = mergeTabsIntoSegments(
            curves[i], splitTs, config, template, random,
        );
        result.push(modifiedCurve);
    }

    return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Transform a tab BezierPath from normalized space ((0,0)→(1,0))
 * to actual edge coordinates (pStart→pEnd) using tangent/normal frame.
 */
function transformTabToEdge(
    path: BezierPath,
    pStart: Point,
    pEnd: Point,
): BezierPath {
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    // Perpendicular (90° CCW — tab protrudes left of travel direction)
    const px = -dy;
    const py = dx;

    return path.map(p => ({
        x: pStart.x + p.x * dx + p.y * px,
        y: pStart.y + p.x * dy + p.y * py,
    }));
}

/**
 * Find all t-parameters where other curves intersect this curve.
 * Returns sorted, deduplicated t values (excluding near 0 and 1).
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

        // Also check T-junctions (other curve endpoints on this curve)
        for (const endpoint of [allCurves[j].start, allCurves[j].end]) {
            const t = findPointOnCurve(curve, endpoint);
            if (t !== null && t > 0.01 && t < 0.99) {
                ts.push(t);
            }
        }
    }

    // Sort and deduplicate
    const sorted = [...new Set(ts.map(t => Math.round(t * 1e4) / 1e4))]
        .sort((a, b) => a - b)
        .filter(t => t > 0.01 && t < 0.99);

    return sorted;
}

/**
 * Find the parameter t where a point lies on a curve, or null.
 * Uses bezier-js projection for accurate results.
 */
function findPointOnCurve(curve: Curve, point: Point): number | null {
    const t = curve.nearestT(point);
    const projected = curve.pointAt(t);
    const dx = projected.x - point.x;
    const dy = projected.y - point.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d < 1.0 ? t : null;
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
            modified.push(mergeTabIntoCurve(seg, placement, template, random));
        } else {
            modified.push(seg);
        }
    }

    // Rejoin all segments
    return joinCurves(modified);
}

/**
 * Join multiple curves into a single curve by concatenating their segments.
 * Assumes curves are end-to-start connected.
 */
function joinCurves(curves: Curve[]): Curve {
    const allSegments: BezierSegment[] = [];
    for (const c of curves) {
        for (const seg of c.segments) {
            // Skip degenerate zero-length segments
            const len = Math.sqrt(
                (seg.p3.x - seg.p0.x) ** 2 + (seg.p3.y - seg.p0.y) ** 2,
            );
            if (len < 1e-6) continue;
            allSegments.push(seg);
        }
    }

    if (allSegments.length === 0) {
        // Fallback: return the first curve
        return curves[0];
    }

    return new Curve(allSegments);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
