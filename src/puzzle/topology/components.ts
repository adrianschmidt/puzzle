/**
 * Connected-component detection for a TopologyGraph.
 *
 * Two half-edges are in the same component if you can walk from one
 * to the other via .twin / .next / .prev (any combination). A free-
 * floating closed curve is its own component, separate from the frame.
 */

import type { TopologyGraph, HalfEdge } from './dcel.js';

export interface Component {
    /** All half-edges in this component. */
    halfEdges: HalfEdge[];
    /** All faces touched by this component (including the global outer face if it's reachable). */
    faces: Set<number>;
}

export function findComponents(graph: TopologyGraph): Component[] {
    const visited = new Set<number>();
    const components: Component[] = [];

    for (const start of graph.halfEdges) {
        if (visited.has(start.id)) continue;

        const halfEdges: HalfEdge[] = [];
        const faces = new Set<number>();
        const queue: HalfEdge[] = [start];

        while (queue.length > 0) {
            const he = queue.pop()!;
            if (visited.has(he.id)) continue;
            visited.add(he.id);
            halfEdges.push(he);
            if (he.face) faces.add(he.face.id);
            queue.push(he.twin, he.next, he.prev);
        }

        components.push({ halfEdges, faces });
    }
    return components;
}
