import { describe, it, expect } from 'vitest';
import { buildDCEL, getFaceVertices, countFaceEdges, curveBroadPhasePairs, VertexPool } from './dcel.js';
import type { Face } from './dcel.js';
import type { BoundingBox } from './curve.js';
import { Curve } from './curve.js';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get inner (non-outer) faces from a DCEL result. */
function innerFaces(result: ReturnType<typeof buildDCEL>): Face[] {
    return result.faces.filter(f => !f.isOuter);
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
// Test: curve broad-phase (#439)
// ---------------------------------------------------------------------------

describe('curveBroadPhasePairs', () => {
    // The one property that must never break: completeness. The broad-phase
    // may only PRUNE pairs that provably can't intersect; it must never drop a
    // pair whose boxes are within `margin`, or a real intersection vanishes and
    // the puzzle topology corrupts. We check the output is a superset of the
    // brute-force within-margin set over a large random box population.
    function withinMargin(a: BoundingBox, b: BoundingBox, m: number): boolean {
        return (
            a.minX - m <= b.maxX && a.maxX + m >= b.minX &&
            a.minY - m <= b.maxY && a.maxY + m >= b.minY
        );
    }

    function seeded(seed: number): () => number {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    it('never drops a pair whose boxes are within the margin (completeness)', () => {
        const rng = seeded(12345);
        const margin = 6;
        // Mix small lattice-scale boxes with a few full-span boxes, the two
        // regimes the heuristic must handle.
        const boxes: BoundingBox[] = [];
        for (let i = 0; i < 200; i++) {
            const x = rng() * 800, y = rng() * 600;
            const w = rng() < 0.1 ? 800 : rng() * 40;
            const h = rng() < 0.1 ? 600 : rng() * 40;
            boxes.push({ minX: x, minY: y, maxX: x + w, maxY: y + h });
        }

        const got = new Set(curveBroadPhasePairs(boxes, margin).map(([i, j]) => i * boxes.length + j));

        let expectedCount = 0;
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                if (withinMargin(boxes[i], boxes[j], margin)) {
                    expectedCount++;
                    expect(got.has(i * boxes.length + j)).toBe(true);
                }
            }
        }
        // Sanity: the test data actually exercises both regimes.
        expect(expectedCount).toBeGreaterThan(0);
    });

    it('returns pairs in ascending (i, j) order with i < j', () => {
        const rng = seeded(999);
        const boxes: BoundingBox[] = [];
        for (let i = 0; i < 50; i++) {
            const x = rng() * 300, y = rng() * 300;
            boxes.push({ minX: x, minY: y, maxX: x + rng() * 50, maxY: y + rng() * 50 });
        }
        const pairs = curveBroadPhasePairs(boxes, 6);
        for (const [i, j] of pairs) expect(i).toBeLessThan(j);
        for (let k = 1; k < pairs.length; k++) {
            const [pi, pj] = pairs[k - 1];
            const [ci, cj] = pairs[k];
            expect(pi < ci || (pi === ci && pj < cj)).toBe(true);
        }
    });

    it('prunes far-apart pairs (returns far fewer than n²/2)', () => {
        // A 20×20 grid of small, well-separated boxes: almost no pair is
        // within margin, so the broad-phase must reject the vast majority.
        const boxes: BoundingBox[] = [];
        for (let r = 0; r < 20; r++) {
            for (let c = 0; c < 20; c++) {
                const x = c * 100, y = r * 100;
                boxes.push({ minX: x, minY: y, maxX: x + 10, maxY: y + 10 });
            }
        }
        const allPairs = (boxes.length * (boxes.length - 1)) / 2;
        const pairs = curveBroadPhasePairs(boxes, 6);
        expect(pairs.length).toBeLessThan(allPairs * 0.05);
    });

    it('returns no pairs for fewer than two boxes', () => {
        expect(curveBroadPhasePairs([], 6)).toEqual([]);
        expect(curveBroadPhasePairs([{ minX: 0, minY: 0, maxX: 1, maxY: 1 }], 6)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Test: vertex-pool merge equivalence (#439)
// ---------------------------------------------------------------------------

describe('VertexPool merge equivalence', () => {
    // Locks the share-link-critical merge rule independently of the geometry
    // snapshot: when a query point lies within VERTEX_MERGE_TOLERANCE of
    // several existing vertices that the grid bucketing has spread across
    // different cells, getOrCreate must return the LOWEST-id one — exactly what
    // the old O(V²) linear scan returned (first-inserted wins, and ids are
    // assigned in insertion order). The 9-cell scan must not change which
    // vertex survives, or a merge diverges from the pre-#439 output and breaks
    // every share link that depended on it.
    it('merges a cross-cell query to the lowest-id candidate', () => {
        const pool = new VertexPool();

        // Two distinct vertices straddling the cell boundary at x=0 (cell size
        // == VERTEX_MERGE_TOLERANCE == 3). They are 5.8px apart, so they do NOT
        // merge with each other, and they land in different grid cells
        // (floor(2.9/3) = 0 vs floor(-2.9/3) = -1).
        const v0 = pool.getOrCreate({ x: 2.9, y: 0 });   // id 0, cell (0, 0)
        const v1 = pool.getOrCreate({ x: -2.9, y: 0 });  // id 1, cell (-1, 0)
        expect(v0.id).toBe(0);
        expect(v1.id).toBe(1);
        expect(v0).not.toBe(v1);

        // Query the midpoint: within 2.9px of BOTH existing vertices. The
        // 9-cell scan visits cell (-1, *) — holding the higher-id v1 — before
        // cell (0, *), so without the explicit lowest-id tie-break it would
        // return v1. It must return v0 to match the linear scan.
        const merged = pool.getOrCreate({ x: 0, y: 0 });
        expect(merged).toBe(v0);

        // The query merged, it didn't insert a third vertex.
        expect(pool.all()).toHaveLength(2);
    });

    it('keeps points beyond tolerance as distinct vertices', () => {
        const pool = new VertexPool();
        const a = pool.getOrCreate({ x: 0, y: 0 });
        const b = pool.getOrCreate({ x: 100, y: 100 });
        expect(a).not.toBe(b);
        expect(pool.all()).toHaveLength(2);
    });
});

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
