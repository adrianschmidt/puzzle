import { describe, it, expect } from 'vitest';
import { silhouetteCutGenerator } from './silhouette-cut-generator.js';
import { getBaseCutGenerator } from './generator-registry.js';
import { buildDCEL } from './dcel.js';
import { applyTabs } from './apply-tabs.js';
import { classicTabGenerator } from './classic-tab-generator.js';
import { createSeededRandom } from '../seeded-random.js';
import type { SilhouetteOutline } from '../silhouette/types.js';
import type { Point } from '../../model/types.js';

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

/** < dcel.ts's VERTEX_MERGE_TOLERANCE (3px). */
const SUB_TOLERANCE_NUDGE = 1.5;

/**
 * Square-ish blob outline like `squareOutline`, but with corner 1
 * nudged to within `nudge` (< 3px) of corner 0, creating one
 * sub-tolerance outline edge. Used to pin how `buildDCEL`'s
 * `splitClosedCurves` (which treats any curve whose own start/end lie
 * within tolerance as a closed self-loop) interacts with this
 * generator's one-curve-per-edge outline emission.
 */
function nudgedSquareOutline(
    cx = 200, cy = 150, half = 20, nudge = SUB_TOLERANCE_NUDGE,
): SilhouetteOutline {
    const polygon = [
        { x: cx - half, y: cy - half },
        { x: cx - half + nudge, y: cy - half }, // <3px from the previous corner
        { x: cx + half, y: cy + half },
        { x: cx - half, y: cy + half },
    ];
    const path = [polygon[0]];
    for (let i = 0; i < 4; i++) {
        const a = polygon[i], b = polygon[(i + 1) % 4];
        path.push(
            { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
            { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 },
            { x: b.x, y: b.y },
        );
    }
    return { path, polygon, area: shoelaceArea(polygon) };
}

function shoelaceArea(polygon: Point[]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area / 2);
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

    it('absorbs a sub-tolerance outline edge into a closed single blob face', () => {
        // One outline edge (corner0→corner1) is 1.5px — below dcel.ts's
        // VERTEX_MERGE_TOLERANCE (3px). splitClosedCurves treats any
        // curve whose own start/end lie within tolerance as a closed
        // self-loop: it splits this edge at t=0.5, and both halves
        // collapse to zero length (every point involved falls in the
        // same vertex-pool tolerance cell), so the edge is dropped
        // entirely — Step 4 skips zero-length segments. The two
        // neighboring outline edges still independently register
        // corner0 and corner1 in that same vertex cell, so the ring
        // stays closed: the dropped corner is silently absorbed rather
        // than opening the outline. This test pins that (coincidental,
        // per review) behavior; it does NOT exercise the generator's
        // normal (well-separated-corner) path, which the other tests
        // above already cover.
        const outline = nudgedSquareOutline();
        // Below the whole-piece threshold (3 × 10_000 = 30_000), same
        // as the plain-square whole-blob test above.
        const curves = generate({ outlines: [outline] });
        const graph = buildDCEL({ curves });

        const inner = graph.faces.filter(f => !f.isOuter);
        expect(inner.length).toBeGreaterThan(0);

        // Every inner face boundary is a closed loop: a guarded walk
        // via .next must return to the starting half-edge (same
        // pattern as dcel-junction.test.ts's dangling-stub check).
        for (const face of inner) {
            let e = face.outerEdge;
            let steps = 0;
            do { e = e.next; steps++; } while (e !== face.outerEdge && steps < 10_000);
            expect(e).toBe(face.outerEdge);
        }

        // One inner face is the (nearly) whole blob. Its vertex-based
        // area is the outline's own area minus the tiny dropped sliver
        // (corner0, nudged corner1, corner2) — computed here as ~30px²
        // out of ~830px² — so a margin an order of magnitude above that
        // sliver still confirms the corner was absorbed, not that the
        // face lost real area or vanished.
        const areas = inner.map(faceArea);
        expect(areas.some(a => Math.abs(a - outline.area) < 100)).toBe(true);
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
