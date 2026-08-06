/**
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
 * Convention: the FIRST four curves in the returned array are
 * always the four border lines (top, right, bottom, left), in
 * that order. The framework relies on this for tab eligibility
 * (border edges never get tabs).
 */
export interface BaseCutGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Whether this generator supports borderless mode — i.e. it knows how
     * to oversize its grid by one piece on each side so the framework can
     * strip the outer ring (see strip-border-ring.ts). Grid-based
     * generators (sine) set this; generators without a grid concept (Venn)
     * leave it falsy, and a borderless request is then ignored.
     *
     * Contract: the strip pass (strip-border-ring.ts) identifies the ring
     * to remove as "every piece with a border edge", which equals the
     * 1-deep outer ring ONLY for a hole-free, convex rectangular grid. A
     * generator that opts in MUST produce such a layout when oversized; one
     * with holes or concavities would have interior border edges and would
     * be mis-stripped. The sine grid satisfies this; that is why it is the
     * only generator advertising support today.
     */
    readonly supportsBorderless?: boolean;
    /**
     * The number of faces this generator intends to produce for `config`,
     * or undefined when it cannot say.
     *
     * Receives the SAME opaque config object `generate` gets, so a generator
     * applies its own sizing rule (borderless oversizing included) without the
     * framework having to encode it. The framework compares the value against
     * the faces actually extracted, BEFORE composition and BEFORE the border
     * strip, and reports a mismatch (see `TopologyPuzzle.pieceCountMismatch`).
     *
     * Implementing it: derive the count from the SAME code `generate` uses to
     * read its config — one shared helper, not two independent readings of the
     * same fields. Receiving the same opaque object is not enough on its own,
     * because each side then applies its own defaults and its own sizing and
     * nothing checks that those agree. `sine-cut-generator.ts` factors this
     * out as `resolveGrid` for exactly that reason, and records the evidence:
     * before the extraction existed, changing one side's defaults without the
     * other's left the whole suite green. A check that silently stops checking
     * is worse than no check, because it reads as a clean signal.
     *
     * Optional on purpose. Only a generator whose output count is a knowable
     * function of its config should implement it; the other two omit it and
     * are exempt rather than permanently false-positive, for different
     * reasons. Venn circles produce a count unrelated to cols x rows. The
     * triangular lattice's count IS derivable — `estimateTriangleFaceCount`
     * already does it, and the Triangles cut style depends on it — but only
     * exactly for `jitter: 0, smooth: false`; the shipped preset's jitter and
     * bowing add or drop the odd micro-face, which is the same "intent, not a
     * guarantee" problem that makes the estimate unusable as an invariant. It
     * would also need the frame, which this signature does not pass — a
     * trailing `frame: Size` parameter is backward-compatible whenever a
     * generator that can use it turns up, so nothing here forecloses it.
     */
    expectedPieceCount?(config: unknown): number | undefined;
    /**
     * @param frame - puzzle pixel dimensions
     * @param random - seeded PRNG (call counts must be deterministic
     *   per (id, config) so share-links round-trip)
     * @param config - generator-specific opaque config; the generator
     *   validates and casts internally
     */
    generate(frame: Size, random: () => number, config: unknown): Curve[];
}

/**
 * Returns a candidate curve with the SAME endpoints as the input
 * edge — the framework enforces this — or null to leave the edge
 * flat.
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
 * Defaults to "all internal edges" (i.e. every edge whose twin
 * belongs to a non-outer face). A generator can supply a stricter
 * policy — e.g. skip edges shorter than some threshold — without
 * changing the tab generator itself.
 */
export type TabPolicy = (edge: TopologyEdge) => boolean;

/**
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
     * Returns null if the placement is invalid (e.g. the tab would
     * consume more of the edge than the placement margins allow).
     */
    splice(
        edge: Curve,
        placement: { tCenter: number; isTab: boolean },
        template: TabTemplate,
        random: () => number,
    ): Curve | null;
}
