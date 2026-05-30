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
import type { BoundingBox } from './curve.js';
import type { TopologyGraph, HalfEdge } from './dcel.js';
import type { TabGenerator, TabPolicy, TopologyEdge } from './plugin-types.js';

const ENDPOINT_TOLERANCE = 0.5;          // px — candidate endpoint must match
const CROSSING_ENDPOINT_TOLERANCE = 2;   // px — ignore intersections at endpoint joins
const CROSSING_BBOX_MARGIN = 0.5;        // px — conservative cull margin; the control-point box already overshoots the drawn curve

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
     * Optional dev-time hook fired once per eligible edge with whether
     * a tab was committed. Receives the half-edge, whether the
     * framework's collision / fold-back checks let a candidate through,
     * and — for a variant generator — the 0-based ordinal of the
     * committed variant in the generator's best-first sequence (0 = the
     * base tab, 1+ = a retry rung). `committedVariantIndex` is
     * `undefined` when the edge stays flat or the generator has no
     * `generateVariants` (no rung concept).
     *
     * Intended for debug instrumentation (e.g. correlating each tab
     * with the piece it ended up on, or measuring per-rung retry
     * recovery). Production paths leave this unset and pay an extra
     * branch only — `applyTabs` callers that don't care don't need to
     * wire anything up.
     */
    onCandidate?: (
        he: HalfEdge,
        accepted: boolean,
        committedVariantIndex?: number,
    ) => void;
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

    // Per-edge bounding-box cache for the crossing cull. Invalidated for
    // a half-edge pair when a tab is committed (its curve grows).
    const boxes = new Map<number, BoundingBox>();
    const boxOf = (he: HalfEdge): BoundingBox => {
        let b = boxes.get(he.id);
        if (!b) { b = he.curve.boundingBox(); boxes.set(he.id, b); }
        return b;
    };

    for (const he of sharedEdges) {
        const view: TopologyEdge = {
            id: he.id,
            length: he.curve.arcLength(),
        };
        if (!policy(view)) continue;

        let chosen: Curve | null = null;
        let chosenIndex: number | undefined;
        if (generator.generateVariants) {
            let i = -1;
            for (const variant of generator.generateVariants(he.curve, random, tabConfig)) {
                i++;
                if (!variant) continue;
                if (isAcceptable(variant, he, graph, boxOf)) {
                    chosen = variant;
                    chosenIndex = i;
                    break;
                }
            }
        } else {
            const candidate = generator.generate(he.curve, random, tabConfig);
            if (candidate && isAcceptable(candidate, he, graph, boxOf)) {
                chosen = candidate;
            }
        }

        options.onCandidate?.(he, chosen !== null, chosenIndex);
        if (!chosen) continue;

        he.curve = chosen;
        he.twin.curve = chosen.reverse();
        boxes.delete(he.id);
        boxes.delete(he.twin.id);
    }
}

const defaultTabPolicy: TabPolicy = () => true;

function isAcceptable(
    candidate: Curve,
    self: HalfEdge,
    graph: TopologyGraph,
    boxOf: (he: HalfEdge) => BoundingBox,
): boolean {
    return (
        endpointsMatch(candidate, self.curve) &&
        !foldsBackThroughSelf(candidate, self.curve) &&
        !introducesNewCrossing(candidate, self, graph, boxOf)
    );
}

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
    boxOf: (he: HalfEdge) => BoundingBox,
): boolean {
    const candStart = candidate.start;
    const candEnd = candidate.end;
    const candBox = candidate.boundingBox();

    // Check each twin pair once; skip self and self.twin (the candidate
    // IS self's new curve). Cull pairs whose boxes can't overlap.
    const seen = new Set<number>();
    for (const he of graph.halfEdges) {
        if (seen.has(he.id) || seen.has(he.twin.id)) continue;
        seen.add(he.id);
        seen.add(he.twin.id);
        if (he.id === self.id || he.id === self.twin.id) continue;

        // Cull: boxes that can't overlap can't intersect.
        if (!boxesOverlap(candBox, boxOf(he), CROSSING_BBOX_MARGIN)) continue;

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
 * Why we don't just `candidate.intersect(parent)`: every candidate
 * built via the shared `prepareTab` / `commitTab` helpers (both classic
 * and traced) is `join([before, tab, after])` where `before` and
 * `after` are literal slices of the parent. A direct intersect
 * produces 10+ phantom crossings along those overlap regions, which
 * bezier-js's recursive subdivision happily reports even though the
 * curves coincide rather than cross.
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

function boxesOverlap(a: BoundingBox, b: BoundingBox, margin: number): boolean {
    return (
        a.minX - margin <= b.maxX &&
        a.maxX + margin >= b.minX &&
        a.minY - margin <= b.maxY &&
        a.maxY + margin >= b.minY
    );
}
