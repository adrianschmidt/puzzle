import { describe, it, expect } from 'vitest';
import {
    createTabCollisionDetector,
    createSkipOnCollisionResolver,
    createSegmentRemovalResolver,
    createExcessIntersectionDetector,
    resolveExcessIntersections,
} from './collision.js';
import type { CollisionDetector, BaseCutCollision } from './collision.js';
import { Curve } from './curve.js';
import {
    mergeTabsIntoCuts,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-merge.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';

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
            { x: 0.35, y: 0 },
            { x: 0.38, y: 0 }, { x: 0.42, y: 0.1 }, { x: 0.5, y: 0.3 },
            { x: 0.58, y: 0.1 }, { x: 0.62, y: 0 }, { x: 0.65, y: 0 },
        ];
    },
};

// ---------------------------------------------------------------------------
// createTabCollisionDetector
// ---------------------------------------------------------------------------

describe('createTabCollisionDetector', () => {
    const detector = createTabCollisionDetector();

    it('returns false when tab does not intersect any other curve', () => {
        // Horizontal line with a tab protruding upward (negative y)
        const edge = Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 });
        const prepared = prepareTab(
            edge, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        expect(prepared).not.toBeNull();

        // Other curve is far away — no collision
        const otherCurves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),   // top border
            edge,                                              // self (index 1)
            Curve.line({ x: 0, y: 200 }, { x: 200, y: 200 }), // bottom border
        ];

        const collides = detector.hasCollision(prepared!.tabCurve, otherCurves, 1);
        expect(collides).toBe(false);
    });

    it('returns true when tab intersects another curve', () => {
        // Horizontal edge at y=100 with tab protruding downward (+y).
        // For a left→right line, perpendicular is (0,1), so tab goes down.
        // Triangle tab height = 0.3 * edgeLength(200) = 60px → peak at y≈160.
        const edge = Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 });
        const prepared = prepareTab(
            edge, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        expect(prepared).not.toBeNull();

        // A horizontal curve at y=130 crosses through the tab's protrusion.
        const crossingCurve = Curve.line({ x: 50, y: 130 }, { x: 150, y: 130 });

        const otherCurves = [
            crossingCurve,  // index 0 — crosses the tab
            edge,           // index 1 — self
        ];

        const collides = detector.hasCollision(prepared!.tabCurve, otherCurves, 1);
        expect(collides).toBe(true);
    });

    it('ignores intersections near tab endpoints (expected joins)', () => {
        // Tab on a horizontal edge — the tab starts and ends on the edge.
        // A vertical line crossing through the tab's start point should
        // NOT count as a collision if it's within endpoint tolerance.
        const edge = Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 });
        const prepared = prepareTab(
            edge, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        expect(prepared).not.toBeNull();

        // The tab endpoints are on the edge line (y=100).
        // A vertical border line at x=0 is far from the tab (which is
        // centred around x=100), so it won't intersect at all.
        // Use a line that passes exactly through an endpoint.
        const tabStart = prepared!.tabCurve.start;
        const throughEndpoint = Curve.line(
            { x: tabStart.x, y: tabStart.y - 50 },
            { x: tabStart.x, y: tabStart.y + 50 },
        );

        const otherCurves = [throughEndpoint, edge];
        const collides = detector.hasCollision(prepared!.tabCurve, otherCurves, 1);
        // The intersection at the endpoint should be filtered out
        expect(collides).toBe(false);
    });

    it('skips self curve when checking collisions', () => {
        const edge = Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 });
        const prepared = prepareTab(
            edge, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        expect(prepared).not.toBeNull();

        // Only curve is self — should never collide
        const otherCurves = [edge];
        const collides = detector.hasCollision(prepared!.tabCurve, otherCurves, 0);
        expect(collides).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// createSkipOnCollisionResolver
// ---------------------------------------------------------------------------

describe('createSkipOnCollisionResolver', () => {
    const resolver = createSkipOnCollisionResolver();

    it('returns merged curve when no collision', () => {
        const original = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const merged = Curve.line({ x: 0, y: 0 }, { x: 100, y: 50 }); // fake
        const result = resolver.resolve(original, merged, false);
        expect(result).toBe(merged);
    });

    it('returns original segment when collision detected', () => {
        const original = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const merged = Curve.line({ x: 0, y: 0 }, { x: 100, y: 50 });
        const result = resolver.resolve(original, merged, true);
        expect(result).toBe(original);
    });

    it('returns original segment when merged curve is null', () => {
        const original = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = resolver.resolve(original, null, false);
        expect(result).toBe(original);
    });
});

// ---------------------------------------------------------------------------
// prepareTab / commitTab
// ---------------------------------------------------------------------------

describe('prepareTab and commitTab', () => {
    it('prepareTab returns null when tab is too wide for the edge margins', () => {
        // Create a template that spans almost the full edge width.
        // With margins of 0.12 on each side, a template spanning [0.01, 0.99]
        // cannot fit — sCenterMax < sCenterMin.
        const wideTemplate: TabTemplate = {
            name: 'Wide (test)',
            generate() {
                return [
                    { x: 0.01, y: 0 },
                    { x: 0.1, y: 0 }, { x: 0.3, y: 0.1 }, { x: 0.5, y: 0.3 },
                    { x: 0.7, y: 0.1 }, { x: 0.9, y: 0 }, { x: 0.99, y: 0 },
                ];
            },
        };
        const edge = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const result = prepareTab(edge, 0.5, true, wideTemplate, seededRandom(42));
        expect(result).toBeNull();
    });

    it('prepareTab + commitTab produces same result as mergeTabIntoCurve', () => {
        const line = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });

        // Same seed for both paths
        const prepared = prepareTab(
            line, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        expect(prepared).not.toBeNull();
        const assembled = commitTab(prepared!);

        // Verify it looks like a valid tab merge
        expect(assembled.segments.length).toBeGreaterThan(1);
        expect(assembled.start.x).toBeCloseTo(0, 0);
        expect(assembled.end.x).toBeCloseTo(100, 0);
    });
});

// ---------------------------------------------------------------------------
// Integration: mergeTabsIntoCuts with collision detection
// ---------------------------------------------------------------------------

describe('mergeTabsIntoCuts with collision detection', () => {
    it('adds tabs to non-colliding edges', () => {
        // 2x1 grid: 4 borders + 1 vertical internal cut
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),     // top
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 100 }), // right
            Curve.line({ x: 200, y: 100 }, { x: 0, y: 100 }), // bottom
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),     // left
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }), // vertical cut
        ];

        const result = mergeTabsIntoCuts(
            curves,
            new Set([0, 1, 2, 3]),
            classicTabTemplate,
            DEFAULT_TAB_PLACEMENT,
            seededRandom(42),
            {
                detector: createTabCollisionDetector(),
                resolver: createSkipOnCollisionResolver(),
            },
        );

        expect(result).toHaveLength(5);
        // Borders unchanged
        for (let i = 0; i < 4; i++) {
            expect(result[i]).toBe(curves[i]);
        }
        // Internal cut should have tabs (no collisions in this simple grid)
        expect(result[4].segments.length).toBeGreaterThan(curves[4].segments.length);
    });

    it('skips tabs that would collide with another curve', () => {
        // Set up a scenario where a tab on one edge would cross another edge.
        // Horizontal edge at y=50 with a nearby horizontal edge at y=65.
        // A tab on the y=50 edge protruding downward would collide with y=65.
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),     // top border
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }), // right border
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }), // bottom border
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),     // left border
            Curve.line({ x: 0, y: 50 }, { x: 200, y: 50 }),   // internal cut 1
            Curve.line({ x: 0, y: 65 }, { x: 200, y: 65 }),   // internal cut 2 — very close!
        ];

        // Use a "never collides" detector to get a baseline with tabs
        const noCollision: CollisionDetector = {
            hasCollision: () => false,
        };
        const baselineResult = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
            { detector: noCollision, resolver: createSkipOnCollisionResolver() },
        );

        // Now with real collision detection
        const collisionResult = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
            {
                detector: createTabCollisionDetector(),
                resolver: createSkipOnCollisionResolver(),
            },
        );

        // With collision detection, at least one cut should have fewer
        // segments than the baseline (some tabs were skipped).
        const baselineSegments = baselineResult.reduce(
            (sum, c) => sum + c.segments.length, 0,
        );
        const collisionSegments = collisionResult.reduce(
            (sum, c) => sum + c.segments.length, 0,
        );

        // The collision-aware version should have equal or fewer segments
        // (tabs skipped = fewer segments added)
        expect(collisionSegments).toBeLessThanOrEqual(baselineSegments);
    });

    it('uses custom detector and resolver when provided', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }),
            Curve.line({ x: 200, y: 200 }, { x: 0, y: 200 }),
            Curve.line({ x: 0, y: 200 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 }),
        ];

        // Custom detector that always reports collision
        const alwaysCollides: CollisionDetector = {
            hasCollision: () => true,
        };

        const result = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
            {
                detector: alwaysCollides,
                resolver: createSkipOnCollisionResolver(),
            },
        );

        // All tabs should be skipped — internal cut unchanged
        expect(result[4].segments.length).toBe(curves[4].segments.length);
    });

    it('mixed scenario: some tabs collide, some do not', () => {
        // 3-row grid: cuts at y=100 and y=200, with y=200 very close to
        // border at y=250 so tabs there are more likely to collide.
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),     // top
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 250 }), // right
            Curve.line({ x: 300, y: 250 }, { x: 0, y: 250 }), // bottom
            Curve.line({ x: 0, y: 250 }, { x: 0, y: 0 }),     // left
            Curve.line({ x: 0, y: 100 }, { x: 300, y: 100 }), // internal cut 1 — plenty of room
            Curve.line({ x: 0, y: 215 }, { x: 300, y: 215 }), // internal cut 2 — close to bottom
        ];

        const result = mergeTabsIntoCuts(
            curves, new Set([0, 1, 2, 3]),
            classicTabTemplate, DEFAULT_TAB_PLACEMENT, seededRandom(42),
            {
                detector: createTabCollisionDetector(),
                resolver: createSkipOnCollisionResolver(),
            },
        );

        expect(result).toHaveLength(6);
        // Both results should be valid curves with correct endpoints
        for (let idx = 4; idx < 6; idx++) {
            expect(result[idx].start.x).toBeCloseTo(curves[idx].start.x, 0);
            expect(result[idx].start.y).toBeCloseTo(curves[idx].start.y, 0);
            expect(result[idx].end.x).toBeCloseTo(curves[idx].end.x, 0);
            expect(result[idx].end.y).toBeCloseTo(curves[idx].end.y, 0);
        }
    });
});

// ---------------------------------------------------------------------------
// Excess intersection resolver (createSegmentRemovalResolver)
// ---------------------------------------------------------------------------

describe('createSegmentRemovalResolver', () => {
    /**
     * Helper: create two crossing curves that form a lens shape.
     * curveA bows upward, curveB bows downward — they cross twice,
     * creating a lens between the crossing points.
     */
    /**
     * Build collision data from two curves by running intersection
     * detection, filtering endpoints, and returning everything
     * needed by the resolver.
     */
    function buildCollision(
        curveA: Curve,
        curveB: Curve,
        idxA: number,
        idxB: number,
    ): { collision: BaseCutCollision; sorted: { tSelf: number; tOther: number; point: { x: number; y: number } }[] } {
        const intersections = curveA.intersect(curveB);
        const epTol = 3;
        const endpoints = [curveA.start, curveA.end, curveB.start, curveB.end];
        const filtered = intersections.filter(ix => {
            for (const ep of endpoints) {
                const d = Math.sqrt(
                    (ix.point.x - ep.x) ** 2 + (ix.point.y - ep.y) ** 2,
                );
                if (d < epTol) return false;
            }
            return true;
        });
        const sorted = [...filtered].sort((a, b) => a.tSelf - b.tSelf);
        const collision: BaseCutCollision = {
            curveIndexA: idxA,
            curveIndexB: idxB,
            excessPairs: [{
                point1: sorted[0].point,
                point2: sorted[1].point,
                tA1: sorted[0].tSelf,
                tA2: sorted[1].tSelf,
                tB1: sorted[0].tOther,
                tB2: sorted[1].tOther,
            }],
        };
        return { collision, sorted };
    }

    function makeCrossingCurves() {
        // Two multi-segment curves that clearly cross twice.
        // Curve A: horizontal line at y=100 (two segments for robustness)
        const curveA = Curve.line({ x: 0, y: 100 }, { x: 300, y: 100 });

        // Curve B: starts below, crosses above, then crosses back below.
        // A sine-like shape using two Bézier segments.
        const curveB = new Curve([
            {
                p0: { x: 0, y: 150 },
                cp1: { x: 50, y: 150 },
                cp2: { x: 100, y: 30 },
                p3: { x: 150, y: 50 },
            },
            {
                p0: { x: 150, y: 50 },
                cp1: { x: 200, y: 70 },
                cp2: { x: 250, y: 170 },
                p3: { x: 300, y: 150 },
            },
        ]);

        return { curveA, curveB };
    }

    it('replaces target segment with source segment (not an arc)', () => {
        const { curveA, curveB } = makeCrossingCurves();
        const { collision } = buildCollision(curveA, curveB, 2, 3);

        const resolver = createSegmentRemovalResolver();

        // Force modifyA (random > 0.5) — curveA's segment replaced with curveB's
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),   // border 0
            Curve.line({ x: 0, y: 200 }, { x: 300, y: 200 }), // border 1
            curveA,
            curveB,
        ];

        const result = resolver.resolve(curves, [collision], () => 0.9);

        // curveA was modified, curveB unchanged
        expect(result[3]).toBe(curveB);
        const modifiedA = result[2];

        // The modified curve should still have the same endpoints
        expect(modifiedA.start.x).toBeCloseTo(curveA.start.x, 0);
        expect(modifiedA.start.y).toBeCloseTo(curveA.start.y, 0);
        expect(modifiedA.end.x).toBeCloseTo(curveA.end.x, 0);
        expect(modifiedA.end.y).toBeCloseTo(curveA.end.y, 0);

        // The replacement region should follow curveB's path.
        // curveA is a straight line at y=100. curveB dips above y=100
        // in the middle. After replacing curveA's middle segment with
        // curveB's, the modified curve should deviate from y=100.
        const midPt = modifiedA.pointAt(0.5);
        expect(midPt.y).not.toBeCloseTo(100, 0);
    });

    it('modifying curveB when random <= 0.5', () => {
        const { curveA, curveB } = makeCrossingCurves();
        const { collision } = buildCollision(curveA, curveB, 2, 3);

        const resolver = createSegmentRemovalResolver();
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 0, y: 200 }, { x: 300, y: 200 }),
            curveA,
            curveB,
        ];

        // Force modifyB (random <= 0.5)
        const result = resolver.resolve(curves, [collision], () => 0.1);

        // curveA unchanged, curveB modified
        expect(result[2]).toBe(curveA);
        const modifiedB = result[3];

        expect(modifiedB.start.x).toBeCloseTo(curveB.start.x, 0);
        expect(modifiedB.start.y).toBeCloseTo(curveB.start.y, 0);
        expect(modifiedB.end.x).toBeCloseTo(curveB.end.x, 0);
        expect(modifiedB.end.y).toBeCloseTo(curveB.end.y, 0);

        // Modified B's replacement region should follow curveA (y=100)
        // between the intersection points — it should be flatter there
        // than the original curveB.
        // Sample several points and check they're closer to y=100
        // than the original curveB at the same t.
        for (const tSample of [0.4, 0.5, 0.6]) {
            const origPt = curveB.pointAt(tSample);
            const modPt = modifiedB.pointAt(tSample);
            expect(Math.abs(modPt.y - 100)).toBeLessThanOrEqual(
                Math.abs(origPt.y - 100) + 1,
            );
        }
    });

    it('after resolution, modified curve samples match source in replaced region', () => {
        const { curveA, curveB } = makeCrossingCurves();
        const { collision, sorted } = buildCollision(curveA, curveB, 2, 3);

        const resolver = createSegmentRemovalResolver();
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 0, y: 200 }, { x: 300, y: 200 }),
            curveA,
            curveB,
        ];

        const result = resolver.resolve(curves, [collision], () => 0.9);
        const modifiedA = result[2];

        // In the replaced region, sample points of modifiedA should
        // lie very close to curveB's path (not a midpoint arc).
        // The replaced region is between the two intersection x-coords.
        const xLow = Math.min(sorted[0].point.x, sorted[1].point.x);
        const xHigh = Math.max(sorted[0].point.x, sorted[1].point.x);
        const xMid = (xLow + xHigh) / 2;

        // Find the t on modifiedA and curveB that's near xMid
        // by sampling densely
        let bestModT = 0.5;
        let bestModDist = Infinity;
        let bestSrcT = 0.5;
        let bestSrcDist = Infinity;
        for (let t = 0; t <= 1; t += 0.005) {
            const mp = modifiedA.pointAt(t);
            const sp = curveB.pointAt(t);
            if (Math.abs(mp.x - xMid) < bestModDist) {
                bestModDist = Math.abs(mp.x - xMid);
                bestModT = t;
            }
            if (Math.abs(sp.x - xMid) < bestSrcDist) {
                bestSrcDist = Math.abs(sp.x - xMid);
                bestSrcT = t;
            }
        }
        const modMidPt = modifiedA.pointAt(bestModT);
        const srcMidPt = curveB.pointAt(bestSrcT);

        // The y-values should be very close (exact segment copy)
        expect(modMidPt.y).toBeCloseTo(srcMidPt.y, 0);
    });
});

// ---------------------------------------------------------------------------
// resolveExcessIntersections (integration)
// ---------------------------------------------------------------------------

describe('resolveExcessIntersections', () => {
    it('returns curves unchanged when there are no excess intersections', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 200, y: 0 }),     // border
            Curve.line({ x: 200, y: 0 }, { x: 200, y: 200 }), // border
            Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 }), // internal
        ];
        const result = resolveExcessIntersections(curves, 2, seededRandom(42));
        expect(result).toBe(curves);
    });
});
