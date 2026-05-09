/**
 * Per-edge tab application with collision rejection.
 *
 * Iterates over each shared internal half-edge pair (skipping border
 * edges where one side is the outer face). For each, asks the
 * TabGenerator for a candidate curve. The candidate's endpoints must
 * match the original edge — the framework checks this and rejects
 * mismatches. Then the candidate is checked against every OTHER
 * edge in the graph for crossings; if any crossing would be
 * introduced, the candidate is rejected and the edge stays flat.
 *
 * Topology is never modified — only the `curve` field of each
 * half-edge changes (and its twin's reversed curve). Faces, vertices,
 * and connectivity are untouched.
 */

import { Curve } from './curve.js';
import type { TopologyGraph, HalfEdge } from './dcel.js';
import type { TabGenerator, TabPolicy, TopologyEdge } from './plugin-types.js';

const ENDPOINT_TOLERANCE = 0.5;          // px — candidate endpoint must match
const CROSSING_ENDPOINT_TOLERANCE = 2;   // px — ignore intersections at endpoint joins

export interface ApplyTabsOptions {
    /** Optional eligibility filter (default: every internal edge). */
    policy?: TabPolicy;
    /** Tab-generator-specific config, forwarded to TabGenerator.generate. */
    tabConfig?: unknown;
}

export function applyTabs(
    graph: TopologyGraph,
    generator: TabGenerator,
    random: () => number,
    options: ApplyTabsOptions = {},
): void {
    const policy = options.policy ?? defaultTabPolicy;
    const tabConfig = options.tabConfig ?? {};

    // Build the canonical list of shared edges (one entry per twin pair).
    // Skip pairs where either side is the outer face.
    const visited = new Set<number>();
    const sharedEdges: HalfEdge[] = [];
    for (const he of graph.halfEdges) {
        if (visited.has(he.id) || visited.has(he.twin.id)) continue;
        visited.add(he.id);
        visited.add(he.twin.id);
        const aOuter = !he.face || he.face.isOuter;
        const bOuter = !he.twin.face || he.twin.face.isOuter;
        if (aOuter || bOuter) continue;
        sharedEdges.push(he);
    }

    for (const he of sharedEdges) {
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
        };
        if (!policy(view)) continue;

        const candidate = generator.generate(he.curve, random, tabConfig);
        if (!candidate) continue;

        if (!endpointsMatch(candidate, he.curve)) continue;

        if (introducesNewCrossing(candidate, he, graph)) continue;

        he.curve = candidate;
        he.twin.curve = candidate.reverse();
    }
}

const defaultTabPolicy: TabPolicy = () => true;

function endpointsMatch(candidate: Curve, original: Curve): boolean {
    const ds = pointDist(candidate.start, original.start);
    const de = pointDist(candidate.end, original.end);
    return ds < ENDPOINT_TOLERANCE && de < ENDPOINT_TOLERANCE;
}

/**
 * Returns true if the candidate curve crosses any other edge in the
 * graph at a point that isn't already a shared endpoint of the
 * original edge.
 */
function introducesNewCrossing(
    candidate: Curve,
    self: HalfEdge,
    graph: TopologyGraph,
): boolean {
    const candStart = candidate.start;
    const candEnd = candidate.end;

    // Build the set of half-edges to check. Each twin pair is
    // checked once; we skip self and self.twin (the candidate IS
    // self's new curve).
    const seen = new Set<number>();
    for (const he of graph.halfEdges) {
        if (seen.has(he.id) || seen.has(he.twin.id)) continue;
        seen.add(he.id);
        seen.add(he.twin.id);
        if (he.id === self.id || he.id === self.twin.id) continue;

        const intersections = candidate.intersect(he.curve);
        for (const ix of intersections) {
            const dStart = pointDist(ix.point, candStart);
            const dEnd = pointDist(ix.point, candEnd);
            if (dStart < CROSSING_ENDPOINT_TOLERANCE) continue;
            if (dEnd < CROSSING_ENDPOINT_TOLERANCE) continue;
            return true;
        }
    }
    return false;
}

function pointDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
