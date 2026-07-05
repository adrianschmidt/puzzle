/**
 * Tests for the per-edge tab application harness.
 *
 * The harness must:
 * - skip border edges (one side is the outer face)
 * - call the tab generator once per eligible half-edge pair
 *   (each shared edge counted once, both sides updated)
 * - reject candidates that introduce new crossings against
 *   other edge curves
 * - leave edge geometry unchanged if no candidate is acceptable
 * - preserve graph topology (vertices, half-edges, faces are
 *   unchanged in count and connectivity)
 */

import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import { classicTabGenerator } from './classic-tab-generator.js';
import { createSeededRandom } from '../seeded-random.js';
import type { TabGenerator } from './plugin-types.js';

describe('applyTabs', () => {
    it('preserves topology — same vertex/edge/face counts after application', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const verticesBefore = graph.vertices.length;
        const halfEdgesBefore = graph.halfEdges.length;
        const facesBefore = graph.faces.length;

        applyTabs(graph, makeFlatTabGenerator(), makeSeededRandom(1));

        expect(graph.vertices).toHaveLength(verticesBefore);
        expect(graph.halfEdges).toHaveLength(halfEdgesBefore);
        expect(graph.faces).toHaveLength(facesBefore);
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
        // border edges should not be visited.
        // Each internal shared edge is visited ONCE (not once per
        // half-edge), so calls = 4.
        expect(calls).toBe(4);
    });

    it('rejects a tab candidate that crosses another edge', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // A "bad" generator: a 1000px bump that crosses adjacent edges.
        const badGenerator: TabGenerator = {
            id: 'bad',
            generate: (edge) => makePerpBump(edge, 1000),
        };

        // Snapshot one half-edge's curve before; expect it unchanged after
        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const curveBefore = internalEdge.curve;

        applyTabs(graph, badGenerator, makeSeededRandom(1));

        expect(internalEdge.curve).toBe(curveBefore);
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

        // A "good" generator: a tiny 1px perpendicular bump that stays
        // well inside its own edge's neighborhood and crosses nothing.
        const goodGenerator: TabGenerator = {
            id: 'good',
            generate: (edge) => makePerpBump(edge, 1),
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const curveBefore = internalEdge.curve;

        applyTabs(graph, goodGenerator, makeSeededRandom(1));

        expect(internalEdge.curve).not.toBe(curveBefore);
    });

    it('accepts a bump that crosses the parent line inside the removed splice range', () => {
        // The bump is an S-curve that crosses the parent line at its
        // midpoint. That crossing sits within the removed middle
        // section of the parent — the section that gets replaced by the
        // bump — so the final piece boundary does NOT self-intersect.
        // The fold-back check must ignore crossings inside the removed
        // range (only crossings into the kept `before`/`after` regions
        // count).
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        const sideways: TabGenerator = {
            id: 'sideways',
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

                // 3-segment candidate:
                //   1. before: linear from 0 -> 0.2L  (overlaps parent)
                //   2. bump:   S-curve 0.2L -> 0.8L with control points
                //              above then below — crosses parent at mid
                //   3. after:  linear 0.8L -> 1.0L   (overlaps parent)
                return Curve.fromBezierPath([
                    at(0, 0),
                    at(0.05 * len, 0), at(0.15 * len, 0), at(0.2 * len, 0),
                    at(0.25 * len, -25), at(0.75 * len, 25), at(0.8 * len, 0),
                    at(0.85 * len, 0), at(0.95 * len, 0), at(1.0 * len, 0),
                ]);
            },
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const curveBefore = internalEdge.curve;

        applyTabs(graph, sideways, makeSeededRandom(1));

        // Should have been applied: the S-curve crossing is entirely
        // inside the removed middle section.
        expect(internalEdge.curve).not.toBe(curveBefore);
    });

    it('rejects a bump that folds back into the kept `before` region', () => {
        // Construct a candidate whose bump pulls back into x < 0.2L —
        // crossing the `before` overlap region that stays in the final
        // boundary. This is the real fold-back case: the resulting
        // piece boundary self-intersects.
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        const realFoldback: TabGenerator = {
            id: 'real-foldback',
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
                // Bump's left control point sits at (-0.3L, -30) — way
                // back and above; right at (0.4L, +30) — slightly
                // forward and below. The cubic enters the `before`
                // x-range with y < 0 (above parent), sweeps through
                // y = 0 inside that range (around t ≈ 0.5, x ≈ 0.16L),
                // and exits with y > 0 — a transverse crossing of the
                // before segment.
                return Curve.fromBezierPath([
                    at(0, 0),
                    at(0.05 * len, 0), at(0.15 * len, 0), at(0.2 * len, 0),
                    at(-0.3 * len, -30), at(0.4 * len, 30), at(0.8 * len, 0),
                    at(0.85 * len, 0), at(0.95 * len, 0), at(1.0 * len, 0),
                ]);
            },
        };

        const internalEdge = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter,
        )!;
        const curveBefore = internalEdge.curve;

        applyTabs(graph, realFoldback, makeSeededRandom(1));

        // Edge should remain flat — the bump loops back across the
        // kept `before` portion.
        expect(internalEdge.curve).toBe(curveBefore);
    });

    it('accepts a small bump even when distant edges exist (cull does not drop real outcomes)', () => {
        // 3x3 grid: plenty of edges far from any given small bump. The
        // bump stays 1px off its own edge, so it crosses nothing and must
        // be accepted regardless of the bbox cull.
        const graph = buildDCEL({ curves: simpleGridCurves(3, 3) });
        const good: TabGenerator = {
            id: 'good',
            generate: (edge) => makePerpBump(edge, 1),
        };
        const internal = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter)!;
        const before = internal.curve;
        applyTabs(graph, good, makeSeededRandom(1));
        expect(internal.curve).not.toBe(before);
    });

    it('commits the first acceptable variant from generateVariants', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        // First variant pokes 1000px (crosses neighbors -> rejected);
        // second is a 1px bump (accepted).
        const ladder: TabGenerator = {
            id: 'ladder',
            generate: (edge) => makePerpBump(edge, 1000),
            *generateVariants(edge) {
                yield makePerpBump(edge, 1000);
                yield makePerpBump(edge, 1);
            },
        };
        const internal = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter)!;
        const before = internal.curve;
        applyTabs(graph, ladder, makeSeededRandom(1));
        expect(internal.curve).not.toBe(before);
        // The committed curve must be the small (1px) variant, not the
        // rejected 1000px one: its short bbox dimension stays tiny.
        const box = internal.curve.boundingBox();
        const shortSide = Math.min(box.maxX - box.minX, box.maxY - box.minY);
        expect(shortSide).toBeLessThan(10);
    });

    it('leaves the edge flat when every variant is rejected', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        // Every candidate pokes 1000px and crosses a neighbor -> all rejected.
        const allBad: TabGenerator = {
            id: 'all-bad',
            generate: (edge) => makePerpBump(edge, 1000),
            *generateVariants(edge) { yield makePerpBump(edge, 1000); yield makePerpBump(edge, 1000); },
        };
        const internal = graph.halfEdges.find(he =>
            !he.face?.isOuter && !he.twin.face?.isOuter)!;
        const before = internal.curve;
        applyTabs(graph, allBad, makeSeededRandom(1));
        expect(internal.curve).toBe(before);
    });

    it('fires onCandidate exactly once per eligible edge (variant path)', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        const gen: TabGenerator = {
            id: 'twovariants',
            generate: () => null,
            *generateVariants() { /* yields nothing -> flat */ },
        };
        let calls = 0;
        applyTabs(graph, gen, makeSeededRandom(1), {
            onCandidate: () => { calls++; },
        });
        expect(calls).toBe(4); // 2x2 grid has 4 internal shared edges
    });

    it('reports the committed variant ordinal to onCandidate', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        // Rung 0 (1000px) crosses neighbors -> rejected; rung 1 (1px) is
        // accepted, so every committed edge reports index 1.
        const ladder: TabGenerator = {
            id: 'ladder-idx',
            generate: (edge) => makePerpBump(edge, 1000),
            *generateVariants(edge) {
                yield makePerpBump(edge, 1000);
                yield makePerpBump(edge, 1);
            },
        };
        const acceptedIndices: Array<number | undefined> = [];
        applyTabs(graph, ladder, makeSeededRandom(1), {
            onCandidate: (_he, accepted, idx) => {
                if (accepted) acceptedIndices.push(idx);
            },
        });
        expect(acceptedIndices.length).toBeGreaterThan(0);
        expect(acceptedIndices.every(i => i === 1)).toBe(true);
    });

    it('counts a yielded null as a slot in the committed ordinal', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });
        // Slot 0 yields null (a failed splice); slot 1 is acceptable. The
        // committed ordinal must be 1 — the null still occupies slot 0, so
        // a skipped rung can't shift later rungs' indices.
        const gen: TabGenerator = {
            id: 'null-then-good',
            generate: (edge) => makePerpBump(edge, 1),
            *generateVariants(edge) {
                yield null;
                yield makePerpBump(edge, 1);
            },
        };
        const acceptedIndices: Array<number | undefined> = [];
        applyTabs(graph, gen, makeSeededRandom(1), {
            onCandidate: (_he, accepted, idx) => {
                if (accepted) acceptedIndices.push(idx);
            },
        });
        expect(acceptedIndices.length).toBeGreaterThan(0);
        expect(acceptedIndices.every(i => i === 1)).toBe(true);
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
        const curveBefore = internalEdge.curve;

        applyTabs(graph, tabGenerator, makeSeededRandom(1));

        expect(internalEdge.curve).not.toBe(curveBefore);
    });

    it('never puts a tab on an edge derived from a suppressTabs curve', () => {
        // Two internal cuts: one normal, one suppressed. Both cross the frame.
        const curves = [
            Curve.line({ x: 0, y: 0 }, { x: 100, y: 0 }),
            Curve.line({ x: 100, y: 0 }, { x: 100, y: 100 }),
            Curve.line({ x: 100, y: 100 }, { x: 0, y: 100 }),
            Curve.line({ x: 0, y: 100 }, { x: 0, y: 0 }),
            Curve.line({ x: 0, y: 33 }, { x: 100, y: 33 }),
            Curve.line({ x: 0, y: 66 }, { x: 100, y: 66 }, { suppressTabs: true }),
        ];
        const graph = buildDCEL({ curves });
        const before = new Map(graph.halfEdges.map(he => [he.id, he.curve]));
        applyTabs(graph, classicTabGenerator, createSeededRandom(42), {});
        for (const he of graph.halfEdges) {
            if (he.curve.suppressTabs) {
                expect(he.curve).toBe(before.get(he.id)); // untouched
            }
        }
        // Sanity: at least one non-suppressed edge DID get a tab.
        const changed = graph.halfEdges.some(he => he.curve !== before.get(he.id));
        expect(changed).toBe(true);
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

/**
 * A simple tab candidate: a wedge whose apex sits `perp` px perpendicular
 * to the edge at its midpoint. Small `perp` stays local (crosses nothing);
 * large `perp` pokes across neighboring edges (rejected by the crossing
 * check). Shape matches what the real splicer emits: a kept `before`/
 * `after` overlap plus a single bump.
 */
function makePerpBump(edge: Curve, perp: number): Curve {
    const mid = edge.pointAt(0.5);
    const dx = edge.end.x - edge.start.x;
    const dy = edge.end.y - edge.start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const apex = { x: mid.x - (dy / len) * perp, y: mid.y + (dx / len) * perp };
    return Curve.fromBezierPath([
        edge.start, edge.start, apex, apex, apex, edge.end, edge.end,
    ]);
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
