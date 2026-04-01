import { describe, it, expect } from 'vitest';
import {
    mergeTabIntoCurve,
    computeTabPlacement,
    mergeTabsIntoCuts,
    DEFAULT_TAB_PLACEMENT,
} from './tab-merge.js';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabTemplate } from '../composable/tab-shapes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

/** Simple triangle tab template for testing. */
const triangleTabTemplate: TabTemplate = {
    name: 'Triangle (test)',
    generate() {
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
        const result = mergeTabIntoCurve(
            line, 0.5, true, triangleTabTemplate, seededRandom(42),
        );

        approxEqual(result.start.x, 0);
        approxEqual(result.start.y, 0);
        approxEqual(result.end.x, 100);
        approxEqual(result.end.y, 0);
        expect(result.segments.length).toBeGreaterThan(1);
    });

    it('tab protrudes away from the line', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = mergeTabIntoCurve(
            line, 0.5, true, triangleTabTemplate, seededRandom(42),
        );

        const mid = result.pointAt(0.5);
        expect(mid.y).not.toBeCloseTo(0, 0);
    });

    it('blank protrudes in opposite direction from tab', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const tabResult = mergeTabIntoCurve(
            line, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        const blankResult = mergeTabIntoCurve(
            line, 0.5, false, triangleTabTemplate, seededRandom(42),
        );

        const tabMid = tabResult.pointAt(0.5);
        const blankMid = blankResult.pointAt(0.5);
        expect(Math.sign(tabMid.y)).not.toBe(Math.sign(blankMid.y));
    });

    it('preserves the before and after segments', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = mergeTabIntoCurve(
            line, 0.5, true, triangleTabTemplate, seededRandom(42),
        );

        const earlyPoint = result.pointAt(0.05);
        expect(earlyPoint.y).toBeCloseTo(0, 0);

        const latePoint = result.pointAt(0.95);
        expect(latePoint.y).toBeCloseTo(0, 0);
    });

    it('works with the classic tab template', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = mergeTabIntoCurve(
            line, 0.5, true, classicTabTemplate, seededRandom(42),
        );

        expect(result.segments.length).toBeGreaterThan(3);
        approxEqual(result.start.x, 0);
        approxEqual(result.end.x, 100);
    });

    it('works with a multi-segment Bézier curve', () => {
        const curve = Curve.fromBezierPath([
            { x: 0, y: 0 },
            { x: 17, y: 3 }, { x: 33, y: 7 }, { x: 50, y: 10 },
            { x: 67, y: 7 }, { x: 83, y: 3 }, { x: 100, y: 0 },
        ]);
        const result = mergeTabIntoCurve(
            curve, 0.5, true, triangleTabTemplate, seededRandom(42),
        );

        approxEqual(result.start.x, 0);
        approxEqual(result.start.y, 0);
        approxEqual(result.end.x, 100);
        approxEqual(result.end.y, 0);
    });
});

// ---------------------------------------------------------------------------
// computeTabPlacement
// ---------------------------------------------------------------------------

describe('computeTabPlacement', () => {
    it('returns null for edges shorter than minEdgeLength', () => {
        const shortLine = Curve.line({ x: 0, y: 0 }, { x: 10, y: 0 });
        const result = computeTabPlacement(shortLine, DEFAULT_TAB_PLACEMENT, seededRandom(42));
        expect(result).toBeNull();
    });

    it('returns a placement for sufficiently long edges', () => {
        const longLine = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = computeTabPlacement(longLine, DEFAULT_TAB_PLACEMENT, seededRandom(42));
        expect(result).not.toBeNull();
        expect(result!.tCenter).toBeGreaterThan(0.2);
        expect(result!.tCenter).toBeLessThan(0.8);
    });

    it('returns different isTab values across calls', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const random = seededRandom(42);
        const results: boolean[] = [];
        for (let i = 0; i < 20; i++) {
            const p = computeTabPlacement(line, DEFAULT_TAB_PLACEMENT, random);
            if (p) results.push(p.isTab);
        }
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
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }),
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }),
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),
        ];
        const result = mergeTabsIntoCuts(
            border, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
        );
        expect(result).toHaveLength(4);
        for (let i = 0; i < 4; i++) {
            expect(result[i]).toBe(border[i]);
        }
    });

    it('modifies internal cuts by adding tabs', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }),
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }),
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 }),
        ];
        const result = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
        );
        expect(result).toHaveLength(5);
        expect(result[4].segments.length).toBeGreaterThan(curves[4].segments.length);
    });

    it('modified curves still start and end at original endpoints', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }),
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }),
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 }),
        ];
        const result = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
        );
        approxEqual(result[4].start.x, 0);
        approxEqual(result[4].start.y, 100);
        approxEqual(result[4].end.x, 200);
        approxEqual(result[4].end.y, 100);
    });

    it('produces valid curves for DCEL consumption', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }),
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }),
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 }),
        ];
        const withTabs = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
        );
        const result = buildDCEL({ curves: withTabs });
        const inner = result.faces.filter(f => !f.isOuter);
        expect(inner.length).toBeGreaterThanOrEqual(2);
    });
});
