/**
 * Hole assignment.
 *
 * For each non-primary component (e.g. a free-floating circle),
 * find which inner face of which other component contains it, and
 * attach the component's outer-loop start as an inner boundary on
 * the containing face.
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
        const idx = graph.faces.indexOf(localOuterFace);
        if (idx >= 0) graph.faces.splice(idx, 1);
    }
}

function findLocalOuterFace(component: Component, graph: TopologyGraph): Face | null {
    // Find the face within this component with the most-negative signed area
    // (= the local outer face).
    let bestFace: Face | null = null;
    let mostNegative = Infinity;
    for (const faceId of component.faces) {
        const face = graph.faces.find(f => f.id === faceId);
        if (!face) continue;
        const area = computeSignedArea(face);
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
 * Compute the signed area of a face by walking its half-edge boundary.
 * Uses the shoelace formula on the half-edge endpoints.
 *
 * Local helper (kept private here to avoid widening dcel.ts's public API).
 */
function computeSignedArea(face: Face): number {
    let area = 0;
    let current = face.outerEdge;
    do {
        const a = current.origin.position;
        const b = current.twin.origin.position;
        area += (a.x * b.y - b.x * a.y);
        current = current.next;
    } while (current !== face.outerEdge);
    return area / 2;
}
