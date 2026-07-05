import { describe, it, expect } from 'vitest';
import { silhouetteCutGenerator } from './silhouette-cut-generator.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import { classicTabGenerator } from './classic-tab-generator.js';
import { createSeededRandom } from '../seeded-random.js';
import type { SilhouetteOutline } from '../silhouette/types.js';

const FRAME = { width: 400, height: 300 };

/** Small square blob outline centered at (200, 150), 40×40. */
function squareOutline(cx = 200, cy = 150, half = 20): SilhouetteOutline {
    const polygon = [
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
    ];
    // Degenerate Béziers (straight edges): 3n+1 with first === last.
    const path = [polygon[0]];
    for (let i = 0; i < 4; i++) {
        const a = polygon[i], b = polygon[(i + 1) % 4];
        path.push(
            { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
            { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 },
            { x: b.x, y: b.y },
        );
    }
    return { path, polygon, area: (half * 2) ** 2 };
}

function generate(config: Record<string, unknown>) {
    return silhouetteCutGenerator.generate(FRAME, createSeededRandom(7), {
        cols: 4, rows: 3, ...config,
    });
}

describe('silhouetteCutGenerator', () => {
    it('is registered', () => {
        expect(getBaseCutGenerator('silhouette')).toBe(silhouetteCutGenerator);
    });

    it('emits 4 border curves first and a sine lattice with no outlines', () => {
        const curves = generate({});
        expect(curves.length).toBe(4 + 2 + 3); // border + (rows-1) h + (cols-1) v
        expect(curves[0].start).toEqual({ x: 0, y: 0 });
    });

    it('always draws exactly one outer PRNG value', () => {
        const count = (config: Record<string, unknown>): number => {
            let calls = 0;
            const counting = () => { calls++; return createSeededRandom(7 + calls)(); };
            silhouetteCutGenerator.generate(FRAME, counting, { cols: 4, rows: 3, ...config });
            return calls;
        };
        expect(count({})).toBe(1);
        expect(count({ outlines: [squareOutline()] })).toBe(1);
        expect(count({ ha: 0.4, hf: 3 })).toBe(1);
    });

    it('flags outline curves suppressTabs and lattice curves not', () => {
        const curves = generate({ outlines: [squareOutline()] });
        const suppressed = curves.filter(c => c.suppressTabs);
        const normal = curves.filter(c => !c.suppressTabs);
        expect(suppressed.length).toBeGreaterThan(0);
        expect(normal.length).toBeGreaterThanOrEqual(4);
    });

    it('a small (whole) blob yields exactly one piece with all edges tab-less', () => {
        // avg piece area = 400*300/12 = 10_000; blob 1600 < 3×10_000 → whole.
        const curves = generate({ outlines: [squareOutline()] });
        const graph = buildDCEL({ curves });
        applyTabs(graph, classicTabGenerator, createSeededRandom(9), {});
        // No lattice curve may pass through the blob interior: no half-edge
        // midpoint strictly inside the square except the outline's own edges.
        for (const he of graph.halfEdges) {
            const mid = he.curve.pointAt(0.5);
            const insideBlob = mid.x > 181 && mid.x < 219 && mid.y > 131 && mid.y < 169;
            if (insideBlob) {
                expect(he.curve.suppressTabs).toBe(true);
            }
        }
        // The blob face exists: one inner face whose area ≈ 1600.
        const areas = graph.faces.filter(f => !f.isOuter).map(faceArea);
        expect(areas.some(a => Math.abs(a - 1600) < 100)).toBe(true);
    });

    it('a large blob keeps the lattice inside (subdivided)', () => {
        // 200×200 blob = 40_000 > 3×10_000 → subdivided.
        const curves = generate({ outlines: [squareOutline(200, 150, 100)] });
        const graph = buildDCEL({ curves });
        // Some non-suppressed edge midpoint lies inside the blob.
        const inside = graph.halfEdges.some(he => {
            const mid = he.curve.pointAt(0.5);
            return !he.curve.suppressTabs &&
                mid.x > 110 && mid.x < 290 && mid.y > 60 && mid.y < 240;
        });
        expect(inside).toBe(true);
    });

    it('is deterministic for the same seed and outlines', () => {
        const a = generate({ outlines: [squareOutline()] });
        const b = generate({ outlines: [squareOutline()] });
        expect(a.map(c => c.segments)).toEqual(b.map(c => c.segments));
    });
});

function faceArea(face: { outerEdge: { origin: { position: { x: number; y: number } }; twin: { origin: { position: { x: number; y: number } } }; next: unknown } }): number {
    let area = 0;
    let cur = face.outerEdge as unknown as { origin: { position: { x: number; y: number } }; next: never };
    const start = cur;
    do {
        const next = (cur as { next: typeof cur }).next;
        const a = cur.origin.position, b = next.origin.position;
        area += a.x * b.y - b.x * a.y;
        cur = next;
    } while (cur !== start);
    return Math.abs(area / 2);
}
