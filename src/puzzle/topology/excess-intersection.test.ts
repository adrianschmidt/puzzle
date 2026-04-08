import { describe, it, expect } from 'vitest';
import {
    createExcessIntersectionDetector,
    buildIntersectionCaps,
    detectExcessIntersections,
} from './collision.js';
import type { BaseCutCollisionDetector } from './collision.js';
import { Curve } from './curve.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


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
        if (actualCount <= 1) return;

        const collisions = detector.detect(curves, 4);
        expect(collisions.length).toBeGreaterThan(0);

        const collision = collisions[0];
        expect(collision.curveIndexA).toBe(4);
        expect(collision.curveIndexB).toBe(5);
        expect(collision.excessPairs.length).toBeGreaterThan(0);

        for (const pair of collision.excessPairs) {
            expect(pair.tA1).toBeGreaterThan(0);
            expect(pair.tA1).toBeLessThan(1);
            expect(pair.tA2).toBeGreaterThan(pair.tA1);
            expect(pair.tA2).toBeLessThan(1);
        }
    });

    it('detects excess intersections between parallel sine waves', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const actualCount = countInternalIntersections(curves[4], curves[5]);
        if (actualCount === 0) return;

        const collisions = detector.detect(curves, 4);
        expect(collisions.length).toBeGreaterThan(0);

        const totalExcess = collisions[0].excessPairs.length;
        expect(totalExcess * 2).toBe(actualCount);
    });

    it('skips border curves', () => {
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
// buildIntersectionCaps
// ---------------------------------------------------------------------------

describe('buildIntersectionCaps', () => {
    it('returns one cap per collision', () => {
        // Two perpendicular lines that cross once (expected = 1)
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),     // border
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }), // border
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }), // border
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),     // border
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),   // horizontal
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 }),   // vertical
        ];

        const caps = buildIntersectionCaps(curves, [{
            curveIndexA: 4,
            curveIndexB: 5,
            excessPairs: [{
                point1: { x: 40, y: 50 },
                point2: { x: 60, y: 50 },
                tA1: 0.4, tA2: 0.6, tB1: 0.4, tB2: 0.6,
            }],
        }]);

        expect(caps).toHaveLength(1);
        expect(caps[0].curveIndexA).toBe(4);
        expect(caps[0].curveIndexB).toBe(5);
        expect(caps[0].expectedCount).toBe(1); // baselines cross once
        expect(caps[0].expectedPoints).toHaveLength(1);
        expect(caps[0].expectedPoints[0].x).toBeCloseTo(50, 0);
        expect(caps[0].expectedPoints[0].y).toBeCloseTo(50, 0);
    });
});

// ---------------------------------------------------------------------------
// detectExcessIntersections (pipeline helper)
// ---------------------------------------------------------------------------

describe('detectExcessIntersections', () => {
    it('returns empty when no excess intersections exist', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
            Curve.line({ x: 150, y: 0 }, { x: 150, y: 300 }),
        ];

        const skips = detectExcessIntersections(curves, 4);
        expect(skips).toHaveLength(0);
    });

    it('returns skip points when excess intersections exist', () => {
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

        const skips = detectExcessIntersections(curves, 4);
        expect(skips.length).toBeGreaterThan(0);
        // Each skip should reference valid curve indices
        for (const skip of skips) {
            expect(skip.curveIndexA).toBeGreaterThanOrEqual(4);
            expect(skip.curveIndexB).toBeGreaterThanOrEqual(4);
        }
    });

    it('uses custom detector when provided', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 300, y: 0 }),
            Curve.line({ x: 300, y: 0 }, { x: 300, y: 300 }),
            Curve.line({ x: 300, y: 300 }, { x: 0, y: 300 }),
            Curve.line({ x: 0, y: 300 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 150 }, { x: 300, y: 150 }),
        ];

        let detectCalled = false;
        const customDetector: BaseCutCollisionDetector = {
            detect() {
                detectCalled = true;
                return [];
            },
        };

        detectExcessIntersections(curves, 4, customDetector);
        expect(detectCalled).toBe(true);
    });

    it('produces deterministic results', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 400, y: 0 }),
            Curve.line({ x: 400, y: 0 }, { x: 400, y: 400 }),
            Curve.line({ x: 400, y: 400 }, { x: 0, y: 400 }),
            Curve.line({ x: 0, y: 400 }, { x: 0, y: 0 }),
            generateSineCurve({ x: 0, y: 180 }, { x: 400, y: 180 }, 40, 2, 0),
            generateSineCurve({ x: 0, y: 220 }, { x: 400, y: 220 }, 40, 2, Math.PI),
        ];

        const result1 = detectExcessIntersections(curves, 4);
        const result2 = detectExcessIntersections(curves, 4);

        expect(result1.length).toBe(result2.length);
        for (let i = 0; i < result1.length; i++) {
            expect(result1[i].curveIndexA).toBe(result2[i].curveIndexA);
            expect(result1[i].curveIndexB).toBe(result2[i].curveIndexB);
            expect(result1[i].expectedCount).toBe(result2[i].expectedCount);
            expect(result1[i].expectedPoints.length).toBe(result2[i].expectedPoints.length);
            for (let j = 0; j < result1[i].expectedPoints.length; j++) {
                expect(result1[i].expectedPoints[j].x).toBeCloseTo(result2[i].expectedPoints[j].x, 6);
                expect(result1[i].expectedPoints[j].y).toBeCloseTo(result2[i].expectedPoints[j].y, 6);
            }
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
});
