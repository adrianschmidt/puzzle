/**
 * Framework owns intersections, topology, tab-collision rejection, and
 * face→piece extraction. Plug-ins supply cuts (BaseCutGenerator) and tab
 * shapes (TabGenerator) as pure functions; neither sees the topology graph.
 */

import type { Curve } from './curve.js';
import type { Size } from '../../model/types.js';
import type { TabTemplate } from '../composable/tab-shapes.js';

/**
 * The FIRST four curves are always the border lines (top, right, bottom,
 * left), in that order; the framework relies on this for tab eligibility
 * (border edges never get tabs).
 */
export interface BaseCutGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    /**
     * Opts into borderless: the generator oversizes its grid by one piece per
     * side so the framework can strip the outer ring (strip-border-ring.ts).
     * The strip removes "every piece with a border edge", which equals the
     * 1-deep ring ONLY for a hole-free convex rectangular grid — so an opting-in
     * generator MUST produce such a layout when oversized (holes/concavities
     * create interior border edges and get mis-stripped). Only sine qualifies;
     * gridless generators (Venn) leave it falsy and borderless is ignored.
     */
    readonly supportsBorderless?: boolean;
    /**
     * Intended face count for `config`, or undefined when unknowable. The
     * framework compares it against the faces actually extracted (BEFORE
     * composition and border strip) and reports a mismatch
     * (`TopologyPuzzle.pieceCountMismatch`).
     *
     * Derive the count from the SAME config-reading code `generate` uses (one
     * shared helper — sine's `resolveGrid`), else each side applies its own
     * defaults/sizing and nothing checks they agree: a check that silently
     * stops checking reads as a clean signal. Implement only when the count is
     * a knowable function of config — Venn's is unrelated to cols x rows, and
     * the triangular estimate holds exactly only for jitter 0 / smooth false.
     */
    expectedPieceCount?(config: unknown): number | undefined;
    /**
     * @param frame - puzzle pixel dimensions
     * @param random - seeded PRNG; call counts must be deterministic per
     *   (id, config) so share-links round-trip
     * @param config - opaque generator config; validated/cast internally
     */
    generate(frame: Size, random: () => number, config: unknown): Curve[];
}

/**
 * Returns a candidate curve with the SAME endpoints as the input edge (the
 * framework enforces this), or null to leave the edge flat. The candidate may
 * protrude outside the edge's bbox; the framework discards it if it would
 * introduce a new crossing. The generator does NOT see neighbours — tabs that
 * must mesh with neighbours are a BaseCutGenerator concern.
 */
export interface TabGenerator {
    /** Stable id for share-link encoding. */
    readonly id: string;
    generate(edge: Curve, random: () => number, config: unknown): Curve | null;
    /**
     * Optional: yields ordered candidate curves (best first) for one edge. The
     * framework commits the FIRST that passes its accept gates (endpoint match,
     * no fold-back, no new crossing), else the edge stays flat. A `null` slot
     * (candidate that couldn't be built) is skipped but still occupies a
     * position, so a stable one-slot-per-rung sequence keeps
     * `committedVariantIndex` (see {@link ApplyTabsOptions.onCandidate}) equal
     * to the rung index. ALL PRNG draws MUST happen before the first yield so
     * randomness consumption is independent of candidates tried.
     */
    generateVariants?(edge: Curve, random: () => number, config: unknown): Iterable<Curve | null>;
}

/**
 * Defaults to all internal edges (twin belongs to a non-outer face). A
 * generator can supply a stricter policy without changing the tab generator.
 */
export type TabPolicy = (edge: TopologyEdge) => boolean;

/**
 * Border edges (one side is the outer face) are filtered out before the policy
 * runs, so a policy only ever sees internal edges.
 */
export interface TopologyEdge {
    readonly id: number;
    /** Arc length of the edge's current curve, in pixels. */
    readonly length: number;
}

/**
 * The "how to attach" half of tab generation: given a position, template, and
 * PRNG, produces the curve that replaces the spliced section. Splicers can
 * share a `TabTemplate` but attach differently (e.g. C0 position-only join vs.
 * C1 tangent-aligned). Chosen per-`TabGenerator`; composes with prepareTab/
 * commitTab from tab-generator-helpers.ts.
 */
export interface TabSplicer {
    /** Stable id for debug/logs; not part of any share-link contract. */
    readonly id: string;
    /** Returns null if the placement is invalid (e.g. tab exceeds placement margins). */
    splice(
        edge: Curve,
        placement: { tCenter: number; isTab: boolean },
        template: TabTemplate,
        random: () => number,
    ): Curve | null;
}
