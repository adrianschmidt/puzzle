import { describe, it, expect } from 'vitest';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
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

        // 2x2 grid = 4 internal shared edges, each visited once (not per
        // half-edge); border edges skipped. So calls = 4.
        expect(calls).toBe(4);
    });

    it('rejects a tab candidate that crosses another edge', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // 1000px bump crosses adjacent edges -> rejected.
        const badGenerator: TabGenerator = {
            id: 'bad',
            generate: (edge) => makePerpBump(edge, 1000),
        };

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
        // 3×3 grid edges are 100 units long; policy length > 200 skips all.
        applyTabs(graph, generator, makeSeededRandom(1), {
            policy: (e) => e.length > 200,
        });
        expect(calls).toBe(0);

        let calls2 = 0;
        const generator2: TabGenerator = {
            id: 'count2',
            generate: () => { calls2++; return null; },
        };
        applyTabs(graph, generator2, makeSeededRandom(1), {
            policy: () => true,
        });
        expect(calls2).toBe(12); // 3×3: 2*3 + 3*2 = 12 internal edges
    });

    it('accepts a tab candidate that does not cross any other edge', () => {
        const graph = buildDCEL({ curves: simpleGridCurves(2, 2) });

        // Tiny 1px bump stays local and crosses nothing -> accepted.
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
        // S-curve crosses the parent at its midpoint — inside the removed
        // middle section, so the final boundary doesn't self-intersect.
        // The fold-back check must ignore crossings in the removed range.
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

                // before(0->0.2L) | S-curve bump crossing parent at mid | after(0.8L->1L)
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

        expect(internalEdge.curve).not.toBe(curveBefore);
    });

    it('rejects a bump that folds back into the kept `before` region', () => {
        // Bump pulls back into x < 0.2L, crossing the kept `before`
        // region — a real fold-back that self-intersects the boundary.
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
                // Control points (-0.3L,-30) and (0.4L,+30) make the cubic
                // sweep through y=0 inside the `before` x-range — a
                // transverse crossing of the kept before segment.
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

        expect(internalEdge.curve).toBe(curveBefore);
    });

    it('accepts a small bump even when distant edges exist (cull does not drop real outcomes)', () => {
        // 3x3 grid has edges far from the bump; a 1px bump crosses nothing
        // and must be accepted regardless of the bbox cull.
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
        // Variant 0 pokes 1000px (rejected); variant 1 is a 1px bump (accepted).
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
        // Committed variant must be the 1px one — its short bbox side stays tiny.
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
        // Rung 0 (1000px) rejected, rung 1 (1px) accepted, so every
        // committed edge reports index 1.
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
        // Slot 0 yields null (failed splice), slot 1 is acceptable. The
        // null still occupies slot 0, so the committed ordinal is 1.
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

        // Normal tab: before/after overlap plus a one-sided bump. Must
        // NOT be rejected by the fold-back check.
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
});

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
 * Tab candidate: a wedge with apex `perp` px off the edge midpoint.
 * Small `perp` crosses nothing; large pokes across neighbors (rejected).
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
