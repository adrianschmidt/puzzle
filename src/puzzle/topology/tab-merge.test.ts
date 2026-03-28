import { describe, it, expect } from 'vitest';
import {
    mergeTabIntoCurve,
    computeTabPlacement,
    mergeTabsIntoCuts,
    DEFAULT_TAB_PLACEMENT,
} from './tab-merge.js';
import type { TabPlacement } from './tab-merge.js';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabTemplate } from '../composable/tab-shapes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG for tests. */
function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/** Simple tab template that creates a triangular bump for easy testing. */
const triangleTabTemplate: TabTemplate = {
    name: 'Triangle (test)',
    generate(_random) {
        // Simple triangle: (0,0) → (0.5, 0.3) → (1, 0)
        // Using straight Bézier segments (control points on the line)
        return [
            { x: 0, y: 0 },
            { x: 0.1, y: 0 }, { x: 0.2, y: 0.1 }, { x: 0.5, y: 0.3 },
            { x: 0.8, y: 0.1 }, { x: 0.9, y: 0 }, { x: 1, y: 0 },
        ];
    },
};

function approxEqual(a: number, b: number, tol = 1) {
    expect(Math.abs(a - b)).toBeLessThan(tol);
}

// ---------------------------------------------------------------------------
// mergeTabIntoCurve
// ---------------------------------------------------------------------------

describe('mergeTabIntoCurve', () => {
    it('merges a tab into a straight line', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const placement: TabPlacement = {
            tStart: 0.3,
            tEnd: 0.7,
            isTab: true,
        };

        const result = mergeTabIntoCurve(
            line, placement, triangleTabTemplate, seededRandom(42),
        );

        // Result should start and end at the same points
        approxEqual(result.start.x, 0);
        approxEqual(result.start.y, 0);
        approxEqual(result.end.x, 100);
        approxEqual(result.end.y, 0);

        // Result should have more segments than the original line
        expect(result.segments.length).toBeGreaterThan(1);
    });

    it('tab protrudes above the line (positive Y for isTab=true)', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const placement: TabPlacement = {
            tStart: 0.3,
            tEnd: 0.7,
            isTab: true,
        };

        const result = mergeTabIntoCurve(
            line, placement, triangleTabTemplate, seededRandom(42),
        );

        // Sample the middle — should be above y=0 (negative Y in screen = above)
        // Tab protrudes in +Y of normalized space, which maps to left-of-travel.
        // For a horizontal left-to-right line, left-of-travel is -Y in screen space.
        const mid = result.pointAt(0.5);
        // The tab should deviate from the original line
        expect(mid.y).not.toBeCloseTo(0, 0);
    });

    it('blank protrudes in opposite direction from tab', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });

        const tabResult = mergeTabIntoCurve(
            line,
            { tStart: 0.3, tEnd: 0.7, isTab: true },
            triangleTabTemplate,
            seededRandom(42),
        );

        const blankResult = mergeTabIntoCurve(
            line,
            { tStart: 0.3, tEnd: 0.7, isTab: false },
            triangleTabTemplate,
            seededRandom(42),
        );

        // Tab and blank should deviate in opposite Y directions
        const tabMid = tabResult.pointAt(0.5);
        const blankMid = blankResult.pointAt(0.5);
        expect(Math.sign(tabMid.y)).not.toBe(Math.sign(blankMid.y));
    });

    it('preserves the before and after segments', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const placement: TabPlacement = {
            tStart: 0.3,
            tEnd: 0.7,
            isTab: true,
        };

        const result = mergeTabIntoCurve(
            line, placement, triangleTabTemplate, seededRandom(42),
        );

        // The start of the curve should follow the original line closely
        const earlyPoint = result.pointAt(0.1);
        expect(earlyPoint.y).toBeCloseTo(0, 0);

        // The end of the curve should also follow the original line
        const latePoint = result.pointAt(0.9);
        expect(latePoint.y).toBeCloseTo(0, 0);
    });

    it('works with a multi-segment Bézier curve', () => {
        const poly = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 17, y: 3 }, { x: 33, y: 7 }, { x: 50, y: 10 },
            { x: 67, y: 7 }, { x: 83, y: 3 }, { x: 100, y: 0 },
        ]);
        const placement: TabPlacement = {
            tStart: 0.3,
            tEnd: 0.7,
            isTab: true,
        };

        const result = mergeTabIntoCurve(
            poly, placement, triangleTabTemplate, seededRandom(42),
        );

        // Should still start and end at the same points
        approxEqual(result.start.x, 0);
        approxEqual(result.start.y, 0);
        approxEqual(result.end.x, 100);
        approxEqual(result.end.y, 0);
    });

    it('works with the classic tab template', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const placement: TabPlacement = {
            tStart: 0.3,
            tEnd: 0.7,
            isTab: true,
        };

        const result = mergeTabIntoCurve(
            line, placement, classicTabTemplate, seededRandom(42),
        );

        expect(result.segments.length).toBeGreaterThan(3);
        approxEqual(result.start.x, 0);
        approxEqual(result.end.x, 100);
    });
});

// ---------------------------------------------------------------------------
// computeTabPlacement
// ---------------------------------------------------------------------------

describe('computeTabPlacement', () => {
    it('returns null for edges shorter than minEdgeLength', () => {
        const shortLine = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const result = computeTabPlacement(
            shortLine,
            { ...DEFAULT_TAB_PLACEMENT, minEdgeLength: 20 },
            seededRandom(42),
        );
        expect(result).toBeNull();
    });

    it('returns a placement for sufficiently long edges', () => {
        const longLine = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = computeTabPlacement(
            longLine,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
        );
        expect(result).not.toBeNull();
        expect(result!.tStart).toBeGreaterThan(0);
        expect(result!.tEnd).toBeLessThan(1);
        expect(result!.tStart).toBeLessThan(result!.tEnd);
    });

    it('places tab roughly centred', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = computeTabPlacement(
            line,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
        );
        expect(result).not.toBeNull();
        const centre = (result!.tStart + result!.tEnd) / 2;
        expect(centre).toBeGreaterThan(0.2);
        expect(centre).toBeLessThan(0.8);
    });

    it('returns different isTab values across calls (randomized)', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const random = seededRandom(42);
        const results: boolean[] = [];
        for (let i = 0; i < 20; i++) {
            const p = computeTabPlacement(line, DEFAULT_TAB_PLACEMENT, random);
            if (p) results.push(p.isTab);
        }
        // Should have both true and false
        expect(results).toContain(true);
        expect(results).toContain(false);
    });
});

// ---------------------------------------------------------------------------
// mergeTabsIntoCuts
// ---------------------------------------------------------------------------

describe('mergeTabsIntoCuts', () => {
    it('leaves border curves unchanged', () => {
        const border = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
        ];

        const result = mergeTabsIntoCuts(
            border,
            new Set([0, 1, 2, 3]),
            classicTabTemplate,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
        );

        // All border curves should be returned as-is
        expect(result).toHaveLength(4);
        for (let i = 0; i < 4; i++) {
            expect(result[i]).toBe(border[i]); // same reference
        }
    });

    it('modifies internal cuts by adding tabs', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),      // border
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),  // border
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),  // border
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),      // border
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),    // internal
        ];

        const result = mergeTabsIntoCuts(
            curves,
            new Set([0, 1, 2, 3]),
            classicTabTemplate,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
        );

        expect(result).toHaveLength(5);
        // Internal cut should have been modified (more segments)
        expect(result[4].segments.length).toBeGreaterThan(
            curves[4].segments.length,
        );
    });

    it('modified curves still start and end at original endpoints', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
        ];

        const result = mergeTabsIntoCuts(
            curves,
            new Set([0, 1, 2, 3]),
            classicTabTemplate,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
        );

        // Internal cut endpoints should be preserved
        approxEqual(result[4].start.x, 0);
        approxEqual(result[4].start.y, 50);
        approxEqual(result[4].end.x, 100);
        approxEqual(result[4].end.y, 50);
    });

    it('produces valid curves for DCEL consumption', () => {
        // After tab merging, we should be able to build a DCEL.
        // Use a large enough grid so tabs don't protrude past borders.
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }),
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }),
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 }),
        ];

        const withTabs = mergeTabsIntoCuts(
            curves,
            new Set([0, 1, 2, 3]),
            classicTabTemplate,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
        );

        const result = buildDCEL({ curves: withTabs });
        const inner = result.faces.filter(f => !f.isOuter);
        // Should produce at least 2 inner faces (tabs may create
        // additional faces if they cross border lines)
        expect(inner.length).toBeGreaterThanOrEqual(2);
    });
});
