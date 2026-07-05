/**
 * Framework-behavior spike for the silhouette generator's lattice
 * clipping (see docs/superpowers/specs/2026-07-05-silhouette-cut-
 * generator-design.md). Pins how buildDCEL treats:
 *
 * 1. T-junctions: a curve ENDING exactly on another curve must split
 *    the other curve and produce a shared vertex (within
 *    VERTEX_MERGE_TOLERANCE = 3px).
 * 2. Dangling stubs: a curve end floating inside a face must not
 *    corrupt face discovery (the faces around it must still close).
 */
import { describe, it, expect } from 'vitest';
import { buildDCEL, getFaceVertices } from './dcel.js';
import { Curve } from './curve.js';

const border = (w: number, h: number): Curve[] => [
    Curve.line({ x: 0, y: 0 }, { x: w, y: 0 }),
    Curve.line({ x: w, y: 0 }, { x: w, y: h }),
    Curve.line({ x: w, y: h }, { x: 0, y: h }),
    Curve.line({ x: 0, y: h }, { x: 0, y: 0 }),
];

describe('DCEL junction behavior (silhouette clipping contract)', () => {
    it('splits a crossed curve at a T-junction endpoint', () => {
        // Vertical line ends exactly ON the horizontal midline.
        const curves = [
            ...border(100, 100),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),   // full horizontal
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 50 }),    // T-stem from top
        ];
        const graph = buildDCEL({ curves });
        const inner = graph.faces.filter(f => !f.isOuter);
        // Top-left, top-right, bottom = 3 inner faces if the T-junction
        // created a real vertex; 2 if the stem was ignored/dangling.
        expect(inner.length).toBe(3);
        // A vertex must exist at (50, 50).
        const v = graph.vertices.find(v =>
            Math.hypot(v.position.x - 50, v.position.y - 50) < 3);
        expect(v).toBeDefined();
    });

    it('documents dangling-stub behavior (stub ends mid-face)', () => {
        // Vertical stub crosses the midline and continues 5px past it.
        const curves = [
            ...border(100, 100),
            Curve.line({ x: 0, y: 50 }, { x: 100, y: 50 }),
            Curve.line({ x: 50, y: 0 }, { x: 50, y: 55 }),    // 5px overshoot
        ];
        const graph = buildDCEL({ curves });
        const inner = graph.faces.filter(f => !f.isOuter);

        // ACTUAL BEHAVIOR (verified by inspection, not the brief's guess):
        // face discovery is NOT corrupted by the overshoot — the crossing at
        // (50,50) still splits the top half into two faces, and the bottom
        // face stays a single face rather than fragmenting. Exactly 3 inner
        // faces, same as the clean T-junction case.
        expect(inner.length).toBe(3);

        // Every inner face's boundary must be a closed loop (traversal
        // terminates and returns to the start edge).
        for (const face of inner) {
            let e = face.outerEdge;
            let steps = 0;
            do { e = e.next; steps++; } while (e !== face.outerEdge && steps < 10_000);
            expect(e).toBe(face.outerEdge);
        }

        // But the overshoot is NOT silently absorbed either: the dangling
        // 5px stub survives as a degenerate zero-width "slit" cut into the
        // bottom face's boundary polygon. Walking that face's vertices
        // visits the T-junction point (50, 50) TWICE — once on the way out
        // to the dangling tip (50, 55), once on the way back — instead of
        // passing through cleanly. A piece boundary built naively from
        // getFaceVertices would render a spike into the middle of what
        // should be a plain rectangle edge.
        const bottomFace = inner.find(f =>
            getFaceVertices(f).some(p => Math.hypot(p.x - 50, p.y - 55) < 3));
        expect(bottomFace).toBeDefined();
        const verts = getFaceVertices(bottomFace!);
        const junctionVisits = verts.filter(p =>
            Math.hypot(p.x - 50, p.y - 50) < 3).length;
        // Confirms the slit: the junction vertex is revisited (2 visits),
        // not passed through once (1 visit) as it would be if the stub
        // were clipped exactly at the intersection (Task 8's "no
        // overshoot" strategy) or dropped entirely.
        expect(junctionVisits).toBe(2);
    });
});
