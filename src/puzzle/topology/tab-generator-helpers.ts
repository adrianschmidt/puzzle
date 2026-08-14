/**
 * Template-agnostic: takes a TabTemplate by parameter and produces a spliced
 * curve.
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { BezierPath } from '../composable/bezier-path.js';
import { mirrorBezierPathY } from '../composable/bezier-path.js';
import type { TabSplicer } from './plugin-types.js';

export interface TabPlacementConfig {
    /** Minimum edge arc length (in pixels) to receive a tab. */
    minEdgeLength: number;
    /** Allowed range for tab center position along the edge (0–1). */
    centerRange: [number, number];
}

export const DEFAULT_TAB_PLACEMENT: TabPlacementConfig = {
    minEdgeLength: 20,
    centerRange: [0.3, 0.7],
};

export interface PreparedTab {
    /** In world coordinates. */
    tabCurve: Curve;
    before: Curve;
    after: Curve;
}

/**
 * Returns null if the tab is too wide for the edge. Split from the full flow so
 * the geometry can be inspected/rejected before `commitTab` joins it.
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
 * Like {@link prepareTab} but takes an already-generated normalized tab path.
 * Consumes no randomness, so the same path can be re-spliced (shrunk, moved,
 * sign-flipped) without advancing the PRNG. `tabPath` is in tab orientation
 * (bump protruding); `isTab=false` mirrors it to a blank.
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

    // Template start/end x = how much of the edge the tab occupies (edge-length
    // fractions).
    const templateStartX = normalizedPath[0].x;
    const templateEndX = normalizedPath[normalizedPath.length - 1].x;

    // Placement is in arc-length fraction space (s ∈ [0,1]), then converted to
    // uniform t for splitting: uniform t distributes across segment indices, NOT
    // proportional to length, so multi-segment curves need this.

    const templateMidX = (templateStartX + templateEndX) / 2;

    // Full x-extent, including head control points that bulge beyond the neck.
    const allXs = normalizedPath.map(p => p.x);
    const tabMinX = Math.min(...allXs);
    const tabMaxX = Math.max(...allXs);

    // Head overhang from center (edge-length fractions).
    const headOverhangLeft = templateMidX - tabMinX;
    const headOverhangRight = tabMaxX - templateMidX;

    // Full extent (incl. head) must stay ≥ margin from both endpoints.
    const margin = 0.12;
    const sCenterMin = margin + headOverhangLeft;
    const sCenterMax = 1 - margin - headOverhangRight;

    if (sCenterMax < sCenterMin) {
        return null;
    }

    // tCenter is a [0,1] placement hint; treat as arc-length fraction and clamp.
    let sCenter = Math.max(sCenterMin, Math.min(sCenterMax, tCenter));

    // Splice points in arc-length space
    const sLeft = Math.max(0.001, sCenter + (templateStartX - templateMidX));
    const sRight = Math.min(0.999, sCenter + (templateEndX - templateMidX));

    const tLeft = curve.arcLengthToT(sLeft);
    const tRight = curve.arcLengthToT(sRight);

    const pLeft = curve.pointAt(tLeft);
    const pRight = curve.pointAt(tRight);

    // Template space → edge coordinates; x and y are edge-length fractions.
    const edgeLength = curve.arcLength();
    const transformedPath = transformTabToEdge(
        normalizedPath, pLeft, pRight, edgeLength,
    );

    // Split in segment-local coords to avoid global-t remapping precision loss:
    // after splitting, `rest`'s first segment is partial, but pointAt/splitAt
    // treat all segments' t equally.
    const leftResolved = curve.resolveTWithIndex(tLeft);
    const rightResolved = curve.resolveTWithIndex(tRight);

    const [before, rest] = curve.splitAtSegmentLocal(
        leftResolved.segmentIndex, leftResolved.localT,
    );

    let restSegIndex: number;
    let restLocalT: number;

    if (rightResolved.segmentIndex === leftResolved.segmentIndex) {
        // Same segment: remap rightResolved.localT into [0,1] of the portion
        // remaining after the left split.
        restSegIndex = 0;
        const remainingRange = 1 - leftResolved.localT;
        restLocalT = remainingRange > 1e-10
            ? (rightResolved.localT - leftResolved.localT) / remainingRange
            : 0.5;
    } else {
        // Different segment: rest's segment 0 is the split segment's tail, so
        // the right point sits in segment (right - left) of `rest`, same localT.
        restSegIndex = rightResolved.segmentIndex - leftResolved.segmentIndex;
        restLocalT = rightResolved.localT;
    }

    const [_middle, after] = rest.splitAtSegmentLocal(restSegIndex, restLocalT);

    // Snap tab endpoints to the split points for exact continuity (no gaps).
    const snappedPath = [...transformedPath];
    snappedPath[0] = { ...before.end };
    snappedPath[snappedPath.length - 1] = { ...after.start };

    const tabCurve = Curve.fromBezierPath(snappedPath);
    return { tabCurve, before, after };
}

export function commitTab(prepared: PreparedTab): Curve {
    return joinCurves([prepared.before, prepared.tabCurve, prepared.after]);
}

/**
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

    // Too short for the tab fraction — the tab would consume most of the edge.
    if (length < config.minEdgeLength * 1.5) {
        return null;
    }

    const tCenter = lerp(config.centerRange[0], config.centerRange[1], random());
    const isTab = random() > 0.5;

    return { tCenter, isTab };
}

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

/**
 * Template space → world. Template x and y are both edge-length fractions,
 * mapped onto the tangent/normal frame at the anchor chord (pLeft → pRight):
 * x along the edge, y perpendicular, both scaled by edgeLength.
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

    const ux = dx / chordLen;
    const uy = dy / chordLen;
    // Perpendicular — tab protrudes left of travel direction
    const px = -uy;
    const py = ux;

    const templateStartX = path[0].x;
    const templateEndX = path[path.length - 1].x;
    const templateMidX = (templateStartX + templateEndX) / 2;

    const midX = (pLeft.x + pRight.x) / 2;
    const midY = (pLeft.y + pRight.y) / 2;

    return path.map(p => {
        const alongChord = (p.x - templateMidX) * edgeLength;
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

/**
 * Default splicer: `prepareTab` + `commitTab`, no post-processing. The join is
 * C0 (positions match, directions can disagree — a corner on flowy templates).
 */
export const standardTabSplicer: TabSplicer = {
    id: 'standard',
    splice(edge, placement, template, random) {
        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, template, random);
        return prepared ? commitTab(prepared) : null;
    },
};

/**
 * Smoothed splice from an already-generated path (no PRNG). Same output as
 * {@link smoothedTabSplicer}; used to re-splice one path into several variants.
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
 * Tangent-aligned splicer: rotates the tab's first cp1 and last cp2 onto the
 * parent tangent at the splices for a C1 join (vs standard's C0). cp distances
 * are preserved, so only handle direction changes, not curvature strength.
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
 * Smoothing distance for a splice angle correction, as a fraction of the tab's
 * splice-to-splice chord. Bigger angle → spread over a longer arc. Breakpoints
 * are empirical (issue #371); retune here against the seed-1086655870 puzzle.
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
 * Bring the tab to a C1 join with the parent at both splices. Near-straight
 * parent: rotate just the outermost cp. Curved parent: drop template anchors
 * within a splice-angle-scaled zone and bridge with one cubic that leaves along
 * the parent tangent, avoiding the sharp corner single-segment rotation leaves
 * (issue #371, Variant B). Pure post-processing, no PRNG — share-link unaffected.
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
        // Small angles both ends: rotate just the outermost cp at each splice.
        return alignOutermostOnly(prepared, segs, beforeTangent, afterTangent);
    }

    const m = segs.length;
    const result: BezierSegment[] = [];

    if (leftRemoves) {
        result.push(buildLeftBridge(segs, firstSurvL, beforeTangent));
    } else {
        result.push(rotateFirstCp(segs[0], beforeTangent));
    }

    const midStart = leftRemoves ? firstSurvL : 1;
    const midEnd = rightRemoves ? lastSurvR - 1 : m - 2;
    for (let i = midStart; i <= midEnd; i++) {
        result.push(segs[i]);
    }

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
 * Index of the interior anchor farthest (perpendicular) from the first-last
 * chord — the tab's head. Used to keep smoothing zones from consuming the head.
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
 * Decide which anchors survive at each end: `firstSurvL` (>=1) first survivor
 * from the left, `lastSurvR` (<=m-1) last from the right; `firstSurvL===1` /
 * `lastSurvR===m-1` mean no removal at that end. Guards: the head anchor never
 * falls in a zone, and >=1 original segment survives between the two bridges;
 * when neither holds (tab too short) returns the no-removal sentinel.
 *
 * Exported for unit tests that exercise the guard branches directly — driving
 * m<3, head-clamp, and "bridges would meet" through the full pipeline is brittle.
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
 * One cubic from the left splice (anchor 0) to the first surviving anchor:
 * leaves along the parent tangent, arrives along the surviving segment's
 * forward tangent (C1). Control magnitudes = chord/3, matching smooth-clusters.py.
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
 * One cubic from the last surviving anchor to the right splice (anchor m):
 * leaves along the preceding segment's tangent (C1), arrives along the parent
 * tangent. Control magnitudes = chord/3, as buildLeftBridge and
 * smooth-clusters.py use — keep the three in step.
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
 * Rotate only the tab's outermost control points onto the parent tangents.
 * Used when no anchors fall in either smoothing zone.
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
    // Prefer cp2 → p3; fall back to p0 → p3 when cp2 ≈ p3 (degenerate segment).
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
