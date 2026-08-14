/**
 * Topology is never modified — only each half-edge's `curve` (and its
 * twin's reversed curve) changes. Faces, vertices, connectivity untouched.
 */

import { Curve } from './curve.js';
import type { BoundingBox } from './curve.js';
import type { TopologyGraph, HalfEdge } from './dcel.js';
import type { TabGenerator, TabPolicy, TopologyEdge } from './plugin-types.js';

const ENDPOINT_TOLERANCE = 0.5;          // px — candidate endpoint must match
const CROSSING_ENDPOINT_TOLERANCE = 2;   // px — ignore intersections at endpoint joins
const CROSSING_BBOX_MARGIN = 0.5;        // px — cull margin (control-point box already overshoots)

const BUMP_SAMPLE_COUNT = 60;            // uniform samples across the candidate
const BUMP_OVERLAP_THRESHOLD = 0.5;      // px — samples within this of parent are "on the overlap"
const BUMP_SPLICE_TOLERANCE = 2;         // px — intersections this close to bump endpoints ignored

export interface ApplyTabsOptions {
    /** Optional eligibility filter (default: every internal edge). */
    policy?: TabPolicy;
    /** Tab-generator-specific config, forwarded to TabGenerator.generate. */
    tabConfig?: unknown;
    /**
     * Dev-time hook fired once per eligible edge. `committedVariantIndex`
     * is the 0-based ordinal of the committed variant in the generator's
     * yielded sequence, counting every slot including `null`s (so a
     * skipped rung can't shift later indices); `undefined` when the edge
     * stays flat or the generator has no `generateVariants`.
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

    // Per-edge bbox cache for the crossing cull; invalidated for a pair
    // when its tab commits (the curve grows).
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
 * True if the candidate crosses any OTHER edge away from the original's
 * shared endpoints. Self-crossings are handled by `foldsBackThroughSelf`,
 * not here — a naive `candidate.intersect(parent)` floods on the
 * `before`/`after` parent slices the candidate embeds.
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

    const seen = new Set<number>();
    for (const he of graph.halfEdges) {
        if (seen.has(he.id) || seen.has(he.twin.id)) continue;
        seen.add(he.id);
        seen.add(he.twin.id);
        if (he.id === self.id || he.id === self.twin.id) continue;

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
 * True if the candidate's bump crosses the `before`/`after` overlap
 * regions it KEEPS (crossings through the replaced middle are fine —
 * that section isn't in the final boundary). Prevents self-intersecting
 * piece boundaries.
 *
 * Bump-only intersect, not `candidate.intersect(parent)`: the candidate
 * is `join([before, tab, after])` with `before`/`after` literal parent
 * slices, so a direct intersect reports phantom overlap crossings. Not
 * signed-perpendicular sampling either — sparse samples miss shallow
 * fold-backs; bezier-js subdivision catches sub-pixel crossings exactly.
 */
function foldsBackThroughSelf(candidate: Curve, parent: Curve): boolean {
    const n = BUMP_SAMPLE_COUNT;

    let firstFar = -1;
    let lastFar = -1;
    // Float64Array, not `new Array(n)` (banned by `unicorn/no-new-array`)
    // nor `Array.from({length})` (much slower, walks the array-like
    // protocol): every index is written before read, so a raw sized
    // allocation is safe on this hot path.
    const tOnParentBySample = new Float64Array(n + 1);
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
    if (firstFar < 0) return false;

    // Samples bracketing [firstFar, lastFar] give the parent t-range the
    // bump REPLACES; crossings inside it aren't fold-backs (that section
    // won't exist in the final geometry).
    const leftAnchorIdx = Math.max(0, firstFar - 1);
    const rightAnchorIdx = Math.min(n, lastFar + 1);
    let tReplacedStart = tOnParentBySample[leftAnchorIdx];
    let tReplacedEnd = tOnParentBySample[rightAnchorIdx];
    if (tReplacedStart > tReplacedEnd) {
        [tReplacedStart, tReplacedEnd] = [tReplacedEnd, tReplacedStart];
    }

    // Half-step inset pulls the cut into the overlap so the extracted
    // bump's endpoints land on the parent, not inside the bump.
    const tLeft = Math.max(0, (firstFar - 0.5) / n);
    const tRight = Math.min(1, (lastFar + 0.5) / n);
    if (tRight <= tLeft) return false;

    // After splitAt(tLeft), `rest` spans t ∈ [tLeft, 1]; rescale tRight
    // into rest-local coords: (tRight - tLeft) / (1 - tLeft).
    const [, rest] = candidate.splitAt(tLeft);
    const restLocalTRight = (tRight - tLeft) / (1 - tLeft);
    const bump = restLocalTRight > 0 && restLocalTRight < 1
        ? rest.splitAt(restLocalTRight)[0]
        : rest;

    // Skip touches within BUMP_SPLICE_TOLERANCE of the bump's endpoints
    // (by-construction rejoins) and crossings inside the replaced middle
    // (not in the final boundary). Anything else is a real fold-back.
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
