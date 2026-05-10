/**
 * Hole assignment.
 *
 * For each non-primary component (e.g. a free-floating circle),
 * find which inner face of which other component contains it, and
 * attach the component's outer-loop start as an inner boundary on
 * the containing face.
 *
 * Only single-level hole nesting is exercised by current tests
 * (frame + free-floating circle, frame + two-circle Venn). Deeper
 * nesting (a hole containing another hole) may behave correctly via
 * natural fall-through of the same logic, but is not verified.
 */

import type { TopologyGraph, Face, HalfEdge } from './dcel.js';
import type { Component } from './components.js';
import type { Point } from '../../model/types.js';

export function assignHoles(graph: TopologyGraph, components: Component[]): void {
    // Identify the "primary" component — the one containing the global
    // outer face. Other components are candidates for hole placement.
    const primary = components.find(c => c.faces.has(graph.outerFace.id));
    if (!primary) return;
    const others = components.filter(c => c !== primary);

    for (const inner of others) {
        const probe = inner.halfEdges[0].origin.position;
        const containingFace = findContainingFace(probe, graph, inner);
        if (!containingFace) continue;

        // Find the LOCAL outer face of the inner component (the face
        // with the most-negative signed area within this component —
        // analogous to the global outer face but scoped to the
        // component). Its bounding half-edges become the inner
        // boundary of the containing face; the face object itself is
        // redundant after attachment (it represents the same physical
        // region as `containingFace`) and gets removed from the graph.
        const localOuterFace = findLocalOuterFace(inner, graph);
        if (!localOuterFace) continue;

        containingFace.innerBoundaries.push(localOuterFace.outerEdge);

        // Retarget the loop's half-edges to point at the containing face.
        // Without this, downstream consumers (faces-to-pieces) walk
        // `he.twin.face` and land on the now-removed local-outer Face
        // object, which fails the faceId→pieceId lookup and produces
        // matePieceId = -1 (i.e. the system thinks the inner-boundary
        // edges are unmated borders, breaking interactive merge).
        let cur: HalfEdge = localOuterFace.outerEdge;
        do {
            cur.face = containingFace;
            cur = cur.next;
        } while (cur !== localOuterFace.outerEdge);

        const idx = graph.faces.indexOf(localOuterFace);
        if (idx >= 0) graph.faces.splice(idx, 1);
    }
}

function findLocalOuterFace(component: Component, graph: TopologyGraph): Face | null {
    // Find the face within this component with the most-negative signed
    // area (= the local outer face, by analogy with the global outer face).
    //
    // Uses SAMPLED curve points for the shoelace formula so that faces
    // whose boundaries are curved arcs with very few vertices (e.g. a
    // circle split into 2 arcs has just 2 vertices, vertex-based shoelace
    // collapses to zero) get a meaningful signed area. This is essential
    // for circle-based components like Venn where every face's vertex
    // count is small.
    let bestFace: Face | null = null;
    let mostNegative = Infinity;
    for (const faceId of component.faces) {
        const face = graph.faces.find(f => f.id === faceId);
        if (!face) continue;
        const area = sampledSignedArea(face);
        if (area < mostNegative) {
            mostNegative = area;
            bestFace = face;
        }
    }
    return bestFace;
}

function findContainingFace(
    probe: Point,
    graph: TopologyGraph,
    excludeComponent: Component,
): Face | null {
    const excluded = new Set([...excludeComponent.faces]);
    let best: Face | null = null;
    let bestArea = Infinity;

    for (const face of graph.faces) {
        if (face.isOuter) continue;
        if (excluded.has(face.id)) continue;

        const polygon = sampleFaceBoundary(face);
        if (!pointInPolygon(probe, polygon)) continue;

        const area = polygonArea(polygon);
        if (area < bestArea) {
            bestArea = area;
            best = face;
        }
    }
    return best;
}

function sampleFaceBoundary(face: Face): Point[] {
    const points: Point[] = [];
    let current: HalfEdge = face.outerEdge;
    do {
        points.push(...current.curve.sample(8));
        current = current.next;
    } while (current !== face.outerEdge);
    return points;
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersects = ((yi > p.y) !== (yj > p.y))
            && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function polygonArea(polygon: Point[]): number {
    let a = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        a += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
    }
    return Math.abs(a / 2);
}

/**
 * Compute the signed area of a face using SAMPLED points along each
 * half-edge curve, not just the half-edge endpoints. Required for faces
 * bounded by curves with few vertices (e.g. a 2-vertex circle), where
 * vertex-only shoelace collapses to zero.
 */
function sampledSignedArea(face: Face): number {
    const points: { x: number; y: number }[] = [];
    let current: HalfEdge = face.outerEdge;
    do {
        // sample(8) returns [start, ...8 interior+end]; appending all
        // produces a connected polyline around the boundary. Endpoints
        // are duplicated between adjacent edges, but shoelace is robust
        // to repeated points.
        points.push(...current.curve.sample(8));
        current = current.next;
    } while (current !== face.outerEdge);

    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += points[j].x * points[i].y - points[i].x * points[j].y;
    }
    return area / 2;
}
