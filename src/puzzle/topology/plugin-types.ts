/**
 * Plug-in interfaces for the Composable framework.
 *
 * The framework owns intersection finding, topology construction,
 * tab collision rejection, and face → piece extraction. Plug-ins
 * provide the cuts (BaseCutGenerator) and the tab shapes
 * (TabGenerator). Neither plug-in sees the topology graph
 * directly — they get pure-function inputs and return pure-function
 * outputs, which the framework then validates.
 */

import type { Curve } from './curve.js';
import type { Size } from '../../model/types.js';

/**
 * Produces the input cuts for a puzzle.
 *
 * Receives the puzzle frame size, a seeded PRNG, and an opaque
 * generator-specific config object. Returns the cuts (border
 * curves AND internal cut lines).
 *
 * Convention: the FIRST four curves in the returned array are
 * always the four border lines (top, right, bottom, left), in
 * that order. The framework relies on this for tab eligibility
 * (border edges never get tabs).
 */
export interface BaseCutGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Generate the cuts.
     * @param frame - puzzle pixel dimensions
     * @param random - seeded PRNG (call counts must be deterministic
     *   per (id, config) so share-links round-trip)
     * @param config - generator-specific opaque config; the generator
     *   validates and casts internally
     */
    generate(frame: Size, random: () => number, config: unknown): Curve[];
}

/**
 * Produces a tab shape for a single edge.
 *
 * Receives the edge's current curve (the segment between the
 * edge's two vertices) and a seeded PRNG. Returns the tab
 * candidate as a DECOMPOSITION — an array of curves whose
 * combined endpoints (the first curve's start, the last curve's
 * end) match the input edge's endpoints. The framework enforces
 * this. Return null to leave the edge flat.
 *
 * Why a decomposition rather than a single joined curve? The
 * framework feeds each entry as a separate cut into the second
 * DCEL pass, so any self-crossings between adjacent pieces of the
 * decomposition (e.g. a tab's bump folding back through its own
 * before/after slices) materialise as cross-curve intersections
 * the second pass can detect. A single joined curve would hide
 * those intra-curve self-crossings from the intersection finder.
 *
 * A generator that doesn't need a decomposition can return a
 * single-element array `[curve]`; one that declines to decorate
 * the edge returns `null`.
 *
 * The candidate may protrude outside the original edge's bounding
 * box. The framework checks the combined candidate against all
 * other edge curves in the graph; if any piece would introduce a
 * new crossing with a neighbouring edge, the whole candidate is
 * rejected and the original (flat) sub-curve emitted instead.
 *
 * The generator does NOT see neighbouring edges or pieces — by
 * design. Tabs that genuinely need to mesh with neighbours are
 * a BaseCutGenerator concern, not a TabGenerator concern.
 */
export interface TabGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Generate a tab candidate decomposition for the given edge curve.
     * @returns an array of curves whose combined endpoints match
     *   `edge.start` and `edge.end`, or null to leave the edge flat
     */
    generate(edge: Curve, random: () => number, config: unknown): Curve[] | null;
}

/**
 * Optional eligibility filter for tab placement.
 *
 * Defaults to "all internal edges" (i.e. every edge whose twin
 * belongs to a non-outer face). A generator can supply a stricter
 * policy — e.g. skip edges shorter than some threshold — without
 * changing the tab generator itself.
 */
export type TabPolicy = (edge: TopologyEdge) => boolean;

/**
 * Lightweight view of a half-edge, exposed to TabPolicy.
 * Doesn't expose neighbours or curves — keeps policies simple.
 *
 * Border edges (where one side is the outer face) are filtered out
 * before the policy is invoked, so a policy only ever sees internal
 * edges.
 */
export interface TopologyEdge {
    readonly id: number;
    /** Arc length of the edge's current curve, in pixels. */
    readonly length: number;
}
