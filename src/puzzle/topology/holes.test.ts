import { describe, it, expect } from 'vitest';
import type { HalfEdge, Face } from './dcel.js';
import { Curve } from './curve.js';
import { buildDCEL } from './dcel.js';

function frameWithCircle() {
    const W = 600, H = 400;
    return buildDCEL({ curves: [
        Curve.line({ x: 0, y: 0 }, { x: W, y: 0 }),
        Curve.line({ x: W, y: 0 }, { x: W, y: H }),
        Curve.line({ x: W, y: H }, { x: 0, y: H }),
        Curve.line({ x: 0, y: H }, { x: 0, y: 0 }),
        Curve.circle({ x: 300, y: 200 }, 50),
    ]});
}

function signedArea(start: HalfEdge): number {
    // Sample each half-edge's curve so curved boundaries with few
    // vertices (e.g. a circle has only 2 vertices after splitting)
    // produce a non-zero signed area.
    const points: { x: number; y: number }[] = [];
    let current = start;
    do {
        points.push(...current.curve.sample(8));
        current = current.next;
    } while (current !== start);

    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += points[j].x * points[i].y - points[i].x * points[j].y;
    }
    return area / 2;
}

describe('assignHoles (run via buildDCEL)', () => {
    it('attaches a free-floating circle as an inner boundary on the frame face', () => {
        const graph = frameWithCircle();
        const innerFaces = graph.faces.filter(f => !f.isOuter);
        const facesWithHoles = innerFaces.filter(f =>
            f.innerBoundaries && f.innerBoundaries.length > 0,
        );
        expect(facesWithHoles).toHaveLength(1);
    });

    it('inner-boundary loop winds opposite the outer boundary', () => {
        const graph = frameWithCircle();
        const frame: Face = graph.faces.find(
            f => !f.isOuter && f.innerBoundaries.length > 0,
        )!;
        const outerSign = Math.sign(signedArea(frame.outerEdge));
        const innerSign = Math.sign(signedArea(frame.innerBoundaries[0]));
        // Hole boundary must wind opposite to the outer boundary so
        // SVG fill-rule:evenodd produces a hole and downstream
        // winding-aware consumers (point-in-polygon, etc.) work.
        expect(innerSign).not.toBe(0);
        expect(outerSign).not.toBe(0);
        expect(innerSign).toBe(-outerSign);
    });
});
