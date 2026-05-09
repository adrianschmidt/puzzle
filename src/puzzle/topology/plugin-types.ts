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
 * edge's two vertices) and a seeded PRNG. Returns a candidate
 * curve with the SAME endpoints as the input — the framework
 * enforces this — or null to leave the edge flat.
 *
 * The candidate may protrude outside the original edge's bounding
 * box. The framework checks the candidate against all other edge
 * curves in the graph; if the candidate would introduce a new
 * crossing, the original edge is kept and the candidate discarded.
 *
 * The generator does NOT see neighbouring edges or pieces — by
 * design. Tabs that genuinely need to mesh with neighbours are
 * a BaseCutGenerator concern, not a TabGenerator concern.
 */
export interface TabGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Generate a tab candidate for the given edge curve.
     * @returns a curve with the same start/end as `edge`, or null
     *   to leave the edge flat
     */
    generate(edge: Curve, random: () => number, config: unknown): Curve | null;
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
 */
export interface TopologyEdge {
    readonly id: number;
    /** Arc length of the edge's current curve, in pixels. */
    readonly length: number;
    /** True if either side of the edge is the outer (unbounded) face. */
    readonly isBorder: boolean;
}
