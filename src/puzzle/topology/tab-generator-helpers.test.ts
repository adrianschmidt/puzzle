import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { createSeededRandom } from '../seeded-random.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    smoothedTabSplicer,
    standardTabSplicer,
    DEFAULT_TAB_PLACEMENT,
    prepareTabFromPath,
    spliceSmoothedFromPath,
} from './tab-generator-helpers.js';
import { spliceSmoothingChordFraction, computeSpliceZones } from './tab-generator-helpers.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { BezierSegment } from './curve.js';
import type { Point } from '../../model/types.js';
import type { BezierPath } from '../composable/bezier-path.js';

function unitTangentLeaving(seg: { cp2: { x: number; y: number }; p3: { x: number; y: number } }) {
    const dx = seg.p3.x - seg.cp2.x;
    const dy = seg.p3.y - seg.cp2.y;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
}

function unitTangentEntering(seg: { p0: { x: number; y: number }; cp1: { x: number; y: number } }) {
    const dx = seg.cp1.x - seg.p0.x;
    const dy = seg.cp1.y - seg.p0.y;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
}

describe('computeTabPlacement', () => {
    it('returns null for edges shorter than minEdgeLength * 1.5', () => {
        const random = createSeededRandom(1);
        const shortEdge = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        expect(computeTabPlacement(shortEdge, DEFAULT_TAB_PLACEMENT, random)).toBeNull();
    });

    it('returns tCenter and isTab for a long edge', () => {
        const random = createSeededRandom(1);
        const longEdge = Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 });
        const placement = computeTabPlacement(longEdge, DEFAULT_TAB_PLACEMENT, random);
        expect(placement).not.toBeNull();
        expect(placement!.tCenter).toBeGreaterThanOrEqual(DEFAULT_TAB_PLACEMENT.centreRange[0]);
        expect(placement!.tCenter).toBeLessThanOrEqual(DEFAULT_TAB_PLACEMENT.centreRange[1]);
        expect(typeof placement!.isTab).toBe('boolean');
    });
});

describe('prepareTab + commitTab', () => {
    it('produces a curve whose start and end match the input edge', () => {
        const random = createSeededRandom(42);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const prepared = prepareTab(edge, 0.5, true, classicTabTemplate, random);
        expect(prepared).not.toBeNull();
        const result = commitTab(prepared!);
        expect(result.start.x).toBeCloseTo(edge.start.x);
        expect(result.start.y).toBeCloseTo(edge.start.y);
        expect(result.end.x).toBeCloseTo(edge.end.x);
        expect(result.end.y).toBeCloseTo(edge.end.y);
    });
});

describe('smoothedTabSplicer', () => {
    // Single-segment cubic parent that bends strongly up in the middle.
    // The chord runs 0,0 → 240,0; the segment's interior y > 0 puts a
    // non-trivial tangent at the splice points (parent tangent at
    // t=0.5 is NOT along the chord), which is exactly the case where
    // C1 alignment is visible.
    function curvedParent(): Curve {
        return new Curve([{
            p0: { x: 0, y: 0 },
            cp1: { x: 80, y: 80 },
            cp2: { x: 160, y: 80 },
            p3: { x: 240, y: 0 },
        }]);
    }

    it('matches parent tangent at both splice points (C1 continuity)', () => {
        const edge = curvedParent();
        const result = smoothedTabSplicer.splice(
            edge,
            { tCenter: 0.5, isTab: true },
            classicTabTemplate,
            createSeededRandom(42),
        )!;
        expect(result).not.toBeNull();

        // A single-segment edge splits into before/after of 1 segment each,
        // so the joined result lays out as
        //   segs[0]                 = before
        //   segs[1..N]              = tab
        //   segs[N+1]               = after
        // where N = total - 2.
        const segs = result.segments;
        const N = segs.length - 2;
        expect(N).toBeGreaterThanOrEqual(1);

        const beforeOut = unitTangentLeaving(segs[0]);
        const tabIn = unitTangentEntering(segs[1]);
        expect(tabIn.x).toBeCloseTo(beforeOut.x, 6);
        expect(tabIn.y).toBeCloseTo(beforeOut.y, 6);

        const tabOut = unitTangentLeaving(segs[N]);
        const afterIn = unitTangentEntering(segs[N + 1]);
        expect(afterIn.x).toBeCloseTo(tabOut.x, 6);
        expect(afterIn.y).toBeCloseTo(tabOut.y, 6);
    });

    it('differs from standardTabSplicer at the splice (which is only C0)', () => {
        // On the same curved parent, the standard splicer keeps the tab's
        // chord-frame tangents — so the tab's first/last tangent is along
        // the local chord direction, not the parent's actual tangent.
        // This test pins the *difference*: were the smoothed splicer ever
        // silently reduced to standard behaviour, this assertion would
        // start passing where it should fail.
        const edge = curvedParent();
        const placement = { tCenter: 0.5, isTab: true };

        const standardResult = standardTabSplicer.splice(
            edge, placement, classicTabTemplate, createSeededRandom(42),
        )!;
        const smoothedResult = smoothedTabSplicer.splice(
            edge, placement, classicTabTemplate, createSeededRandom(42),
        )!;

        // Tab's first segment is at index 1 in both results (single-segment
        // parent → 1-segment before/after).
        const standardTabIn = unitTangentEntering(standardResult.segments[1]);
        const smoothedTabIn = unitTangentEntering(smoothedResult.segments[1]);
        // They must differ in at least one component by more than the C1
        // tolerance (otherwise smoothing did nothing).
        const dx = Math.abs(standardTabIn.x - smoothedTabIn.x);
        const dy = Math.abs(standardTabIn.y - smoothedTabIn.y);
        expect(dx + dy).toBeGreaterThan(1e-3);
    });
});

describe('spliceSmoothingChordFraction', () => {
    const deg = (d: number) => (d * Math.PI) / 180;

    it('is zero at and below the 10° threshold', () => {
        expect(spliceSmoothingChordFraction(deg(0))).toBe(0);
        expect(spliceSmoothingChordFraction(deg(10))).toBe(0);
    });

    it('hits the table breakpoints', () => {
        expect(spliceSmoothingChordFraction(deg(30))).toBeCloseTo(0.05, 6);
        expect(spliceSmoothingChordFraction(deg(60))).toBeCloseTo(0.15, 6);
        expect(spliceSmoothingChordFraction(deg(90))).toBeCloseTo(0.30, 6);
    });

    it('interpolates linearly between breakpoints', () => {
        expect(spliceSmoothingChordFraction(deg(45))).toBeCloseTo(0.10, 6);
        expect(spliceSmoothingChordFraction(deg(20))).toBeCloseTo(0.025, 6);
    });

    it('clamps flat above 90°', () => {
        expect(spliceSmoothingChordFraction(deg(120))).toBe(0.30);
        expect(spliceSmoothingChordFraction(deg(180))).toBe(0.30);
    });

    it('is monotonically non-decreasing across the range', () => {
        let prev = -1;
        for (let d = 0; d <= 180; d += 5) {
            const v = spliceSmoothingChordFraction(deg(d));
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });
});

/**
 * A template with closely-spaced neck anchors and a head bump, so a
 * curved parent's smoothing zone drops a predictable number of anchors.
 * Control points sit at 1/3 and 2/3 between consecutive anchors
 * (chord-aligned tangents). 9 anchors → 8 segments; apex at index 4.
 */
const NECK_HEAVY_ANCHORS: Point[] = [
    { x: 0.30, y: 0.00 },
    { x: 0.32, y: 0.03 },
    { x: 0.34, y: 0.06 },
    { x: 0.40, y: 0.13 },
    { x: 0.50, y: 0.17 }, // apex (head)
    { x: 0.60, y: 0.13 },
    { x: 0.66, y: 0.06 },
    { x: 0.68, y: 0.03 },
    { x: 0.70, y: 0.00 },
];

function makeTemplate(anchors: Point[]): TabTemplate {
    const path: Point[] = [anchors[0]];
    for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        path.push({ x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 });
        path.push({ x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 });
        path.push({ x: b.x, y: b.y });
    }
    return { name: 'synthetic', generate: () => path };
}

/** Tab anchor (segment boundary) farthest from the tab's splice chord. */
function farthestTabAnchor(result: Curve): Point {
    const segs = result.segments;
    const N = segs.length - 2;            // tab occupies segs[1..N]
    const start = segs[1].p0;
    const end = segs[N].p3;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const anchors: Point[] = [segs[1].p0, ...segs.slice(1, N + 1).map(s => s.p3)];
    let best = anchors[0];
    let bestDist = -1;
    for (const a of anchors) {
        const d = Math.abs((a.x - start.x) * nx + (a.y - start.y) * ny);
        if (d > bestDist) { bestDist = d; best = a; }
    }
    return best;
}

describe('smoothedTabSplicer anchor-removal', () => {
    // A hard parabola-like parent: tangent at the splices is far from the
    // splice chord, forcing a large angle correction θ at each splice.
    function hardCurvedParent(): Curve {
        return new Curve([{
            p0: { x: 0, y: 0 },
            cp1: { x: 0, y: 300 },
            cp2: { x: 240, y: 300 },
            p3: { x: 240, y: 0 },
        }]);
    }

    // Steep LEFT neck (~73°), shallow RIGHT neck (~8°): on a straight parent
    // only the left splice removes anchors → exercises the left-only branch.
    const LEFT_STEEP_ANCHORS: Point[] = [
        { x: 0.30, y: 0.000 },
        { x: 0.315, y: 0.050 },
        { x: 0.35, y: 0.100 },
        { x: 0.42, y: 0.150 },
        { x: 0.50, y: 0.170 }, // apex
        { x: 0.58, y: 0.130 },
        { x: 0.63, y: 0.060 },
        { x: 0.69, y: 0.0015 },
        { x: 0.70, y: 0.000 },
    ];

    // Mirror: shallow LEFT neck, steep RIGHT neck → right-only branch.
    const RIGHT_STEEP_ANCHORS: Point[] = [
        { x: 0.30, y: 0.000 },
        { x: 0.31, y: 0.0015 },
        { x: 0.37, y: 0.060 },
        { x: 0.42, y: 0.130 },
        { x: 0.50, y: 0.170 }, // apex
        { x: 0.58, y: 0.150 },
        { x: 0.65, y: 0.100 },
        { x: 0.685, y: 0.050 },
        { x: 0.70, y: 0.000 },
    ];

    // Near-horizontal necks (~3°) at both ends: on a straight parent θ < 10°,
    // so neither splice removes anchors → exercises the fallback path.
    const FLAT_NECK_ANCHORS: Point[] = [
        { x: 0.30, y: 0.000 },
        { x: 0.34, y: 0.002 },
        { x: 0.40, y: 0.080 },
        { x: 0.45, y: 0.140 },
        { x: 0.50, y: 0.160 }, // apex
        { x: 0.55, y: 0.140 },
        { x: 0.60, y: 0.080 },
        { x: 0.66, y: 0.002 },
        { x: 0.70, y: 0.000 },
    ];

    function expectC1AtBothSplices(result: Curve): void {
        const N = result.segments.length - 2;
        const beforeOut = unitTangentLeaving(result.segments[0]);
        const tabIn = unitTangentEntering(result.segments[1]);
        expect(tabIn.x).toBeCloseTo(beforeOut.x, 6);
        expect(tabIn.y).toBeCloseTo(beforeOut.y, 6);
        const tabOut = unitTangentLeaving(result.segments[N]);
        const afterIn = unitTangentEntering(result.segments[N + 1]);
        expect(afterIn.x).toBeCloseTo(tabOut.x, 6);
        expect(afterIn.y).toBeCloseTo(tabOut.y, 6);
    }

    it('drops near-splice anchors and stays C1 on a strongly curved parent', () => {
        const tmpl = makeTemplate(NECK_HEAVY_ANCHORS);
        const edge = hardCurvedParent();
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        // At least one anchor was dropped → fewer segments overall.
        expect(smoothed.segments.length).toBeLessThan(standard.segments.length);

        // Splice is still C1 at both ends.
        const N = smoothed.segments.length - 2;
        const beforeOut = unitTangentLeaving(smoothed.segments[0]);
        const tabIn = unitTangentEntering(smoothed.segments[1]);
        expect(tabIn.x).toBeCloseTo(beforeOut.x, 6);
        expect(tabIn.y).toBeCloseTo(beforeOut.y, 6);

        const tabOut = unitTangentLeaving(smoothed.segments[N]);
        const afterIn = unitTangentEntering(smoothed.segments[N + 1]);
        expect(afterIn.x).toBeCloseTo(tabOut.x, 6);
        expect(afterIn.y).toBeCloseTo(tabOut.y, 6);
    });

    it('keeps every anchor (fallback) on a near-straight parent', () => {
        const tmpl = makeTemplate(FLAT_NECK_ANCHORS);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        // Near-horizontal necks → θ < 10° on a straight parent → no removal.
        expect(smoothed.segments.length).toBe(standard.segments.length);
    });

    it('preserves the head anchor under a large correction', () => {
        const tmpl = makeTemplate(NECK_HEAVY_ANCHORS);
        const edge = hardCurvedParent();
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        // The head (anchor farthest from the splice chord) is untouched, so
        // it appears at the same world position in both results.
        const apexStd = farthestTabAnchor(standard);
        const apexSm = farthestTabAnchor(smoothed);
        expect(apexSm.x).toBeCloseTo(apexStd.x, 3);
        expect(apexSm.y).toBeCloseTo(apexStd.y, 3);
    });

    it('builds a left-only bridge when only the left splice angle is large', () => {
        const tmpl = makeTemplate(LEFT_STEEP_ANCHORS);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;

        expect(smoothed.segments.length).toBeLessThan(standard.segments.length);
        expectC1AtBothSplices(smoothed);
    });

    it('builds a right-only bridge when only the right splice angle is large', () => {
        const tmpl = makeTemplate(RIGHT_STEEP_ANCHORS);
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const placement = { tCenter: 0.5, isTab: true };

        const standard = standardTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;
        const smoothed = smoothedTabSplicer.splice(
            edge, placement, tmpl, createSeededRandom(1),
        )!;


        expect(smoothed.segments.length).toBeLessThan(standard.segments.length);
        expectC1AtBothSplices(smoothed);
    });
});

describe('computeSpliceZones guard branches', () => {
    // Build segments through anchors with chord-aligned control points
    // (cp1/cp2 at 1/3 and 2/3), so each segment's tangent points along its
    // anchor chord — matching makeTemplate above but yielding BezierSegments.
    function segsFromAnchors(anchors: Point[]): BezierSegment[] {
        const segs: BezierSegment[] = [];
        for (let i = 0; i < anchors.length - 1; i++) {
            const a = anchors[i];
            const b = anchors[i + 1];
            segs.push({
                p0: a,
                cp1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
                cp2: { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 },
                p3: b,
            });
        }
        return segs;
    }

    /** Unit vector perpendicular to (dx, dy) — gives a 90° angle correction. */
    function perpendicular(dx: number, dy: number): Point {
        const len = Math.hypot(dx, dy);
        return { x: -dy / len, y: dx / len };
    }

    it('removes nothing on a tab too short to keep a surviving core (m < 3)', () => {
        // Two segments → m = 2. Tangents are irrelevant; the m < 3 guard
        // returns the no-removal sentinel before any angle math runs.
        const segs = segsFromAnchors([
            { x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 0 },
        ]);
        expect(segs.length).toBe(2);
        expect(computeSpliceZones(segs, { x: 1, y: 0 }, { x: 1, y: 0 }))
            .toEqual({ firstSurvL: 1, lastSurvR: 1 });
    });

    it('clamps the left zone to the head index so the head is never dropped', () => {
        // Anchors stay close to the chord (head perp distance is small) and
        // cluster near the left neck, so a 90° left correction (dL = 0.30 of
        // the unit chord) would walk PAST every interior anchor. The head
        // clamp must pin firstSurvL to headIndex (= 2) — without it the raw
        // walk would reach 5. The right side is aligned (θ ≈ 0 → no removal).
        const anchors: Point[] = [
            { x: 0.00, y: 0.000 },
            { x: 0.05, y: 0.010 },
            { x: 0.10, y: 0.025 }, // head: largest perp distance from the chord
            { x: 0.15, y: 0.010 },
            { x: 0.20, y: 0.005 },
            { x: 1.00, y: 0.000 },
        ];
        const segs = segsFromAnchors(anchors);
        const beforeTangent = perpendicular(0.05, 0.010); // ⟂ left neck → θ = 90°
        const afterTangent = { x: 1, y: 0 };               // ∥ right neck → θ ≈ 0
        const zones = computeSpliceZones(segs, beforeTangent, afterTangent);
        expect(zones.firstSurvL).toBe(2); // === headIndex: the clamp is load-bearing
        expect(zones.lastSurvR).toBe(segs.length - 1); // 5: aligned side keeps all
    });

    it('removes nothing when both zones would meet at the head', () => {
        // Symmetric short tab with the head in the middle (index 2). A 90°
        // correction at BOTH splices drives each raw zone up to the head, so
        // after clamping firstSurvL === lastSurvR === headIndex. With no
        // original segment left between the bridges, the disjoint guard
        // returns the no-removal sentinel rather than a degenerate two-bridge
        // tab.
        const anchors: Point[] = [
            { x: 0.00, y: 0.000 },
            { x: 0.05, y: 0.010 },
            { x: 0.10, y: 0.025 }, // head
            { x: 0.15, y: 0.010 },
            { x: 0.20, y: 0.000 },
        ];
        const segs = segsFromAnchors(anchors);
        const beforeTangent = perpendicular(0.05, 0.010);  // ⟂ left neck → θ = 90°
        const afterTangent = perpendicular(-0.05, 0.010);  // ⟂ right neck → θ = 90°
        expect(computeSpliceZones(segs, beforeTangent, afterTangent))
            .toEqual({ firstSurvL: 1, lastSurvR: segs.length - 1 });
    });
});

// A fixed, symmetric tab path in template space (x roughly 0.4..0.6,
// bump up to y = -0.15). Deterministic — no PRNG.
const FIXED_PATH: BezierPath = [
    { x: 0.40, y: 0 },
    { x: 0.44, y: 0 }, { x: 0.46, y: -0.15 }, { x: 0.50, y: -0.15 },
    { x: 0.54, y: -0.15 }, { x: 0.56, y: 0 }, { x: 0.60, y: 0 },
];

describe('prepareTabFromPath / spliceSmoothedFromPath', () => {
    it('prepareTabFromPath consumes no PRNG and is deterministic', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const a = prepareTabFromPath(edge, 0.5, true, FIXED_PATH);
        const b = prepareTabFromPath(edge, 0.5, true, FIXED_PATH);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a!.tabCurve.segments).toEqual(b!.tabCurve.segments);
    });

    it('spliceSmoothedFromPath returns a curve with the edge endpoints', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const c = spliceSmoothedFromPath(edge, 0.5, true, FIXED_PATH);
        expect(c).not.toBeNull();
        expect(c!.start.x).toBeCloseTo(0);
        expect(c!.start.y).toBeCloseTo(0);
        expect(c!.end.x).toBeCloseTo(240);
        expect(c!.end.y).toBeCloseTo(0);
    });

    it('prepareTab still produces the same path-based result for one drawn path', () => {
        const edge = Curve.line({ x: 0, y: 0 }, { x: 240, y: 0 });
        const template = { name: 'fixed', generate: (): BezierPath => FIXED_PATH };
        const viaTemplate = prepareTab(edge, 0.5, true, template, () => 0.5);
        const viaPath = prepareTabFromPath(edge, 0.5, true, FIXED_PATH);
        expect(viaTemplate!.tabCurve.segments).toEqual(viaPath!.tabCurve.segments);
    });
});
