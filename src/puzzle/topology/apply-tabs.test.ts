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
        const curveBefore = internalEdge.curve;

        applyTabs(graph, goodGenerator, makeSeededRandom(1));

        expect(internalEdge.curve).not.toBe(curveBefore);
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
