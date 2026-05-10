/**
 * Classic tab generator: produces the mushroom-shaped tabs from
 * tab-shapes.ts as a TabGenerator plug-in.
 *
 * Owns the tab placement / preparation / commit primitives.
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { BezierPath } from '../composable/bezier-path.js';
import { mirrorBezierPathY } from '../composable/bezier-path.js';
import type { TabGenerator } from './plugin-types.js';

export const classicTabGenerator: TabGenerator = {
    id: 'classic',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, classicTabTemplate, random);
        if (!prepared) return null;

        return commitTab(prepared);
    },
};

// ---------------------------------------------------------------------------
// Tab placement / preparation primitives
// ---------------------------------------------------------------------------

/**
 * Parameters controlling tab placement on edges.
 */
export interface TabPlacementConfig {
    /** Minimum edge arc length (in pixels) to receive a tab. */
    minEdgeLength: number;
    /** Allowed range for tab centre position along the edge (0–1). */
    centreRange: [number, number];
}

export const DEFAULT_TAB_PLACEMENT: TabPlacementConfig = {
    minEdgeLength: 20,
    centreRange: [0.3, 0.7],
};

/**
 * Result of preparing a tab for merging — contains the tab curve
 * and the split pieces needed to assemble the final curve.
 */
export interface PreparedTab {
    /** The tab curve in world coordinates. */
    tabCurve: Curve;
    /** The curve segment before the tab splice point. */
    before: Curve;
    /** The curve segment after the tab splice point. */
    after: Curve;
}

/**
 * Generate and position a tab on a curve WITHOUT merging it.
 *
 * Returns the tab curve in world coordinates along with the before/after
 * segments needed to assemble the final curve. Returns null if the tab
 * is too wide for the edge.
 *
 * This is used by collision detection to inspect the tab before committing.
 */
export function prepareTab(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
): PreparedTab | null {
    // Generate tab shape in normalized space
    let normalizedPath = template.generate(random);
    if (!isTab) {
        normalizedPath = mirrorBezierPathY(normalizedPath);
    }

    // The template's start/end x-values define how much of the edge
    // the tab occupies. These are fractions of edge length.
    const templateStartX = normalizedPath[0].x;
    const templateEndX = normalizedPath[normalizedPath.length - 1].x;

    // All placement is done in arc-length fraction space (s ∈ [0,1]),
    // then converted to uniform t for the actual curve splitting.
    // This is critical for multi-segment curves where uniform t
    // distributes across segment indices, NOT proportional to length.

    const templateMidX = (templateStartX + templateEndX) / 2;

    // Compute the FULL x-extent of the tab (including head control
    // points that bulge beyond the neck splice points).
    const allXs = normalizedPath.map(p => p.x);
    const tabMinX = Math.min(...allXs);
    const tabMaxX = Math.max(...allXs);

    // Full tab extent from centre (in edge-length fractions)
    const headOverhangLeft = templateMidX - tabMinX;
    const headOverhangRight = tabMaxX - templateMidX;

    // Enforce edge margins: the tab's full extent (including head)
    // must stay at least `margin` from both edge endpoints.
    const margin = 0.12;
    const sCenterMin = margin + headOverhangLeft;
    const sCenterMax = 1 - margin - headOverhangRight;

    if (sCenterMax < sCenterMin) {
        // Tab is too wide for this edge — skip it entirely
        return null;
    }

    // tCenter was generated in [0,1] as a placement hint. Treat it as
    // an arc-length fraction and clamp to margins.
    let sCenter = Math.max(sCenterMin, Math.min(sCenterMax, tCenter));

    // Splice points in arc-length space
    const sLeft = Math.max(0.001, sCenter + (templateStartX - templateMidX));
    const sRight = Math.min(0.999, sCenter + (templateEndX - templateMidX));

    // Convert arc-length fractions to uniform t
    const tLeft = curve.arcLengthToT(sLeft);
    const tRight = curve.arcLengthToT(sRight);

    // Get anchor points on the curve
    const pLeft = curve.pointAt(tLeft);
    const pRight = curve.pointAt(tRight);

    // Transform tab from template space to edge coordinates.
    // Both x and y are edge-length fractions — scale both by edge length.
    const edgeLength = curve.arcLength();
    const transformedPath = transformTabToEdge(
        normalizedPath, pLeft, pRight, edgeLength,
    );

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
    return { tabCurve, before, after };
}

/**
 * Assemble a prepared tab into a single curve.
 */
export function commitTab(prepared: PreparedTab): Curve {
    return joinCurves([prepared.before, prepared.tabCurve, prepared.after]);
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

    // Don't place tabs if the edge is too short for the tab fraction
    // (the tab itself would consume most of the edge)
    if (length < config.minEdgeLength * 1.5) {
        return null;
    }

    const tCenter = lerp(config.centreRange[0], config.centreRange[1], random());
    const isTab = random() > 0.5;

    return { tCenter, isTab };
}

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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Transform a tab BezierPath from template space to world coordinates.
 *
 * Template x and y are both fractions of edge length. The transform
 * maps them onto the edge using the tangent/normal frame at the
 * anchor chord (pLeft → pRight).
 *
 * x is positioned along the edge direction, y perpendicular to it.
 * Both are scaled by edgeLength, keeping width and height independent.
 */
function transformTabToEdge(
    path: BezierPath,
    pLeft: Point,
    pRight: Point,
    edgeLength: number,
): BezierPath {
    const dx = pRight.x - pLeft.x;
    const dy = pRight.y - pLeft.y;
    const chordLen = Math.sqrt(dx * dx + dy * dy);

    // Unit vectors along and perpendicular to the chord
    const ux = dx / chordLen;
    const uy = dy / chordLen;
    // Perpendicular — tab protrudes left of travel direction
    const px = -uy;
    const py = ux;

    // The midpoint of the chord anchors the tab centre.
    // Both x and y are edge-length fractions — scale both by edgeLength.
    // x is positioned along the chord direction relative to the chord
    // midpoint, y is perpendicular to it.
    const templateStartX = path[0].x;
    const templateEndX = path[path.length - 1].x;
    const templateMidX = (templateStartX + templateEndX) / 2;

    // Chord midpoint in world space
    const midX = (pLeft.x + pRight.x) / 2;
    const midY = (pLeft.y + pRight.y) / 2;

    return path.map(p => {
        // x offset from template centre, scaled by edge length
        const alongChord = (p.x - templateMidX) * edgeLength;

        // y is a fraction of edge length, scaled directly
        const perpendicular = p.y * edgeLength;

        return {
            x: midX + alongChord * ux + perpendicular * px,
            y: midY + alongChord * uy + perpendicular * py,
        };
    });
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
