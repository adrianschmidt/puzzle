/**
 * Tab merging for the topology-driven pipeline.
 *
 * Merges tab shapes into cut lines by REPLACING a segment of the cut
 * with the tab path. The tab becomes part of the cut line itself.
 *
 * Uses the curve-clamping approach from tab-clamping-reference.md:
 * - Bisection to find anchor points at a fixed chord distance
 * - Tangent/normal frame from the anchor chord
 * - Tab shape transformed and spliced into the curve
 *
 * Pipeline:
 * 1. For each cut line, identify intersections → edge segments
 * 2. For each internal edge segment, bisect for anchor points
 * 3. Transform tab shape onto the anchor chord
 * 4. Replace the curve segment between anchors with the tab
 * 5. Reassemble modified edges back into full cut lines
 *
 * See issue #169 and docs/composable-reference/tab-clamping-reference.md
 */

import type { Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BezierSegment } from './curve.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { BezierPath } from '../composable/bezier-path.js';
import { mirrorBezierPathY } from '../composable/bezier-path.js';
import type { CollisionDetector, ConflictResolver } from './collision.js';
import {
    createTabCollisionDetector,
    createSkipOnCollisionResolver,
} from './collision.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parameters controlling tab placement on edges.
 */
export interface TabPlacementConfig {
    /** Minimum edge arc length (in pixels) to receive a tab. */
    minEdgeLength: number;
    /** Allowed range for tab centre position along the edge (0–1). */
    centreRange: [number, number];
}

export const DEFAULT_TAB_PLACEMENT: TabPlacementConfig = {
    minEdgeLength: 20,
    centreRange: [0.3, 0.7],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of preparing a tab for merging — contains the tab curve
 * and the split pieces needed to assemble the final curve.
 */
export interface PreparedTab {
    /** The tab curve in world coordinates. */
    tabCurve: Curve;
    /** The curve segment before the tab splice point. */
    before: Curve;
    /** The curve segment after the tab splice point. */
    after: Curve;
}

/**
 * Generate and position a tab on a curve WITHOUT merging it.
 *
 * Returns the tab curve in world coordinates along with the before/after
 * segments needed to assemble the final curve. Returns null if the tab
 * is too wide for the edge.
 *
 * This is used by collision detection to inspect the tab before committing.
 */
export function prepareTab(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
): PreparedTab | null {
    // Generate tab shape in normalized space
    let normalizedPath = template.generate(random);
    if (!isTab) {
        normalizedPath = mirrorBezierPathY(normalizedPath);
    }

    // The template's start/end x-values define how much of the edge
    // the tab occupies. These are fractions of edge length.
    const templateStartX = normalizedPath[0].x;
    const templateEndX = normalizedPath[normalizedPath.length - 1].x;

    // All placement is done in arc-length fraction space (s ∈ [0,1]),
    // then converted to uniform t for the actual curve splitting.
    // This is critical for multi-segment curves where uniform t
    // distributes across segment indices, NOT proportional to length.

    const templateMidX = (templateStartX + templateEndX) / 2;

    // Compute the FULL x-extent of the tab (including head control
    // points that bulge beyond the neck splice points).
    const allXs = normalizedPath.map(p => p.x);
    const tabMinX = Math.min(...allXs);
    const tabMaxX = Math.max(...allXs);

    // Full tab extent from centre (in edge-length fractions)
    const headOverhangLeft = templateMidX - tabMinX;
    const headOverhangRight = tabMaxX - templateMidX;

    // Enforce edge margins: the tab's full extent (including head)
    // must stay at least `margin` from both edge endpoints.
    const margin = 0.12;
    const sCenterMin = margin + headOverhangLeft;
    const sCenterMax = 1 - margin - headOverhangRight;

    if (sCenterMax < sCenterMin) {
        // Tab is too wide for this edge — skip it entirely
        return null;
    }

    // tCenter was generated in [0,1] as a placement hint. Treat it as
    // an arc-length fraction and clamp to margins.
    let sCenter = Math.max(sCenterMin, Math.min(sCenterMax, tCenter));

    // Splice points in arc-length space
    const sLeft = Math.max(0.001, sCenter + (templateStartX - templateMidX));
    const sRight = Math.min(0.999, sCenter + (templateEndX - templateMidX));

    // Convert arc-length fractions to uniform t
    const tLeft = curve.arcLengthToT(sLeft);
    const tRight = curve.arcLengthToT(sRight);

    // Get anchor points on the curve
    const pLeft = curve.pointAt(tLeft);
    const pRight = curve.pointAt(tRight);

    // Transform tab from template space to edge coordinates.
    // Both x and y are edge-length fractions — scale both by edge length.
    const edgeLength = curve.arcLength();
    const transformedPath = transformTabToEdge(
        normalizedPath, pLeft, pRight, edgeLength,
    );

    // Split the curve using segment-local coordinates to avoid
    // global-t remapping precision loss. The uniform t distribution
    // across segments breaks down after splitting because the first
    // segment of `rest` is a partial segment with different arc length
    // than full segments, yet pointAt/splitAt treat all segments equally.
    const leftResolved = curve.resolveTWithIndex(tLeft);
    const rightResolved = curve.resolveTWithIndex(tRight);

    const [before, rest] = curve.splitAtSegmentLocal(
        leftResolved.segmentIndex, leftResolved.localT,
    );

    // Compute the right split point relative to `rest`.
    // `rest` starts with the right portion of the segment that was split.
    // If tRight is in a different segment than tLeft, we need to adjust
    // the segment index (subtract the segments consumed by `before`).
    // If tRight is in the SAME segment as tLeft, we need to remap localT
    // within the remaining portion of that segment.
    let restSegIndex: number;
    let restLocalT: number;

    if (rightResolved.segmentIndex === leftResolved.segmentIndex) {
        // Same segment: rest's first segment is the right portion after
        // splitting at leftResolved.localT. Remap rightResolved.localT
        // into [0,1] of the remaining portion.
        restSegIndex = 0;
        const remainingRange = 1 - leftResolved.localT;
        restLocalT = remainingRange > 1e-10
            ? (rightResolved.localT - leftResolved.localT) / remainingRange
            : 0.5;
    } else {
        // Different segment: rest's segment 0 is the tail of the split
        // segment, then segments follow in order. The right split point
        // is in segment (rightResolved.segmentIndex - leftResolved.segmentIndex)
        // of `rest`, with the same localT.
        restSegIndex = rightResolved.segmentIndex - leftResolved.segmentIndex;
        restLocalT = rightResolved.localT;
    }

    const [_middle, after] = rest.splitAtSegmentLocal(restSegIndex, restLocalT);

    // Snap the transformed tab endpoints to the exact split points
    // to ensure perfect continuity (no gaps between segments).
    const snappedPath = [...transformedPath];
    snappedPath[0] = { ...before.end };
    snappedPath[snappedPath.length - 1] = { ...after.start };

    const tabCurve = Curve.fromBezierPath(snappedPath);
    return { tabCurve, before, after };
}

/**
 * Assemble a prepared tab into a single curve.
 */
export function commitTab(prepared: PreparedTab): Curve {
    return joinCurves([prepared.before, prepared.tabCurve, prepared.after]);
}

/**
 * Merge a tab shape into a curve.
 *
 * The template's x and y values are both fractions of edge length.
 * The template determines the tab's width (via its x-extent) and
 * height (via its y values) independently — no coupling between them.
 *
 * The curve is split at the template's start/end x-positions
 * (relative to tCenter), and the tab replaces that segment.
 *
 * @param curve - The edge curve segment
 * @param tCenter - Where on the curve to place the tab (0–1)
 * @param isTab - True for protrusion, false for socket
 * @param template - Tab shape template
 * @param random - Seeded PRNG for shape variation
 * @returns A new Curve with the tab spliced in
 */
export function mergeTabIntoCurve(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
): Curve {
    const prepared = prepareTab(curve, tCenter, isTab, template, random);
    if (!prepared) return curve;
    return commitTab(prepared);
}

/**
 * Determine if and where to place a tab on an edge segment.
 *
 * @returns { tCenter, isTab } or null if the edge is too short
 */
export function computeTabPlacement(
    curve: Curve,
    config: TabPlacementConfig,
    random: () => number,
): { tCenter: number; isTab: boolean } | null {
    const length = curve.arcLength();

    if (length < config.minEdgeLength) {
        return null;
    }

    // Don't place tabs if the edge is too short for the tab fraction
    // (the tab itself would consume most of the edge)
    if (length < config.minEdgeLength * 1.5) {
        return null;
    }

    const tCenter = lerp(config.centreRange[0], config.centreRange[1], random());
    const isTab = random() > 0.5;

    return { tCenter, isTab };
}

/**
 * Options for collision handling during tab merging.
 */
export interface CollisionOptions {
    /** Collision detector implementation. Default: tab-line detector. */
    detector?: CollisionDetector;
    /** Conflict resolver implementation. Default: skip on collision. */
    resolver?: ConflictResolver;
}

/**
 * Merge tabs into all internal edges of a set of cut lines.
 *
 * This is the high-level function: takes raw cuts, finds intersections
 * to identify edge segments, places tabs on each internal segment,
 * and returns modified curves ready for DCEL construction.
 *
 * When collision options are provided, each tab is checked against all
 * other curves before being committed. The resolver decides what to do
 * on collision (by default: skip the tab).
 */
export function mergeTabsIntoCuts(
    curves: Curve[],
    borderIndices: Set<number>,
    template: TabTemplate,
    config: TabPlacementConfig,
    random: () => number,
    collision?: CollisionOptions,
): Curve[] {
    const detector = collision?.detector ?? createTabCollisionDetector();
    const resolver = collision?.resolver ?? createSkipOnCollisionResolver();
    const result: Curve[] = [];

    for (let i = 0; i < curves.length; i++) {
        if (borderIndices.has(i)) {
            result.push(curves[i]);
            continue;
        }

        // Find intersections with all other curves → split parameters
        const splitTs = findSplitParameters(curves[i], curves, i);

        if (splitTs.length === 0) {
            // Single edge, place one tab (with collision check)
            const placement = computeTabPlacement(curves[i], config, random);
            if (placement) {
                const merged = mergeTabWithCollisionCheck(
                    curves[i], placement.tCenter, placement.isTab,
                    template, random, result, curves, i, detector, resolver,
                );
                result.push(merged);
            } else {
                result.push(curves[i]);
            }
            continue;
        }

        // Split into edge segments, merge tab into each, rejoin
        const modifiedCurve = mergeTabsIntoSegments(
            curves[i], splitTs, config, template, random,
            result, curves, i, detector, resolver,
        );
        result.push(modifiedCurve);
    }

    return result;
}

/**
 * Merge a tab into a curve with collision detection.
 *
 * Prepares the tab, checks for collisions against all other curves,
 * and uses the resolver to decide whether to keep or skip it.
 */
function mergeTabWithCollisionCheck(
    curve: Curve,
    tCenter: number,
    isTab: boolean,
    template: TabTemplate,
    random: () => number,
    processedCurves: Curve[],
    originalCurves: Curve[],
    selfIndex: number,
    detector: CollisionDetector,
    resolver: ConflictResolver,
): Curve {
    const prepared = prepareTab(curve, tCenter, isTab, template, random);
    if (!prepared) return curve;

    // Build the list of curves to check against:
    // - Already-processed curves (with their tabs)
    // - Not-yet-processed curves (original form)
    const allCurves = buildCurrentCurveState(
        processedCurves, originalCurves,
    );

    const collides = detector.hasCollision(
        prepared.tabCurve, allCurves, selfIndex,
    );
    const merged = commitTab(prepared);
    return resolver.resolve(curve, merged, collides);
}

/**
 * Build a snapshot of all curves in their current state for collision
 * checking. Curves already processed use their tab-modified form;
 * curves not yet processed use their original form.
 */
function buildCurrentCurveState(
    processedCurves: Curve[],
    originalCurves: Curve[],
): Curve[] {
    const state: Curve[] = [];
    for (let j = 0; j < originalCurves.length; j++) {
        if (j < processedCurves.length) {
            state.push(processedCurves[j]);
        } else {
            state.push(originalCurves[j]);
        }
    }
    return state;
}

// ---------------------------------------------------------------------------
// Tab transformation
// ---------------------------------------------------------------------------

/**
 * Transform a tab BezierPath from template space to world coordinates.
 *
 * Template x and y are both fractions of edge length. The transform
 * maps them onto the edge using the tangent/normal frame at the
 * anchor chord (pLeft → pRight).
 *
 * x is positioned along the edge direction, y perpendicular to it.
 * Both are scaled by edgeLength, keeping width and height independent.
 */
function transformTabToEdge(
    path: BezierPath,
    pLeft: Point,
    pRight: Point,
    edgeLength: number,
): BezierPath {
    const dx = pRight.x - pLeft.x;
    const dy = pRight.y - pLeft.y;
    const chordLen = Math.sqrt(dx * dx + dy * dy);

    // Unit vectors along and perpendicular to the chord
    const ux = dx / chordLen;
    const uy = dy / chordLen;
    // Perpendicular — tab protrudes left of travel direction
    const px = -uy;
    const py = ux;

    // The midpoint of the chord anchors the tab centre.
    // Both x and y are edge-length fractions — scale both by edgeLength.
    // x is positioned along the chord direction relative to the chord
    // midpoint, y is perpendicular to it.
    const templateStartX = path[0].x;
    const templateEndX = path[path.length - 1].x;
    const templateMidX = (templateStartX + templateEndX) / 2;

    // Chord midpoint in world space
    const midX = (pLeft.x + pRight.x) / 2;
    const midY = (pLeft.y + pRight.y) / 2;

    return path.map(p => {
        // x offset from template centre, scaled by edge length
        const alongChord = (p.x - templateMidX) * edgeLength;

        // y is a fraction of edge length, scaled directly
        const perpendicular = p.y * edgeLength;

        return {
            x: midX + alongChord * ux + perpendicular * px,
            y: midY + alongChord * uy + perpendicular * py,
        };
    });
}

// ---------------------------------------------------------------------------
// Intersection and splitting helpers
// ---------------------------------------------------------------------------

/**
 * Find all t-parameters where other curves intersect this curve.
 */
function findSplitParameters(
    curve: Curve,
    allCurves: Curve[],
    selfIndex: number,
): number[] {
    const ts: number[] = [];

    for (let j = 0; j < allCurves.length; j++) {
        if (j === selfIndex) continue;

        const intersections = curve.intersect(allCurves[j]);
        for (const ix of intersections) {
            ts.push(ix.tSelf);
        }

        // T-junctions: other curve endpoints on this curve
        for (const endpoint of [allCurves[j].start, allCurves[j].end]) {
            const t = curve.nearestT(endpoint);
            const projected = curve.pointAt(t);
            const d = Math.sqrt(
                (projected.x - endpoint.x) ** 2 +
                (projected.y - endpoint.y) ** 2,
            );
            if (d < 3 && t > 0.01 && t < 0.99) {
                ts.push(t);
            }
        }
    }

    // Sort and deduplicate
    return [...new Set(ts.map(t => Math.round(t * 1e4) / 1e4))]
        .sort((a, b) => a - b)
        .filter(t => t > 0.01 && t < 0.99);
}

/**
 * Split a curve at the given t-parameters, merge a tab into each segment,
 * and rejoin into a single curve.
 *
 * Uses segment-local splitting with a backwards strategy to avoid the
 * uniform-t error that occurs with sequential splitAt() on multi-segment
 * curves. After any split, the resulting sub-curves have unequal segment
 * lengths, so uniform-t no longer maps linearly to arc position.
 *
 * By resolving all t-parameters on the ORIGINAL curve and then splitting
 * backwards (last split first), each split only affects segments AFTER
 * it — leaving earlier segment indices and localT values valid.
 */
function mergeTabsIntoSegments(
    curve: Curve,
    splitTs: number[],
    config: TabPlacementConfig,
    template: TabTemplate,
    random: () => number,
    processedCurves: Curve[],
    originalCurves: Curve[],
    selfIndex: number,
    detector: CollisionDetector,
    resolver: ConflictResolver,
): Curve {
    // Resolve all t-parameters on the original (unsplit) curve.
    const resolved = splitTs
        .filter(t => t > 0.01 && t < 0.99)
        .map(t => curve.resolveTWithIndex(t));

    if (resolved.length === 0) {
        const placement = computeTabPlacement(curve, config, random);
        if (placement) {
            const prepared = prepareTab(
                curve, placement.tCenter, placement.isTab, template, random,
            );
            if (prepared) {
                const allCurves = buildCurrentCurveState(
                    processedCurves, originalCurves,
                );
                const collides = detector.hasCollision(
                    prepared.tabCurve, allCurves, selfIndex,
                );
                const merged = commitTab(prepared);
                return resolver.resolve(curve, merged, collides);
            }
        }
        return curve;
    }

    // Split backwards: from the last split point to the first.
    // Each split produces [left, right]. We keep `right` as a segment
    // and continue splitting `left` at the next (earlier) split point.
    //
    // When two splits land in the same Bézier segment, the earlier split
    // (processed later in backwards order) sees a truncated segment.
    // We must remap its localT: if segment was truncated at localT=T₁,
    // an original localT=T₀ (where T₀ < T₁) maps to T₀/T₁ in the
    // truncated segment.
    const tailSegments: Curve[] = []; // collected in reverse order
    let remaining = curve;

    // Track the truncation upper bound per segment. After splitting
    // segment S at localT=T, the left portion spans [0, T]. If we
    // split again at T' < T, we need adjustedT = T'/T.
    const segTruncation = new Map<number, number>();

    for (let i = resolved.length - 1; i >= 0; i--) {
        const { segmentIndex, localT } = resolved[i];

        if (segmentIndex < 0 || segmentIndex >= remaining.segments.length) {
            continue;
        }

        // Remap if this segment was already truncated by a later split
        let adjustedLocalT = localT;
        const truncatedAt = segTruncation.get(segmentIndex);
        if (truncatedAt !== undefined && truncatedAt > 1e-10) {
            adjustedLocalT = localT / truncatedAt;
        }

        const [left, right] = remaining.splitAtSegmentLocal(
            segmentIndex, adjustedLocalT,
        );
        tailSegments.push(right);
        remaining = left;

        // Update truncation: this segment now spans [0, localT] of the
        // original. Any future split in this segment needs remapping
        // relative to localT (not the already-remapped adjustedLocalT).
        segTruncation.set(segmentIndex, localT);
    }

    // remaining is everything before the first split point
    tailSegments.push(remaining);
    tailSegments.reverse();

    // Now tailSegments[0] = before first split,
    // tailSegments[1] = between split 0 and split 1, etc.

    // Merge tab into each segment. We need deterministic random values
    // per segment, so process in forward order. The random sequence is
    // consumed in order regardless of split direction.
    const allCurves = buildCurrentCurveState(
        processedCurves, originalCurves,
    );
    const modified: Curve[] = [];
    for (const seg of tailSegments) {
        const placement = computeTabPlacement(seg, config, random);
        if (placement) {
            const prepared = prepareTab(
                seg, placement.tCenter, placement.isTab, template, random,
            );
            if (prepared) {
                const collides = detector.hasCollision(
                    prepared.tabCurve, allCurves, selfIndex,
                );
                const merged = commitTab(prepared);
                modified.push(resolver.resolve(seg, merged, collides));
            } else {
                modified.push(seg);
            }
        } else {
            modified.push(seg);
        }
    }

    return joinCurves(modified);
}

// ---------------------------------------------------------------------------
// Curve joining
// ---------------------------------------------------------------------------

/**
 * Join multiple curves into a single curve by concatenating segments.
 */
function joinCurves(curves: Curve[]): Curve {
    const allSegments: BezierSegment[] = [];
    for (const c of curves) {
        for (const seg of c.segments) {
            const len = Math.sqrt(
                (seg.p3.x - seg.p0.x) ** 2 + (seg.p3.y - seg.p0.y) ** 2,
            );
            if (len < 1e-6) continue;
            allSegments.push(seg);
        }
    }

    if (allSegments.length === 0) {
        return curves[0];
    }

    return new Curve(allSegments);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}
