/**
 * Tests for the per-edge tab application harness.
 *
 * The harness must:
 * - skip border edges (one side is the outer face) by emitting their
 *   original sub-curve into the final cut set unchanged
 * - call the tab generator once per eligible half-edge pair
 *   (each shared edge counted once)
 * - reject candidates that introduce new crossings against
 *   other edge curves, falling back to the original sub-curve
 * - return one curve per twin pair in the final cut set
 *
 * Tabs whose bump folds back through their own parent edge are NOT
 * rejected — those self-intersections are intended to materialise as
 * extra small faces in a second `buildDCEL` pass run on the returned
 * cut set, and are then absorbed downstream by the adaptive
 * auto-grouping pass in the topology generator.
 */

import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import type { TabGenerator } from './plugin-types.js';

describe('applyTabs', () => {
    it('returns one curve per twin pair (4 internal + 4 border = 8 curves for a 2×2 grid)', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        const result = applyTabs(graph, makeFlatTabGenerator(), makeSeededRandom(1));

        // A 2×2 grid yields 4 cells with 12 half-edge pairs total
        // (4 outer borders split into 8 segments by the inner cross,
        // plus 4 internal edges from the inner cross). Each twin pair
        // produces exactly one entry in the final cut set.
        const expectedPairs = graph.halfEdges.length / 2;
        expect(result).toHaveLength(expectedPairs);
    });

    it('rebuilds an equivalent topology when fed back into buildDCEL', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        const result = applyTabs(graph, makeFlatTabGenerator(), makeSeededRandom(1));
        const rebuilt = buildDCEL({ curves: result });

        // Flat-tab generator emits no candidate, so all sub-curves are
        // originals. Pass 2 should yield the same face count as pass 1.
        expect(rebuilt.faces.length).toBe(graph.faces.length);
    });

    it('skips border edges (no tab applied where one side is the outer face)', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        let calls = 0;
        const generator: TabGenerator = {
            id: 'count',
            generate: (_edge) => { calls++; return null; },
        };
        applyTabs(graph, generator, makeSeededRandom(1));

        // 2x2 grid: 4 cells, internal edges = 4 (2 horiz + 2 vert,
        // each as a single shared edge after dedup). The outer-facing
        // border edges should not invoke the generator.
        // Each internal shared edge is visited ONCE (not once per
        // half-edge), so calls = 4.
        expect(calls).toBe(4);
    });

    it('rejects a tab candidate that crosses another edge', () => {
        const baseCurves = simpleGridCurves(2, 2);
        const graph = buildDCEL({ curves: baseCurves });

        // A "bad" generator that always returns a curve protruding
        // far enough to cross adjacent edges.
        const protrusion = 1000;
        const badGenerator: TabGenerator = {
            id: 'bad',
            generate: (edge) => {
                const mid = edge.pointAt(0.5);
                // build a wedge that pokes way out to (mid.x, mid.y + 1000)
                return Curve.fromBezierPath([
                    edge.start,
                    edge.start,
                    { x: mid.x, y: mid.y + protrusion },
                    { x: mid.x, y: mid.y + protrusion },
                    { x: mid.x, y: mid.y + protrusion },
                    edge.end,
                    edge.end,
                ]);
            },
        };

        // Find a representative internal half-edge curve before tab
        // application; expect the same Curve reference to appear in
        // the returned cut set (rejected → original emitted).
        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const originalCurve = internalEdge.curve;

        const result = applyTabs(graph, badGenerator, makeSeededRandom(1));

        // All bad-candidate curves are rejected, so every internal
        // sub-curve in the result is one of the originals from the
        // graph.
        expect(result).toContain(originalCurve);
    });

    it('honors a custom TabPolicy that filters by length', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(3, 3) });
        let calls = 0;
        const generator: TabGenerator = {
            id: 'count',
            generate: () => { calls++; return null; },
        };
        // Edges in a 3×3 grid of 100-unit cells are 100 units long.
        // A policy that requires length > 200 should skip every edge.
        applyTabs(graph, generator, makeSeededRandom(1), {
            policy: (e) => e.length > 200,
        });
        expect(calls).toBe(0);

        // Inverse: policy admits every edge.
        let calls2 = 0;
        const generator2: TabGenerator = {
            id: 'count2',
            generate: () => { calls2++; return null; },
        };
        applyTabs(graph, generator2, makeSeededRandom(1), {
            policy: () => true,
        });
        expect(calls2).toBe(12); // 3×3 grid: (3-1)*3 horizontals + 3*(3-1) verticals = 6 + 6 = 12 internal edges
    });

    it('accepts a tab candidate that does not cross any other edge', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // A "good" generator: a small bump that stays well inside its
        // own edge's neighbourhood.
        const goodGenerator: TabGenerator = {
            id: 'good',
            generate: (edge) => {
                const mid = edge.pointAt(0.5);
                const start = edge.start;
                const end = edge.end;
                // Tiny perpendicular bump
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const px = -dy / len * 1; // 1 px perpendicular
                const py = dx / len * 1;
                return Curve.fromBezierPath([
                    start,
                    start,
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    end,
                    end,
                ]);
            },
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const originalCurve = internalEdge.curve;

        const result = applyTabs(graph, goodGenerator, makeSeededRandom(1));

        // The accepted candidates replace the original sub-curves, so
        // the original Curve reference should NOT appear in the result.
        expect(result).not.toContain(originalCurve);
    });

    it('accepts a normal one-sided tab bump (sanity check)', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // A normal tab shape: linear before/after overlap with a bump
        // that stays on one side of the parent. This must NOT be
        // rejected by the fold-back check.
        const tabGenerator: TabGenerator = {
            id: 'normal-tab',
            generate: (edge) => {
                const start = edge.start;
                const end = edge.end;
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const tx = dx / len, ty = dy / len;
                const nx = -ty, ny = tx;
                const at = (along: number, perp: number) => ({
                    x: start.x + tx * along + nx * perp,
                    y: start.y + ty * along + ny * perp,
                });
                return Curve.fromBezierPath([
                    at(0, 0),
                    at(0.05 * len, 0), at(0.15 * len, 0), at(0.2 * len, 0),
                    // Bump: stays above the edge (perp = -10).
                    at(0.3 * len, -10), at(0.7 * len, -10), at(0.8 * len, 0),
                    at(0.85 * len, 0), at(0.95 * len, 0), at(1.0 * len, 0),
                ]);
            },
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const originalCurve = internalEdge.curve;

        const result = applyTabs(graph, tabGenerator, makeSeededRandom(1));

        expect(result).not.toContain(originalCurve);
    });

    it('tab self-crossing produces an additional face after a second buildDCEL pass', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const facesBefore = graph.faces.filter(f => !f.isOuter).length;

        // A synthetic candidate whose bump dips back through the
        // parent line: start → reach out perpendicular, then dive
        // BACK across the chord so the curve self-intersects, then
        // return to the endpoint. The intersection point is not at
        // either endpoint, so the second DCEL pass picks it up as a
        // new vertex and splits the chord into multiple faces.
        const foldBackGenerator: TabGenerator = {
            id: 'fold-back',
            generate: (edge) => {
                const start = edge.start;
                const end = edge.end;
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const tx = dx / len, ty = dy / len;
                const nx = -ty, ny = tx;
                const at = (along: number, perp: number) => ({
                    x: start.x + tx * along + nx * perp,
                    y: start.y + ty * along + ny * perp,
                });
                // Path goes UP, then crosses BACK across the chord
                // (positive perp), then returns up to the endpoint —
                // creating a loop that self-intersects.
                return Curve.fromBezierPath([
                    at(0, 0),
                    at(0.2 * len, -30), at(0.3 * len, -30), at(0.4 * len, 0),
                    at(0.45 * len, 20), at(0.55 * len, 20), at(0.6 * len, 0),
                    at(0.7 * len, -30), at(0.8 * len, -30), at(1.0 * len, 0),
                ]);
            },
        };

        const finalCurves = applyTabs(graph, foldBackGenerator, makeSeededRandom(1));
        const rebuilt = buildDCEL({ curves: finalCurves });
        const facesAfter = rebuilt.faces.filter(f => !f.isOuter).length;

        // The second DCEL pass should see each self-crossing as a new
        // vertex, splitting each tab-decorated edge into additional
        // sub-faces. A 2×2 grid has 4 internal edges; even one of
        // them folding back must add at least one face.
        expect(facesAfter).toBeGreaterThan(facesBefore);
    });
});

// Helpers

function simpleGridCurves(cols: number, rows: number): Curve[] {
    const W = cols * 100, H = rows * 100;
    const curves: Curve[] = [
        Curve.line({ x: 0, y: 0 }, { x: W, y: 0 }),
        Curve.line({ x: W, y: 0 }, { x: W, y: H }),
        Curve.line({ x: W, y: H }, { x: 0, y: H }),
        Curve.line({ x: 0, y: H }, { x: 0, y: 0 }),
    ];
    for (let r = 1; r < rows; r++) {
        curves.push(Curve.line({ x: 0, y: r * 100 }, { x: W, y: r * 100 }));
    }
    for (let c = 1; c < cols; c++) {
        curves.push(Curve.line({ x: c * 100, y: 0 }, { x: c * 100, y: H }));
    }
    return curves;
}

function makeFlatTabGenerator(): TabGenerator {
    return { id: 'flat', generate: () => null };
}

function makeSeededRandom(seed: number): () => number {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
