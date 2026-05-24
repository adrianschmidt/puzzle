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
const BUMP_SAMPLE_COUNT = 60;            // uniform samples across the candidate
const BUMP_OVERLAP_THRESHOLD = 0.5;      // px — samples within this of parent are "on the overlap"
const BUMP_SPLICE_TOLERANCE = 2;         // px — intersections this close to bump endpoints ignored

export interface ApplyTabsOptions {
    /** Optional eligibility filter (default: every internal edge). */
    policy?: TabPolicy;
    /** Tab-generator-specific config, forwarded to TabGenerator.generate. */
    tabConfig?: unknown;
    /**
     * Optional dev-time hook fired once per candidate produced by the
     * generator (regardless of whether the candidate was ultimately
     * accepted). Receives the half-edge it was generated for and whether
     * the framework's collision / fold-back checks let it through.
     *
     * Intended for debug instrumentation (e.g. correlating each tab
     * with the piece it ended up on). Production paths leave this
     * unset and pay an extra branch only — `applyTabs` callers that
     * don't care don't need to wire anything up.
     */
    onCandidate?: (he: HalfEdge, accepted: boolean) => void;
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
        if (!candidate) {
            options.onCandidate?.(he, false);
            continue;
        }

        const accepted =
            endpointsMatch(candidate, he.curve) &&
            !foldsBackThroughSelf(candidate, he.curve) &&
            !introducesNewCrossing(candidate, he, graph);
        options.onCandidate?.(he, accepted);
        if (!accepted) continue;

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
 * Returns true if the candidate's bump portion crosses the parts of
 * the parent edge that the candidate KEEPS — i.e., the `before` and
 * `after` overlap regions on either side of the splice. Crossings
 * through the middle section the candidate replaces are ignored,
 * since that section doesn't exist in the final boundary.
 *
 * The legacy `createTabCollisionDetector` rejected such tabs to keep
 * piece boundaries free of self-intersections. The pluggable topology
 * pipeline reintroduces the check here.
 *
 * Approach: first identify where the candidate stops overlapping the
 * parent (the splice points between `before`/`bump`/`after`) by
 * sampling unsigned distance to the parent, and record the parent's
 * t-range that the bump replaces. Then extract the bump sub-curve via
 * `splitAt` and intersect ONLY the bump with the parent using
 * bezier-js. Intersections that fall within the replaced range, or
 * within `BUMP_SPLICE_TOLERANCE` of the bump's own start/end, are
 * by-construction touches rather than transverse fold-backs.
 *
 * Why we don't just `candidate.intersect(parent)`: the candidate
 * returned by classicTabGenerator is `join([before, tab, after])`
 * where `before` and `after` are literal slices of the parent. A
 * direct intersect produces 10+ phantom crossings along those overlap
 * regions, which bezier-js's recursive subdivision happily reports
 * even though the curves coincide rather than cross.
 *
 * Why we don't use signed-perpendicular sampling: with sparse samples,
 * shallow fold-backs (where the tab dips just slightly past the parent
 * line) can be missed entirely — all post-dip samples may land on the
 * original side. Bump-only intersect handles sub-pixel crossings
 * exactly via bezier-js's recursive subdivision.
 */
function foldsBackThroughSelf(candidate: Curve, parent: Curve): boolean {
    const n = BUMP_SAMPLE_COUNT;

    // 1. Find the contiguous range of samples whose distance to the
    //    parent exceeds the overlap threshold — this is the bump.
    //    Also record each sample's projection onto the parent so we
    //    can later identify the splice range that the bump replaces.
    let firstFar = -1;
    let lastFar = -1;
    const tOnParentBySample: number[] = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = candidate.pointAt(t);
        const tOnParent = parent.nearestT(p);
        tOnParentBySample[i] = tOnParent;
        const q = parent.pointAt(tOnParent);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d > BUMP_OVERLAP_THRESHOLD) {
            if (firstFar < 0) firstFar = i;
            lastFar = i;
        }
    }
    // No deviation from parent → no bump → no fold-back possible.
    if (firstFar < 0) return false;

    // 2. Identify the parent's t-range that the bump REPLACES. The
    //    samples just before firstFar and just after lastFar are the
    //    last/first ones still on the overlap; their nearest-t on the
    //    parent give us the splice points. Intersections that land in
    //    this range are crossings through a section of the parent that
    //    won't exist in the final geometry — so they're not fold-backs.
    const leftAnchorIdx = Math.max(0, firstFar - 1);
    const rightAnchorIdx = Math.min(n, lastFar + 1);
    let tReplacedStart = tOnParentBySample[leftAnchorIdx];
    let tReplacedEnd = tOnParentBySample[rightAnchorIdx];
    if (tReplacedStart > tReplacedEnd) {
        [tReplacedStart, tReplacedEnd] = [tReplacedEnd, tReplacedStart];
    }

    // 3. Map sample indices back to t with a half-step inset on each
    //    side. The half-step pulls the cut just into the overlap
    //    region, so the extracted bump's endpoints land on the parent
    //    rather than inside the bump.
    const tLeft = Math.max(0, (firstFar - 0.5) / n);
    const tRight = Math.min(1, (lastFar + 0.5) / n);
    if (tRight <= tLeft) return false;

    // 4. Extract the bump sub-curve via two splits. Account for the
    //    parameter rescaling that happens after the first split:
    //    `rest` covers t ∈ [tLeft, 1] on the original curve, so the
    //    local t for tRight on `rest` is (tRight - tLeft) / (1 - tLeft).
    const [, rest] = candidate.splitAt(tLeft);
    const restLocalTRight = (tRight - tLeft) / (1 - tLeft);
    const bump = restLocalTRight > 0 && restLocalTRight < 1
        ? rest.splitAt(restLocalTRight)[0]
        : rest;

    // 5. Intersect the bump with the parent. Skip intersections that:
    //    - sit within `BUMP_SPLICE_TOLERANCE` of the bump's own
    //      endpoints (where the bump rejoins the parent at the splice
    //      points — those are by-construction touches, not crossings);
    //    - land on the parent inside the replaced middle section
    //      (parent t in [tReplacedStart, tReplacedEnd]) — that section
    //      isn't part of the final boundary, so crossing through it is
    //      fine. Anything else is a real fold-back through the
    //      `before`/`after` portion that the candidate keeps.
    const intersections = bump.intersect(parent);
    if (intersections.length === 0) return false;

    const bumpStart = bump.start;
    const bumpEnd = bump.end;
    for (const ix of intersections) {
        const dStart = pointDist(ix.point, bumpStart);
        const dEnd = pointDist(ix.point, bumpEnd);
        if (dStart < BUMP_SPLICE_TOLERANCE) continue;
        if (dEnd < BUMP_SPLICE_TOLERANCE) continue;
        if (ix.tOther >= tReplacedStart && ix.tOther <= tReplacedEnd) continue;
        return true;
    }
    return false;
}

function pointDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}
