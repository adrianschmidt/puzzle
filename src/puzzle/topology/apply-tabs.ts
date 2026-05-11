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

// Bump-extraction tuning: identify where the candidate diverges from
// its parent edge (the `before`/`after` overlap regions vs the bump).
const BUMP_SAMPLE_COUNT = 12;            // uniform samples across the candidate
const BUMP_DEVIATION_THRESHOLD = 1;      // px — samples this far from parent count as bump

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

        if (foldsBackThroughSelf(candidate, he.curve)) continue;

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
 * Returns true if the candidate curve crosses any OTHER edge in the
 * graph at a point that isn't already a shared endpoint of the
 * original edge.
 *
 * Self-crossings (the bump folding back through the parent edge) are
 * NOT checked here — see `foldsBackThroughSelf`. Naively running
 * `candidate.intersect(parent)` is unusable because `candidate`
 * embeds literal slices of `parent` (the `before`/`after` regions),
 * which produce a flood of overlap-region "intersections" that aren't
 * transverse crossings.
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

/**
 * Returns true if the candidate's bump portion crosses the parent
 * edge (other than at the splice points where the bump meets the
 * `before`/`after` overlap regions).
 *
 * The legacy `createTabCollisionDetector` rejected such tabs to keep
 * piece boundaries free of self-intersections. The pluggable topology
 * pipeline reintroduces the check here.
 *
 * Approach: sample the candidate, project each sample onto the parent
 * to get a signed perpendicular distance (parent's normal as the sign
 * axis). The bump is the contiguous range of samples whose unsigned
 * distance exceeds `BUMP_DEVIATION_THRESHOLD` — the `before`/`after`
 * overlap regions have ~zero distance. If any bump sample lies above
 * the parent AND another lies below it (i.e. the bump's signed
 * distances have both polarities), the candidate must cross the
 * parent at an interior point — a fold-back.
 *
 * Why we don't just `candidate.intersect(parent)`: the candidate
 * returned by classicTabGenerator is `join([before, tab, after])`
 * where `before` and `after` are literal slices of the parent. A
 * direct intersect produces 10+ phantom crossings along those overlap
 * regions, which bezier-js's recursive subdivision happily reports
 * even though the curves coincide rather than cross.
 */
function foldsBackThroughSelf(candidate: Curve, parent: Curve): boolean {
    const n = BUMP_SAMPLE_COUNT;

    // For each candidate sample, find the nearest point on parent and
    // compute a signed perpendicular distance (sign from a 2D cross
    // product using the parent's tangent at the projection).
    const signed: number[] = new Array(n + 1);
    const unsigned: number[] = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = candidate.pointAt(t);
        const tOnParent = parent.nearestT(p);
        const q = parent.pointAt(tOnParent);
        const tan = parent.tangentAt(tOnParent);
        // Signed perpendicular: positive if p is to the left of the
        // parent's tangent direction at q.
        signed[i] = (p.x - q.x) * (-tan.y) + (p.y - q.y) * tan.x;
        unsigned[i] = Math.abs(signed[i]);
    }

    // Identify the bump as samples whose unsigned distance exceeds
    // the threshold (i.e. NOT overlapping the parent).
    let firstFar = -1;
    let lastFar = -1;
    for (let i = 0; i <= n; i++) {
        if (unsigned[i] > BUMP_DEVIATION_THRESHOLD) {
            if (firstFar < 0) firstFar = i;
            lastFar = i;
        }
    }
    if (firstFar < 0) return false;

    // Within the bump, look for samples on BOTH sides of the parent.
    // The bump-side samples (unsigned > threshold) tell us which side
    // of the parent the bump is on. If ANY such sample sits above the
    // parent AND another sits below, the bump must cross the parent
    // in between — that's a fold-back.
    //
    // Samples near the splice points (unsigned <= threshold) are
    // excluded; their signed distance is too noisy to be meaningful.
    let sawPositive = false;
    let sawNegative = false;
    for (let i = firstFar; i <= lastFar; i++) {
        if (unsigned[i] <= BUMP_DEVIATION_THRESHOLD) continue;
        if (signed[i] > 0) sawPositive = true;
        else if (signed[i] < 0) sawNegative = true;
        if (sawPositive && sawNegative) return true;
    }
    return false;
}

function pointDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
