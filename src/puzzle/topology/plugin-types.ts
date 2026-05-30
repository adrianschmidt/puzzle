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
import type { TabTemplate } from '../composable/tab-shapes.js';

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
    /**
     * Optional: yield an ordered set of candidate curves (best first) for
     * one edge. When present, the framework commits the FIRST non-null
     * candidate that passes its accept gates (endpoint match, no fold-back,
     * no new crossing) and ignores the rest; if none pass, the edge stays
     * flat.
     *
     * A generator may yield `null` for a slot whose candidate couldn't be
     * built (e.g. a rung whose splice failed). The framework skips nulls,
     * but they still occupy a position — so yielding a stable one-slot-per-
     * rung sequence (nulls included) keeps `committedVariantIndex` (see
     * {@link ApplyTabsOptions.onCandidate}) equal to the fixed rung index.
     *
     * All PRNG draws MUST happen before the first yield, so per-edge
     * randomness consumption is independent of how many candidates the
     * framework ends up trying. Generators without retry semantics omit
     * this and rely on {@link generate}.
     */
    generateVariants?(edge: Curve, random: () => number, config: unknown): Iterable<Curve | null>;
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

/**
 * Splices a tab template onto a parent edge at a chosen placement.
 *
 * A `TabSplicer` is the "how to attach" half of tab generation: given
 * a position along the edge, a template, and a PRNG, it produces the
 * final curve that replaces the spliced section. Different splicers
 * can use the same `TabTemplate` but attach it differently — e.g. a
 * standard splicer that joins the tab to the parent edge with C0
 * continuity (matching positions only) vs. a smoothed splicer that
 * also tangent-aligns the tab's end controls so the join is C1
 * (smooth direction across the splice).
 *
 * Splicers compose with the shared placement primitives
 * (`prepareTab`, `commitTab`) from `tab-generator-helpers.ts`. The
 * choice of splicer is currently a per-`TabGenerator` decision — each
 * generator imports the splicer it wants. If a future need calls for
 * cut-style-level overrides, the lookup can move to the cut-style
 * strategy without changing this interface.
 */
export interface TabSplicer {
    /** Stable id for debug/logs; not part of any share-link contract. */
    readonly id: string;
    /**
     * Build the spliced curve. Returns null if the placement is
     * invalid (e.g. the tab would consume more of the edge than the
     * placement margins allow).
     */
    splice(
        edge: Curve,
        placement: { tCenter: number; isTab: boolean },
        template: TabTemplate,
        random: () => number,
    ): Curve | null;
}
