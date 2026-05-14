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
 * - on acceptance, emit each piece of the returned decomposition as
 *   a separate entry in the final cut set (so the second DCEL pass
 *   can detect intra-decomposition fold-back crossings as ordinary
 *   cross-curve intersections)
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
    it('with a flat generator (null tabs), emits one curve per twin pair', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        const result = applyTabs(graph, makeFlatTabGenerator(), makeSeededRandom(1));

        // A 2×2 grid yields 4 cells with 12 half-edge pairs total
        // (4 outer borders split into 8 segments by the inner cross,
        // plus 4 internal edges from the inner cross). With the
        // flat generator every internal pair falls back to its
        // original sub-curve — one entry per twin pair. (An
        // accepting generator with a multi-piece decomposition would
        // emit MORE than one entry per accepted internal pair.)
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
                return [Curve.fromBezierPath([
                    edge.start,
                    edge.start,
                    { x: mid.x, y: mid.y + protrusion },
                    { x: mid.x, y: mid.y + protrusion },
                    { x: mid.x, y: mid.y + protrusion },
                    edge.end,
                    edge.end,
                ])];
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
                return [Curve.fromBezierPath([
                    start,
                    start,
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    { x: mid.x + px, y: mid.y + py },
                    end,
                    end,
                ])];
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

    it('emits each piece of an accepted decomposition as a separate cut', () => {
        // Single internal edge (2×1 grid: only one shared edge).
        const graph = buildDCEL({ curves: simpleGridCurves(2, 1) });

        // Generator returns a 3-piece decomposition of the edge into
        // before/middle/after segments along the chord. The middle
        // piece is a one-pixel bump perpendicular to the edge so the
        // crossing-check accepts it. The exact shape doesn't matter —
        // the test is that the final cut set grows by 2 entries
        // (3 pieces emitted instead of 1).
        const threePieceGenerator: TabGenerator = {
            id: 'three-piece',
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
                return [
                    Curve.line(at(0, 0), at(0.3 * len, 0)),
                    Curve.fromBezierPath([
                        at(0.3 * len, 0),
                        at(0.4 * len, -1), at(0.6 * len, -1),
                        at(0.7 * len, 0),
                    ]),
                    Curve.line(at(0.7 * len, 0), at(1 * len, 0)),
                ];
            },
        };

        const flatResult = applyTabs(graph, makeFlatTabGenerator(), makeSeededRandom(1));
        const result = applyTabs(graph, threePieceGenerator, makeSeededRandom(1));

        // The 2×1 grid has exactly one internal shared edge. The
        // three-piece generator replaces that single entry with 3
        // entries, so the final cut set grows by exactly 2 entries
        // relative to the flat baseline.
        expect(result.length).toBe(flatResult.length + 2);
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
                return [Curve.fromBezierPath([
                    at(0, 0),
                    at(0.05 * len, 0), at(0.15 * len, 0), at(0.2 * len, 0),
                    // Bump: stays above the edge (perp = -10).
                    at(0.3 * len, -10), at(0.7 * len, -10), at(0.8 * len, 0),
                    at(0.85 * len, 0), at(0.95 * len, 0), at(1.0 * len, 0),
                ])];
            },
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const originalCurve = internalEdge.curve;

        const result = applyTabs(graph, tabGenerator, makeSeededRandom(1));

        expect(result).not.toContain(originalCurve);
    });

    it('tab decomposition with a fold-back produces an additional face after a second buildDCEL pass', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const facesBefore = graph.faces.filter(f => !f.isOuter).length;

        // A synthetic decomposition mirroring the classic tab shape's
        // failure mode: the `before` slice runs along the chord, the
        // tab itself dives BACK across the chord (so the tab body
        // intersects `before`), then the `after` slice continues
        // along the chord. The intersection between `tab` and
        // `before` is a real cross-curve crossing that the second
        // DCEL pass sees and splits into a new face.
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
                // `before`: chord from 0 to 0.4
                const before = Curve.line(at(0, 0), at(0.4 * len, 0));
                // `tab`: dives DOWN to perp=+30 (the opposite side from
                // the "up" we'd normally expect), so when the tab body
                // sweeps it crosses the chord-aligned `before` slice.
                const tab = Curve.fromBezierPath([
                    at(0.4 * len, 0),
                    at(0.3 * len, 30), at(0.2 * len, 30), at(0.3 * len, 0),
                    at(0.4 * len, -10), at(0.5 * len, -10),
                    at(0.6 * len, 0),
                ]);
                // `after`: chord from 0.6 to 1.0
                const after = Curve.line(at(0.6 * len, 0), at(1.0 * len, 0));
                return [before, tab, after];
            },
        };

        const finalCurves = applyTabs(graph, foldBackGenerator, makeSeededRandom(1));
        const rebuilt = buildDCEL({ curves: finalCurves });
        const facesAfter = rebuilt.faces.filter(f => !f.isOuter).length;

        // Each accepted tab contributes 3 entries (before, tab, after)
        // to the cut set. The tab piece doubles back through `before`,
        // a cross-curve intersection the second DCEL pass picks up as
        // a new vertex and splits into an extra face.
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
