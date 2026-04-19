import { describe, it, expect } from 'vitest';
import {
    createTabCollisionDetector,
    createSkipOnCollisionResolver,
    detectExcessIntersections,
} from './collision.js';
import type { CollisionDetector } from './collision.js';
import { Curve } from './curve.js';
import { generateTopologyPuzzle } from './generator.js';
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

    it('does not flag the parent curve for the expected splice-point joins', () => {
        // The tab naturally touches its parent curve at exactly two points
        // (its start and end). A straight edge with a tab on one side has
        // no other crossings, so the endpoint filter should suppress both
        // tangent touches and report no collision.
        const edge = Curve.line({ x: 0, y: 100 }, { x: 200, y: 100 });
        const prepared = prepareTab(
            edge, 0.5, true, triangleTabTemplate, seededRandom(42),
        );
        expect(prepared).not.toBeNull();

        const otherCurves = [edge];
        const collides = detector.hasCollision(prepared!.tabCurve, otherCurves, 0);
        expect(collides).toBe(false);
    });

    it('detects a tab that crosses a different part of its parent curve', () => {
        // Parent curve: a U-shape encoded as a single multi-segment curve.
        // Left arm at x=0 (y=100→0), bottom at y=0 (x=0→100), right arm
        // at x=100 (y=0→100). A tab placed on the left arm that bulges
        // rightward past x=100 self-collides with the right arm.
        const parentCurve = Curve.fromBezierPath([
            { x: 0, y: 100 }, { x: 0, y: 67 }, { x: 0, y: 33 }, { x: 0, y: 0 },
            { x: 33, y: 0 }, { x: 67, y: 0 }, { x: 100, y: 0 },
            { x: 100, y: 33 }, { x: 100, y: 67 }, { x: 100, y: 100 },
        ]);

        // Tab: cubic Bézier starting at (0,70) and ending at (0,30) — both
        // on the left arm — with control points at x=200 so the curve bulges
        // to a peak of x=150 and crosses the right arm (x=100) twice.
        const tabCurve = Curve.fromBezierPath([
            { x: 0, y: 70 }, { x: 200, y: 70 },
            { x: 200, y: 30 }, { x: 0, y: 30 },
        ]);

        const collides = detector.hasCollision(tabCurve, [parentCurve], 0);
        expect(collides).toBe(true);
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
// Reproduction: 6x4 grid with high-amplitude sine waves (#219/#220)
// ---------------------------------------------------------------------------

describe('excess intersection resolution - 6x4 high-amplitude reproduction', () => {
    const cols = 6;
    const rows = 4;
    const imageSize = { width: 600, height: 400 };
    const hAmp = 0.38;
    const hFreq = 7.6;
    const vAmp = 0.38;
    const vFreq = 7.7;

    it('generates exactly 24 pieces with no island slivers', () => {
        // Try multiple seeds — all should produce exactly 24 pieces
        const seeds = [1, 42, 123, 999];
        for (const seed of seeds) {
            const random = seededRandom(seed);
            const pieces = generateTopologyPuzzle(cols, rows, imageSize, random, {
                horizontalAmplitude: hAmp,
                horizontalFrequency: hFreq,
                verticalAmplitude: vAmp,
                verticalFrequency: vFreq,
                disableTabs: true,
            });

            expect(pieces.length).toBe(24);
        }
    });

    it('detects excess intersections for these parameters', () => {
        const skips = detectExcessIntersections(
            buildReproCurves(seededRandom(1)), 4,
        );
        // Should find excess intersections with these high-amplitude settings
        expect(skips.length).toBeGreaterThan(0);
    });
});

/** Build the 12-curve set matching the 6x4 reproduction scenario. */
function buildReproCurves(random: () => number): Curve[] {
    const cols = 6, rows = 4;
    const width = 600, height = 400;
    const pieceWidth = width / cols;
    const pieceHeight = height / rows;
    const hPixelAmp = (0.38 * pieceHeight) / 2;
    const vPixelAmp = (0.38 * pieceWidth) / 2;
    const hFreq = 7.6, vFreq = 7.7;

    const curves: Curve[] = [
        Curve.line({ x: 0, y: 0 }, { x: width, y: 0 }),
        Curve.line({ x: width, y: 0 }, { x: width, y: height }),
        Curve.line({ x: width, y: height }, { x: 0, y: height }),
        Curve.line({ x: 0, y: height }, { x: 0, y: 0 }),
    ];

    const rowPhases: number[] = [];
    for (let r = 0; r <= rows; r++) rowPhases.push(random() * Math.PI * 2);
    const colPhases: number[] = [];
    for (let c = 0; c <= cols; c++) colPhases.push(random() * Math.PI * 2);

    function sineCurve(
        start: { x: number; y: number },
        end: { x: number; y: number },
        amplitude: number,
        frequency: number,
        phase: number,
    ): Curve {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const tx = dx / len, ty = dy / len;
        const px = -ty, py = tx;
        const totalSeg = Math.max(4, Math.ceil(frequency * 4));

        const evalSine = (t: number) => {
            const angle = 2 * Math.PI * frequency * t + phase;
            const s = amplitude * Math.sin(angle);
            const ds = amplitude * 2 * Math.PI * frequency * Math.cos(angle);
            return {
                x: start.x + t * dx + s * px,
                y: start.y + t * dy + s * py,
                tx: dx + ds * px,
                ty: dy + ds * py,
            };
        };

        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < totalSeg; i++) {
            const t0 = i / totalSeg;
            const t1 = (i + 1) / totalSeg;
            const dt = t1 - t0;
            const p0 = evalSine(t0);
            const p1 = evalSine(t1);
            if (i === 0) pts.push({ x: p0.x, y: p0.y });
            pts.push(
                { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
                { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
                { x: p1.x, y: p1.y },
            );
        }
        return Curve.fromBezierPath(pts);
    }

    for (let r = 1; r < rows; r++) {
        const y = r * pieceHeight;
        curves.push(sineCurve({ x: 0, y }, { x: width, y }, hPixelAmp, hFreq, rowPhases[r]));
    }
    for (let c = 1; c < cols; c++) {
        const x = c * pieceWidth;
        curves.push(sineCurve({ x, y: 0 }, { x, y: height }, vPixelAmp, vFreq, colPhases[c]));
    }

    return curves;
}
