/**
 * Tab placement / preparation primitives shared by all template-based
 * tab generators (classic, traced).
 *
 * The helpers know nothing about which template they're using — they
 * take a TabTemplate via parameter and produce a transformed, spliced
 * curve.
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { BezierPath } from '../composable/bezier-path.js';
import { mirrorBezierPathY } from '../composable/bezier-path.js';
import type { TabSplicer } from './plugin-types.js';

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
 * Generate and position a tab on a curve WITHOUT assembling it.
 *
 * Returns the tab curve in world coordinates along with the before/after
 * segments needed to assemble the final curve. Returns null if the tab
 * is too wide for the edge.
 *
 * Split out from the full tab-creation flow so the tab geometry can be
 * inspected (or rejected) before `commitTab` joins everything together.
 */
export function prepareTab(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
): PreparedTab | null {
    return prepareTabFromPath(curve, tCenter, isTab, template.generate(random));
}

/**
 * Like {@link prepareTab} but takes an already-generated normalized tab
 * path instead of a template + PRNG. Pure and deterministic — consumes
 * no randomness — so the same path can be re-spliced (shrunk, moved,
 * sign-flipped) without advancing the PRNG. `tabPath` is in the tab
 * orientation (bump protruding); `isTab=false` mirrors it to a blank here.
 */
export function prepareTabFromPath(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    tabPath: BezierPath,
): PreparedTab | null {
    let normalizedPath = tabPath;
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
 * **PRNG contract:** when this function returns non-null it consumes
 * exactly two `random()` calls in fixed order (tCenter, then isTab).
 * This count is part of the share-link reproducibility contract for
 * every consumer. Don't refactor it.
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

// ---------------------------------------------------------------------------
// Splicers
// ---------------------------------------------------------------------------

/**
 * Default splicer: standard `prepareTab` + `commitTab` with no
 * post-processing. The tab's first/last control points stay where
 * `transformTabToEdge` put them, so the join is C0 (positions match
 * but directions can disagree — visible as a corner on flowy templates).
 */
export const standardTabSplicer: TabSplicer = {
    id: 'standard',
    splice(edge, placement, template, random) {
        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, template, random);
        return prepared ? commitTab(prepared) : null;
    },
};

/**
 * Smoothed splice from an already-generated path (no PRNG). Same output
 * as {@link smoothedTabSplicer} for a given path; used by generators that
 * re-splice one path into several placement/scale variants.
 */
export function spliceSmoothedFromPath(
    edge: Curve,
    tCenter: number,
    isTab: boolean,
    tabPath: BezierPath,
): Curve | null {
    const prepared = prepareTabFromPath(edge, tCenter, isTab, tabPath);
    if (!prepared) return null;
    return commitTab(alignTangentsAtSplice(prepared));
}

/**
 * Tangent-aligned splicer: same as `standardTabSplicer` but rotates
 * the tab's first segment's cp1 and last segment's cp2 to lie along
 * the parent edge's tangent at the splice points. Result is a C1
 * join (smooth direction across the splice) instead of C0. Suited to
 * templates with continuous-looking curves (e.g. photographed tabs).
 *
 * The cp distances (|p0→cp1| and |p3→cp2|) are preserved, so the
 * tab's overall "strength" of curvature isn't changed — only the
 * direction of its first/last handles.
 */
export const smoothedTabSplicer: TabSplicer = {
    id: 'tangent-smoothed',
    splice(edge, placement, template, random) {
        return spliceSmoothedFromPath(
            edge, placement.tCenter, placement.isTab, template.generate(random),
        );
    },
};

/**
 * Smoothing distance for a splice angle correction, expressed as a
 * fraction of the tab's splice-to-splice chord. Monotonic
 * piecewise-linear ramp: 0 at/below 10°, rising to 0.30 at 90° and
 * clamped flat beyond. A bigger angle correction is spread over a
 * longer arc (more anchors fall in the smoothing zone).
 *
 * Breakpoints are the issue's empirical starting values (issue #371);
 * retune here after inspecting the seed-1086655870 reference puzzle.
 */
const SPLICE_SMOOTHING_RAMP: ReadonlyArray<readonly [number, number]> = [
    [10, 0.0],
    [30, 0.05],
    [60, 0.15],
    [90, 0.30],
];

export function spliceSmoothingChordFraction(thetaRadians: number): number {
    const deg = (thetaRadians * 180) / Math.PI;
    const ramp = SPLICE_SMOOTHING_RAMP;
    if (deg <= ramp[0][0]) return 0;
    const last = ramp[ramp.length - 1];
    if (deg >= last[0]) return last[1];
    for (let i = 1; i < ramp.length; i++) {
        const [d0, v0] = ramp[i - 1];
        const [d1, v1] = ramp[i];
        if (deg <= d1) {
            const t = (deg - d0) / (d1 - d0);
            return v0 + (v1 - v0) * t;
        }
    }
    return last[1];
}

/**
 * Bring the tab to a C1 (smooth-direction) join with the parent at both
 * splices. On a near-straight parent the angle correction is tiny and we
 * just rotate the outermost control point (the original behaviour). On a
 * highly-curved parent the correction is large, so we spread it: drop the
 * template anchors within a splice-angle-scaled zone of each splice and
 * bridge the gap with one cubic that leaves the splice along the parent's
 * tangent. This avoids the sharp corner the single-segment rotation leaves
 * on curved parents (issue #371, Variant B).
 *
 * Pure post-processing on the already-spliced tab — no PRNG involvement,
 * so the share-link contract is unaffected.
 */
function alignTangentsAtSplice(prepared: PreparedTab): PreparedTab {
    const { before, after } = prepared;
    const segs = prepared.tabCurve.segments.slice();
    if (segs.length === 0) return prepared;

    const beforeTangent = tangentAtEnd(before);
    const afterTangent = tangentAtStart(after);

    const { firstSurvL, lastSurvR } = computeSpliceZones(
        segs, beforeTangent, afterTangent,
    );

    const leftRemoves = firstSurvL > 1;
    const rightRemoves = lastSurvR < segs.length - 1;

    if (!leftRemoves && !rightRemoves) {
        // Small angles at both ends: preserve the original behaviour of
        // rotating just the outermost cp at each splice.
        return alignOutermostOnly(prepared, segs, beforeTangent, afterTangent);
    }

    const m = segs.length;
    const result: BezierSegment[] = [];

    // Left end.
    if (leftRemoves) {
        result.push(buildLeftBridge(segs, firstSurvL, beforeTangent));
    } else {
        result.push(rotateFirstCp(segs[0], beforeTangent));
    }

    // Surviving original middle segments.
    const midStart = leftRemoves ? firstSurvL : 1;
    const midEnd = rightRemoves ? lastSurvR - 1 : m - 2;
    for (let i = midStart; i <= midEnd; i++) {
        result.push(segs[i]);
    }

    // Right end.
    if (rightRemoves) {
        result.push(buildRightBridge(segs, lastSurvR, afterTangent));
    } else {
        result.push(rotateLastCp(segs[m - 1], afterTangent));
    }

    return { before, tabCurve: new Curve(result), after };
}

/** Angle in radians between two unit vectors. */
function angleBetweenUnit(a: Point, b: Point): number {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
    return Math.acos(dot);
}

/** Unit vector (dx, dy), falling back to (fbx, fby) when ~zero length. */
function unitVec(dx: number, dy: number, fbx: number, fby: number): Point {
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? { x: fbx, y: fby } : { x: dx / len, y: dy / len };
}

/**
 * Index of the interior anchor farthest (perpendicular distance) from the
 * chord between the first and last anchors — i.e. the tab's head. Used to
 * stop the smoothing zones from ever consuming the head.
 */
function farthestAnchorIndex(anchors: Point[]): number {
    const a = anchors[0];
    const b = anchors[anchors.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let best = 1;
    let bestDist = -1;
    for (let i = 1; i < anchors.length - 1; i++) {
        const d = Math.abs((anchors[i].x - a.x) * nx + (anchors[i].y - a.y) * ny);
        if (d > bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/**
 * Decide which anchors survive at each end. Returns the index of the first
 * surviving anchor from the left (`firstSurvL`, >= 1) and the last surviving
 * anchor from the right (`lastSurvR`, <= m-1). `firstSurvL === 1` /
 * `lastSurvR === m-1` mean "no removal at that end".
 *
 * Guards: the head anchor never falls inside a zone, and at least one
 * original segment survives between the two bridges (so each bridge's far
 * tangent comes from real template geometry). When neither can be honoured
 * (tab too short), returns the no-removal sentinel.
 *
 * Exported for unit tests, which exercise the guard branches directly:
 * driving the `m < 3`, head-clamp, and "bridges would meet" cases through
 * the full splice pipeline is brittle (a far-from-chord head is inherently
 * far in arc distance, so the clamp rarely binds via real templates).
 */
export function computeSpliceZones(
    segs: readonly BezierSegment[],
    beforeTangent: Point,
    afterTangent: Point,
): { firstSurvL: number; lastSurvR: number } {
    const m = segs.length;
    const noRemoval = { firstSurvL: 1, lastSurvR: m - 1 };
    if (m < 3) return noRemoval;

    const anchors: Point[] = [segs[0].p0, ...segs.map(s => s.p3)];
    const chord = Math.hypot(
        anchors[m].x - anchors[0].x,
        anchors[m].y - anchors[0].y,
    );
    if (chord < 1e-9) return noRemoval;

    const headIndex = farthestAnchorIndex(anchors);

    // Left zone: walk inward from anchor 0 while within dL.
    const leftNatural = unitVec(
        segs[0].cp1.x - segs[0].p0.x, segs[0].cp1.y - segs[0].p0.y,
        segs[0].p3.x - segs[0].p0.x, segs[0].p3.y - segs[0].p0.y,
    );
    const dL = spliceSmoothingChordFraction(
        angleBetweenUnit(beforeTangent, leftNatural),
    ) * chord;
    let firstSurvL = 1;
    let cum = 0;
    for (let i = 1; i < m; i++) {
        cum += Math.hypot(
            anchors[i].x - anchors[i - 1].x, anchors[i].y - anchors[i - 1].y,
        );
        if (cum < dL) firstSurvL = i + 1; else break;
    }
    firstSurvL = Math.min(firstSurvL, headIndex);

    // Right zone: walk inward from anchor m while within dR.
    const rightNatural = unitVec(
        segs[m - 1].p3.x - segs[m - 1].cp2.x, segs[m - 1].p3.y - segs[m - 1].cp2.y,
        segs[m - 1].p3.x - segs[m - 1].p0.x, segs[m - 1].p3.y - segs[m - 1].p0.y,
    );
    const dR = spliceSmoothingChordFraction(
        angleBetweenUnit(afterTangent, rightNatural),
    ) * chord;
    let lastSurvR = m - 1;
    cum = 0;
    for (let i = m - 1; i >= 1; i--) {
        cum += Math.hypot(
            anchors[i + 1].x - anchors[i].x, anchors[i + 1].y - anchors[i].y,
        );
        if (cum < dR) lastSurvR = i - 1; else break;
    }
    lastSurvR = Math.max(lastSurvR, headIndex);

    // Need >= 1 surviving original segment strictly between the bridges.
    if (lastSurvR < firstSurvL + 1) return noRemoval;

    return { firstSurvL, lastSurvR };
}

/**
 * One cubic from the left splice (anchor 0) to the first surviving anchor.
 * Leaves the splice along the parent tangent; arrives along the surviving
 * segment's forward tangent (C1 with surviving geometry). Control magnitudes
 * = chord/3 (cubic-Hermite default), matching smooth-clusters.py.
 */
function buildLeftBridge(
    segs: readonly BezierSegment[],
    firstSurvL: number,
    parentTangent: Point,
): BezierSegment {
    const p0 = segs[0].p0;
    const surviving = segs[firstSurvL];
    const p3 = surviving.p0; // === anchors[firstSurvL]
    const fwd = unitVec(
        surviving.cp1.x - surviving.p0.x, surviving.cp1.y - surviving.p0.y,
        surviving.p3.x - surviving.p0.x, surviving.p3.y - surviving.p0.y,
    );
    const mag = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
    return {
        p0,
        cp1: { x: p0.x + parentTangent.x * mag, y: p0.y + parentTangent.y * mag },
        cp2: { x: p3.x - fwd.x * mag, y: p3.y - fwd.y * mag },
        p3,
    };
}

/**
 * One cubic from the last surviving anchor to the right splice (anchor m).
 * Leaves the surviving anchor along the preceding segment's tangent (C1);
 * arrives at the splice along the parent tangent. Control magnitudes =
 * chord/3, the same cubic-Hermite default `buildLeftBridge` and
 * smooth-clusters.py use — keep the three in step if you retune it.
 */
function buildRightBridge(
    segs: readonly BezierSegment[],
    lastSurvR: number,
    parentTangent: Point,
): BezierSegment {
    const m = segs.length;
    const p0 = segs[lastSurvR].p0; // === anchors[lastSurvR]
    const p3 = segs[m - 1].p3;     // === anchors[m]
    const prev = segs[lastSurvR - 1];
    const prevExitDir = unitVec(
        prev.p3.x - prev.cp2.x, prev.p3.y - prev.cp2.y,
        prev.p3.x - prev.p0.x, prev.p3.y - prev.p0.y,
    );
    const mag = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
    return {
        p0,
        cp1: { x: p0.x + prevExitDir.x * mag, y: p0.y + prevExitDir.y * mag },
        cp2: { x: p3.x - parentTangent.x * mag, y: p3.y - parentTangent.y * mag },
        p3,
    };
}

/** Rotate a segment's cp1 onto `tangent`, preserving |p0 -> cp1|. */
function rotateFirstCp(seg: BezierSegment, tangent: Point): BezierSegment {
    const d = Math.hypot(seg.cp1.x - seg.p0.x, seg.cp1.y - seg.p0.y);
    if (d <= 1e-9) return seg;
    return {
        ...seg,
        cp1: { x: seg.p0.x + tangent.x * d, y: seg.p0.y + tangent.y * d },
    };
}

/** Rotate a segment's cp2 so (p3 - cp2) is parallel to `tangent`, preserving |p3 -> cp2|. */
function rotateLastCp(seg: BezierSegment, tangent: Point): BezierSegment {
    const d = Math.hypot(seg.p3.x - seg.cp2.x, seg.p3.y - seg.cp2.y);
    if (d <= 1e-9) return seg;
    return {
        ...seg,
        cp2: { x: seg.p3.x - tangent.x * d, y: seg.p3.y - tangent.y * d },
    };
}

/**
 * Original behaviour: rotate only the tab's outermost control points onto
 * the parent tangents. Used when no anchors fall in either smoothing zone.
 */
function alignOutermostOnly(
    prepared: PreparedTab,
    segs: readonly BezierSegment[],
    beforeTangent: Point,
    afterTangent: Point,
): PreparedTab {
    const out = segs.slice();
    out[0] = rotateFirstCp(out[0], beforeTangent);
    const lastIdx = out.length - 1;
    out[lastIdx] = rotateLastCp(out[lastIdx], afterTangent);
    return {
        before: prepared.before,
        tabCurve: new Curve(out),
        after: prepared.after,
    };
}

function tangentAtEnd(curve: Curve): Point {
    const lastSeg = curve.segments[curve.segments.length - 1];
    // Prefer cp2 → p3 for the tangent direction at the curve's end.
    // Fall back to p0 → p3 if cp2 ≈ p3 (degenerate / linear segment).
    let dx = lastSeg.p3.x - lastSeg.cp2.x;
    let dy = lastSeg.p3.y - lastSeg.cp2.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-9) {
        dx = lastSeg.p3.x - lastSeg.p0.x;
        dy = lastSeg.p3.y - lastSeg.p0.y;
        len = Math.hypot(dx, dy);
    }
    return len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

function tangentAtStart(curve: Curve): Point {
    const firstSeg = curve.segments[0];
    let dx = firstSeg.cp1.x - firstSeg.p0.x;
    let dy = firstSeg.cp1.y - firstSeg.p0.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-9) {
        dx = firstSeg.p3.x - firstSeg.p0.x;
        dy = firstSeg.p3.y - firstSeg.p0.y;
        len = Math.hypot(dx, dy);
    }
    return len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}
