/**
 * Per-edge tab application returning a final cut set.
 *
 * Walks every half-edge in the input graph and produces a list of
 * curves that the caller feeds into a SECOND `buildDCEL` pass. The
 * second pass discovers any topology introduced by the tab shapes
 * themselves (e.g. a tab whose bump folds back through its own parent
 * edge, which creates an extra "island" face).
 *
 * For each shared internal half-edge pair (skipping border edges where
 * one side is the outer face), the harness asks the TabGenerator for a
 * candidate curve. The candidate's endpoints must match the original
 * edge — the framework checks this and rejects mismatches. The
 * candidate is then checked against every OTHER edge in the graph for
 * crossings; if any crossing would be introduced, the candidate is
 * rejected and the original (flat) sub-curve is emitted instead.
 *
 * Self-crossings (the bump folding back through the parent edge) are
 * NOT rejected here — they are intended to materialise as additional
 * topology in the second DCEL pass, where the existing auto-group
 * pass absorbs the resulting tiny islands into their neighbours via
 * the adaptive minPieceArea threshold.
 *
 * Border half-edges contribute their original sub-curves unchanged.
 * Twin half-edges contribute nothing extra (each shared edge is
 * emitted exactly once).
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

/**
 * Walk the initial DCEL and produce the final cut set: one entry per
 * twin pair (internal shared edges as their tab-decorated curve when
 * accepted, else their original sub-curve; border edges as their
 * original sub-curve).
 *
 * The returned list is intended to be fed into a fresh `buildDCEL`
 * call. The second pass picks up any tab self-crossings as real
 * topology.
 */
export function applyTabs(
    graph: TopologyGraph,
    generator: TabGenerator,
    random: () => number,
    options: ApplyTabsOptions = {},
): Curve[] {
    const policy = options.policy ?? defaultTabPolicy;
    const tabConfig = options.tabConfig ?? {};

    const finalCurves: Curve[] = [];
    const visited = new Set<number>();

    for (const he of graph.halfEdges) {
        if (visited.has(he.id) || visited.has(he.twin.id)) continue;
        visited.add(he.id);
        visited.add(he.twin.id);

        const aOuter = !he.face || he.face.isOuter;
        const bOuter = !he.twin.face || he.twin.face.isOuter;

        // Border edge: emit the original sub-curve unchanged.
        if (aOuter || bOuter) {
            finalCurves.push(he.curve);
            continue;
        }

        // Internal shared edge: try the tab generator.
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
        };
        if (!policy(view)) {
            finalCurves.push(he.curve);
            continue;
        }

        const candidate = generator.generate(he.curve, random, tabConfig);
        if (!candidate) {
            finalCurves.push(he.curve);
            continue;
        }

        if (!endpointsMatch(candidate, he.curve)) {
            finalCurves.push(he.curve);
            continue;
        }

        if (introducesNewCrossing(candidate, he, graph)) {
            finalCurves.push(he.curve);
            continue;
        }

        finalCurves.push(candidate);
    }

    return finalCurves;
}

const defaultTabPolicy: TabPolicy = () => true;

function endpointsMatch(candidate: Curve, original: Curve): boolean {
    const ds = pointDist(candidate.start, original.start);
    const de = pointDist(candidate.end, original.end);
    return ds < ENDPOINT_TOLERANCE && de < ENDPOINT_TOLERANCE;
}

/**
 * Returns true if the candidate curve crosses any OTHER edge in the
 * graph at a point that isn't already a shared endpoint of the
 * original edge.
 *
 * Self-crossings (the bump folding back through the parent edge) are
 * NOT checked here. Such fold-backs are allowed to materialise as
 * extra tiny faces in the topology built by the second DCEL pass,
 * and are absorbed downstream by the auto-group pass.
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
