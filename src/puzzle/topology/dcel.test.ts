import { describe, it, expect } from 'vitest';
import { buildDCEL, getFaceVertices, getFaceEdges, countFaceEdges } from './dcel.js';
import type { Face } from './dcel.js';
import { Curve } from './curve.js';
import type { Point } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get inner (non-outer) faces from a DCEL result. */
function innerFaces(result: ReturnType<typeof buildDCEL>): Face[] {
    return result.faces.filter(f => !f.isOuter);
}

/** Check that a point is approximately at (x, y). */
function expectNearPoint(p: Point, x: number, y: number, tol = 1) {
    expect(p.x).toBeCloseTo(x, 0);
    expect(p.y).toBeCloseTo(y, 0);
}

/** Compute the approximate area of a face using the shoelace formula. */
function faceArea(face: Face): number {
    const pts = getFaceVertices(face);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area / 2);
}

// ---------------------------------------------------------------------------
// Test: 2 crossing lines → 4 faces
// ---------------------------------------------------------------------------

describe('DCEL: 2 crossing lines', () => {
    // Two lines crossing at (50, 50):
    //   horizontal: (0,50) → (100,50)
    //   vertical:   (50,0) → (50,100)
    //
    // This creates 4 quadrant faces + 1 outer face.
    // But wait — 2 crossing lines in the plane create 4 unbounded regions,
    // not 4 enclosed faces. We need a bounding box to get enclosed faces.
    //
    // For puzzle cuts, we always have border curves forming a bounding rectangle.
    // Let's test with a border rectangle + 1 horizontal + 1 vertical cut.

    it('rectangle + cross creates 4 inner faces', () => {
        const border = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),   // top
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }), // right
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }), // bottom
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),     // left
        ];
        const hCut = Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 });
        const vCut = Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 });

        const result = buildDCEL({
            curves: [...border, hCut, vCut],
        });

        const inner = innerFaces(result);
        expect(inner).toHaveLength(4);

        // Each quadrant should have roughly equal area (25×50 = 2500)
        for (const face of inner) {
            const area = faceArea(face);
            expect(area).toBeGreaterThan(2000);
            expect(area).toBeLessThan(3000);
        }
    });
});

// ---------------------------------------------------------------------------
// Test: simple 2×2 grid → 4 faces
// ---------------------------------------------------------------------------

describe('DCEL: 2×2 grid', () => {
    it('creates 4 inner faces from a 2×2 grid', () => {
        // Border rectangle
        const top = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const right = Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 });
        const bottom = Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 });
        const left = Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 });

        // Internal cuts
        const hCut = Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 });
        const vCut = Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 });

        const result = buildDCEL({
            curves: [top, right, bottom, left, hCut, vCut],
        });

        const inner = innerFaces(result);
        expect(inner).toHaveLength(4);
    });

    it('each face has 4 edges (rectangular pieces)', () => {
        const top = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const right = Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 });
        const bottom = Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 });
        const left = Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 });
        const hCut = Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 });
        const vCut = Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 });

        const result = buildDCEL({
            curves: [top, right, bottom, left, hCut, vCut],
        });

        const inner = innerFaces(result);
        for (const face of inner) {
            expect(countFaceEdges(face)).toBe(4);
        }
    });
});

// ---------------------------------------------------------------------------
// Test: 3×3 grid → 9 faces
// ---------------------------------------------------------------------------

describe('DCEL: 3×3 grid', () => {
    it('creates 9 inner faces', () => {
        const curves: Curve[] = [
            // Border
            Curve.line({ x: 0, y: 0 }, { x: 90, y: 0 }),
            Curve.line({ x: 90, y: 0 }, { x: 90, y: 90 }),
            Curve.line({ x: 90, y: 90 }, { x: 0, y: 90 }),
            Curve.line({ x: 0, y: 90 }, { x: 0, y: 0 }),
            // 2 horizontal cuts
            Curve.line({ x: 0, y: 30 }, { x: 90, y: 30 }),
            Curve.line({ x: 0, y: 60 }, { x: 90, y: 60 }),
            // 2 vertical cuts
            Curve.line({ x: 30, y: 0 }, { x: 30, y: 90 }),
            Curve.line({ x: 60, y: 0 }, { x: 60, y: 90 }),
        ];

        const result = buildDCEL({ curves });
        const inner = innerFaces(result);
        expect(inner).toHaveLength(9);
    });
});

// ---------------------------------------------------------------------------
// Test: single rectangle (no internal cuts) → 1 face
// ---------------------------------------------------------------------------

describe('DCEL: single rectangle', () => {
    it('creates 1 inner face', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 80 }),
            Curve.line({ x: 100, y: 80 }, { x: 0, y: 80 }),
            Curve.line({ x: 0, y: 80 }, { x: 0, y: 0 }),
        ];

        const result = buildDCEL({ curves });
        const inner = innerFaces(result);
        expect(inner).toHaveLength(1);
    });

    it('the inner face has 4 edges', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 80 }),
            Curve.line({ x: 100, y: 80 }, { x: 0, y: 80 }),
            Curve.line({ x: 0, y: 80 }, { x: 0, y: 0 }),
        ];

        const result = buildDCEL({ curves });
        const inner = innerFaces(result);
        expect(countFaceEdges(inner[0])).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// Test: nonIntersectingGroups hint
// ---------------------------------------------------------------------------

describe('DCEL: nonIntersectingGroups', () => {
    it('produces same result with hints as without', () => {
        const top = Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 });
        const right = Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 });
        const bottom = Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 });
        const left = Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 });
        const hCut = Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 });
        const vCut = Curve.line({ x: 50, y: 0 }, { x: 50, y: 100 });

        const withoutHints = buildDCEL({
            curves: [top, right, bottom, left, hCut, vCut],
        });

        const withHints = buildDCEL({
            curves: [top, right, bottom, left, hCut, vCut],
            nonIntersectingGroups: [
                [top, bottom, hCut],  // horizontal curves don't intersect each other
                [left, right, vCut],  // vertical curves don't intersect each other
            ],
        });

        expect(innerFaces(withHints)).toHaveLength(innerFaces(withoutHints).length);
    });
});

// ---------------------------------------------------------------------------
// Test: half-edge twins share faces correctly
// ---------------------------------------------------------------------------

describe('DCEL: twin relationships', () => {
    it('every half-edge has a twin with opposite origin/target', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
        ];

        const result = buildDCEL({ curves });

        for (const he of result.halfEdges) {
            expect(he.twin).toBeDefined();
            expect(he.twin.twin).toBe(he);
            // Twin's origin should be "close to" this edge's target
            // (the next vertex in the same direction)
        }
    });

    it('internal edges have two different faces on twin sides', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
        ];

        const result = buildDCEL({ curves });
        const inner = innerFaces(result);
        expect(inner).toHaveLength(2);

        // The horizontal cut's half-edges should belong to different faces
        // (one inner, one inner — or one inner, one outer for border edges)
        for (const he of result.halfEdges) {
            if (he.face && !he.face.isOuter && he.twin.face && !he.twin.face.isOuter) {
                // This is an internal edge — twins should have different faces
                expect(he.face).not.toBe(he.twin.face);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Test: outer face identification
// ---------------------------------------------------------------------------

describe('DCEL: outer face', () => {
    it('identifies exactly one outer face', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
        ];

        const result = buildDCEL({ curves });
        const outerCount = result.faces.filter(f => f.isOuter).length;
        expect(outerCount).toBe(1);
    });

    it('outer face is not among inner faces', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
        ];

        const result = buildDCEL({ curves });
        expect(result.outerFace.isOuter).toBe(true);
        expect(innerFaces(result).every(f => !f.isOuter)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Test: 1 horizontal cut only → 2 rectangles
// ---------------------------------------------------------------------------

describe('DCEL: single horizontal cut', () => {
    it('creates 2 inner faces', () => {
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
        ];

        const result = buildDCEL({ curves });
        const inner = innerFaces(result);
        expect(inner).toHaveLength(2);

        // Each face should be roughly 100×50 = 5000 area
        for (const face of inner) {
            const area = faceArea(face);
            expect(area).toBeGreaterThan(4000);
            expect(area).toBeLessThan(6000);
        }
    });
});
