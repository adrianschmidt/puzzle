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
} from './tab-generator-helpers.js';

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
