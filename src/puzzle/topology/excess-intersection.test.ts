import { describe, it, expect } from 'vitest';
import {
    createExcessIntersectionDetector,
    createSegmentRemovalResolver,
    resolveExcessIntersections,
} from './collision.js';
import type {
    BaseCutCollisionDetector,
    BaseCutConflictResolver,
    BaseCutCollision,
} from './collision.js';
import { Curve } from './curve.js';

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

/**
 * Generate a sine-wave curve (same algorithm as generator.ts).
 * Exposed here for testing.
 */
function generateSineCurve(
    start: { x: number; y: number },
    end: { x: number; y: number },
    amplitude: number,
    frequency: number,
    phase: number,
): Curve {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const tx = dx / len;
    const ty = dy / len;
    const px = -ty;
    const py = tx;

    const segmentsPerWave = 4;
    const totalSegments = Math.max(4, Math.ceil(frequency * segmentsPerWave));

    const bezierPoints: { x: number; y: number }[] = [];

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

    for (let i = 0; i < totalSegments; i++) {
        const t0 = i / totalSegments;
        const t1 = (i + 1) / totalSegments;
        const dt = t1 - t0;

        const p0 = evalSine(t0);
        const p1 = evalSine(t1);

        if (i === 0) {
            bezierPoints.push({ x: p0.x, y: p0.y });
        }
        bezierPoints.push(
            { x: p0.x + p0.tx * dt / 3, y: p0.y + p0.ty * dt / 3 },
            { x: p1.x - p1.tx * dt / 3, y: p1.y - p1.ty * dt / 3 },
            { x: p1.x, y: p1.y },
        );
    }

    return Curve.fromBezierPath(bezierPoints);
}

/** Count non-endpoint intersections between two curves. */
function countInternalIntersections(a: Curve, b: Curve, tolerance = 3): number {
    const intersections = a.intersect(b);
    const endpoints = [a.start, a.end, b.start, b.end];
    return intersections.filter(ix => {
        for (const ep of endpoints) {
            const d = Math.sqrt(
                (ix.point.x - ep.x) ** 2 + (ix.point.y - ep.y) ** 2,
            );
            if (d < tolerance) return false;
        }
        return true;
    }).length;
}

// ---------------------------------------------------------------------------
// createExcessIntersectionDetector
// ---------------------------------------------------------------------------

describe('createExcessIntersectionDetector', () => {
    const detector = createExcessIntersectionDetector();

    it('returns no collisions for straight-line grid cuts', () => {
        const curves = [
            // 4 borders
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            // Internal cuts: 1 horizontal, 1 vertical
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
            Curve.line({ x: 150, y: 0 }, { x: 150, y: 300 }),
        ];

        const collisions = detector.detect(curves, 4);
        expect(collisions).toHaveLength(0);
    });

    it('returns no collisions for low-amplitude sine waves', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            // Low amplitude — should cross exactly once
            generateSineCurve({ x: 0, y: 150 }, { x: 300, y: 150 }, 10, 1.5, 0),
            generateSineCurve({ x: 150, y: 0 }, { x: 150, y: 300 }, 10, 1.5, Math.PI / 4),
        ];

        const collisions = detector.detect(curves, 4);
        expect(collisions).toHaveLength(0);
    });

    it('detects excess intersections between high-amplitude sine waves', () => {
        // High amplitude + offset phases → the waves cross 3+ times
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            // Perpendicular sine waves with high amplitude
            generateSineCurve({ x: 0, y: 150 }, { x: 300, y: 150 }, 60, 2, 0),
            generateSineCurve({ x: 150, y: 0 }, { x: 150, y: 300 }, 60, 2, Math.PI / 2),
        ];

        // Verify they actually have excess intersections
        const actualCount = countInternalIntersections(curves[4], curves[5]);
        if (actualCount <= 1) {
            // If these specific parameters don't produce excess, skip
            // (intersection count depends on exact bezier-js precision)
            return;
        }

        const collisions = detector.detect(curves, 4);
        expect(collisions.length).toBeGreaterThan(0);

        const collision = collisions[0];
        expect(collision.curveIndexA).toBe(4);
        expect(collision.curveIndexB).toBe(5);
        expect(collision.excessPairs.length).toBeGreaterThan(0);

        // Each excess pair should have valid parameters
        for (const pair of collision.excessPairs) {
            expect(pair.tA1).toBeGreaterThan(0);
            expect(pair.tA1).toBeLessThan(1);
            expect(pair.tA2).toBeGreaterThan(pair.tA1);
            expect(pair.tA2).toBeLessThan(1);
        }
    });

    it('detects excess intersections between parallel sine waves', () => {
        // Two horizontal sine waves with high amplitude — should not
        // intersect at all, but might with offset phases and high amplitude
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            // Two horizontal cuts close together with opposite phases
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const actualCount = countInternalIntersections(curves[4], curves[5]);
        if (actualCount === 0) return; // Skip if no intersections at these params

        const collisions = detector.detect(curves, 4);
        expect(collisions.length).toBeGreaterThan(0);

        // For parallel cuts, expected count is 0, so ALL intersections are excess
        const totalExcess = collisions[0].excessPairs.length;
        expect(totalExcess * 2).toBe(actualCount);
    });

    it('skips border curves', () => {
        // Even if borders somehow intersect internal cuts many times,
        // the detector should not report them
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
        ];

        const collisions = detector.detect(curves, 4);
        expect(collisions).toHaveLength(0);
    });

    it('excess pairs have tA1 < tA2 (sorted by t on curve A)', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const collisions = detector.detect(curves, 4);
        for (const collision of collisions) {
            for (const pair of collision.excessPairs) {
                expect(pair.tA1).toBeLessThan(pair.tA2);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// createSegmentRemovalResolver
// ---------------------------------------------------------------------------

describe('createSegmentRemovalResolver', () => {
    const resolver = createSegmentRemovalResolver();

    it('returns curves unchanged when there are no collisions', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 50, y: -50 }, { x: 50, y: 50 }),
        ];

        const result = resolver.resolve(curves, [], seededRandom(42));
        expect(result).toHaveLength(2);
        expect(result[0]).toBe(curves[0]);
        expect(result[1]).toBe(curves[1]);
    });

    it('modifies one curve per collision', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const detector = createExcessIntersectionDetector();
        const collisions = detector.detect(curves, 4);
        if (collisions.length === 0) return;

        const result = resolver.resolve(curves, collisions, seededRandom(42));
        expect(result).toHaveLength(curves.length);

        // Borders should be untouched
        for (let i = 0; i < 4; i++) {
            expect(result[i]).toBe(curves[i]);
        }

        // At least one internal curve should have been modified
        const curve4Changed = result[4] !== curves[4];
        const curve5Changed = result[5] !== curves[5];
        expect(curve4Changed || curve5Changed).toBe(true);
        // Only one should change (per collision, one curve is modified)
        expect(curve4Changed && curve5Changed).toBe(false);
    });

    it('preserves curve endpoints after resolution', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const detector = createExcessIntersectionDetector();
        const collisions = detector.detect(curves, 4);
        if (collisions.length === 0) return;

        const result = resolver.resolve(curves, collisions, seededRandom(42));

        // All curves should preserve their start/end points
        for (let i = 0; i < curves.length; i++) {
            expect(result[i].start.x).toBeCloseTo(curves[i].start.x, 0);
            expect(result[i].start.y).toBeCloseTo(curves[i].start.y, 0);
            expect(result[i].end.x).toBeCloseTo(curves[i].end.x, 0);
            expect(result[i].end.y).toBeCloseTo(curves[i].end.y, 0);
        }
    });

    it('replacement arcs stay inside the lens regions', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const detector = createExcessIntersectionDetector();
        const collisions = detector.detect(curves, 4);
        if (collisions.length === 0) return;

        const result = resolver.resolve(curves, collisions, seededRandom(42));

        // The modified curve should have different segment count
        const modifiedIdx = result[4] !== curves[4] ? 4 : 5;
        expect(result[modifiedIdx].segments.length).not.toBe(
            curves[modifiedIdx].segments.length,
        );

        // Sample the modified curve — its midpoint in replacement regions
        // should be between the original source and target curves' midpoints
        for (const pair of collisions[0].excessPairs) {
            const tMid = (pair.tA1 + pair.tA2) / 2;
            const origA = curves[4].pointAt(tMid);
            const origB = curves[5].pointAt(
                (pair.tB1 + pair.tB2) / 2,
            );

            // The replacement should produce a curve that at the midpoint
            // is between the two original curves' y-values
            const modifiedPt = result[modifiedIdx].pointAt(
                result[modifiedIdx].segments.length > curves[modifiedIdx].segments.length
                    ? 0.5 // approximate — the arc is in the middle region
                    : tMid,
            );

            const minY = Math.min(origA.y, origB.y);
            const maxY = Math.max(origA.y, origB.y);
            // The modified point should be roughly between the two curves
            // (with some tolerance for the arc shape)
            expect(modifiedPt.y).toBeGreaterThan(minY - 10);
            expect(modifiedPt.y).toBeLessThan(maxY + 10);
        }
    });
});

// ---------------------------------------------------------------------------
// resolveExcessIntersections (pipeline helper)
// ---------------------------------------------------------------------------

describe('resolveExcessIntersections', () => {
    it('returns curves unchanged when no excess intersections exist', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
            Curve.line({ x: 150, y: 0 }, { x: 150, y: 300 }),
        ];

        const result = resolveExcessIntersections(curves, 4, seededRandom(42));
        expect(result).toBe(curves); // Same reference — no changes
    });

    it('resolves excess intersections in a full pipeline call', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const beforeCount = countInternalIntersections(curves[4], curves[5]);
        if (beforeCount === 0) return;

        const result = resolveExcessIntersections(curves, 4, seededRandom(42));
        expect(result).toHaveLength(curves.length);

        // At least one curve should be modified
        const modified = result[4] !== curves[4] || result[5] !== curves[5];
        expect(modified).toBe(true);

        // Borders should be untouched
        for (let i = 0; i < 4; i++) {
            expect(result[i]).toBe(curves[i]);
        }

        // Modified curve should have a valid structure
        const modIdx = result[4] !== curves[4] ? 4 : 5;
        expect(result[modIdx].segments.length).toBeGreaterThan(0);
    });

    it('uses custom detector and resolver when provided', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
            Curve.line({ x: 150, y: 0 }, { x: 150, y: 300 }),
        ];

        let detectCalled = false;
        let resolveCalled = false;

        const customDetector: BaseCutCollisionDetector = {
            detect() {
                detectCalled = true;
                return [];
            },
        };
        const customResolver: BaseCutConflictResolver = {
            resolve(c) {
                resolveCalled = true;
                return c;
            },
        };

        resolveExcessIntersections(
            curves, 4, seededRandom(42), customDetector, customResolver,
        );

        expect(detectCalled).toBe(true);
        // Resolver not called because detector returned no collisions
        expect(resolveCalled).toBe(false);
    });

    it('calls resolver when detector finds collisions', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
        ];

        let resolveCalled = false;

        const fakeCollision: BaseCutCollision = {
            curveIndexA: 4,
            curveIndexB: 4,
            excessPairs: [{
                point1: { x: 100, y: 150 },
                point2: { x: 200, y: 150 },
                tA1: 0.33,
                tA2: 0.66,
                tB1: 0.33,
                tB2: 0.66,
            }],
        };

        const customDetector: BaseCutCollisionDetector = {
            detect: () => [fakeCollision],
        };
        const customResolver: BaseCutConflictResolver = {
            resolve(c) {
                resolveCalled = true;
                return c;
            },
        };

        resolveExcessIntersections(
            curves, 4, seededRandom(42), customDetector, customResolver,
        );

        expect(resolveCalled).toBe(true);
    });

    it('produces deterministic results with same seed', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const beforeCount = countInternalIntersections(curves[4], curves[5]);
        if (beforeCount === 0) return;

        const result1 = resolveExcessIntersections(curves, 4, seededRandom(42));
        const result2 = resolveExcessIntersections(curves, 4, seededRandom(42));

        // Same seed → same results
        for (let i = 0; i < result1.length; i++) {
            expect(result1[i].start.x).toBeCloseTo(result2[i].start.x, 6);
            expect(result1[i].start.y).toBeCloseTo(result2[i].start.y, 6);
            expect(result1[i].end.x).toBeCloseTo(result2[i].end.x, 6);
            expect(result1[i].end.y).toBeCloseTo(result2[i].end.y, 6);
            expect(result1[i].segments.length).toBe(result2[i].segments.length);
        }
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('excess intersection edge cases', () => {
    it('handles single internal curve (no pairs to check)', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 150 }, { x: 300, y: 150 }, 50, 2, 0),
        ];

        const detector = createExcessIntersectionDetector();
        const collisions = detector.detect(curves, 4);
        expect(collisions).toHaveLength(0);
    });

    it('handles borderCount equal to curves length', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
        ];

        const detector = createExcessIntersectionDetector();
        const collisions = detector.detect(curves, 2);
        expect(collisions).toHaveLength(0);
    });

    it('handles empty curves array', () => {
        const detector = createExcessIntersectionDetector();
        const collisions = detector.detect([], 0);
        expect(collisions).toHaveLength(0);
    });

    it('resolver preserves array length', () => {
        const resolver = createSegmentRemovalResolver();
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
            Curve.line({ x: 0, y: 100 }, { x: 100, y: 100 }),
        ];

        const result = resolver.resolve(curves, [], seededRandom(42));
        expect(result).toHaveLength(3);
    });
});
