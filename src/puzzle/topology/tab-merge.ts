/**
 * Legacy tab merging pipeline.
 *
 * This file is scheduled for deletion in Plan 3 Task 6. The tab placement
 * primitives (prepareTab, commitTab, computeTabPlacement, etc.) now live
 * in classic-tab-generator.ts; this file imports them for the legacy
 * mergeTabsIntoCuts code path until that path is removed.
 *
 * See issue #169 and docs/composable-reference/tab-clamping-reference.md
 */

import { Curve } from './curve.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import type { CollisionDetector, ConflictResolver } from './collision.js';
import {
    createTabCollisionDetector,
    createSkipOnCollisionResolver,
} from './collision.js';
import {
    prepareTab,
    commitTab,
    computeTabPlacement,
    findSplitParameters,
    joinCurves,
    DEFAULT_TAB_PLACEMENT,
} from './classic-tab-generator.js';
import type {
    TabPlacementConfig,
    PreparedTab,
} from './classic-tab-generator.js';

// Re-export the primitives so existing tab-merge.ts importers continue to
// work until those importers (tab-merge.test.ts and parts of
// collision.test.ts) are deleted in Task 6.
export {
    prepareTab,
    commitTab,
    computeTabPlacement,
    DEFAULT_TAB_PLACEMENT,
};
export type { TabPlacementConfig, PreparedTab };

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
