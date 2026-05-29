/**
 * Traced tab generator: produces tab shapes from the photographed
 * library. Uses the tangent-smoothed splicer so the flowy
 * photographed curves join the parent edge with C1 continuity.
 *
 * `generate` places one tab (the legacy single-shot path).
 * `generateVariants` yields that same base tab first, then a short
 * "retry ladder" of cheap local variations (shrink, pull-to-centre,
 * sign flip). The framework commits the first that survives its
 * crossing checks — recovering edges that would otherwise be left flat
 * because the base tab crossed a neighbour. All PRNG draws happen
 * before the first yield, so per-edge consumption stays at exactly the
 * same 3 outer calls as `generate`.
 */

import type { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import { scaleBezierPath } from '../composable/bezier-path.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    smoothedTabSplicer,
    spliceSmoothedFromPath,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

/** Shrink factor for the "smaller tab" rungs. */
const SHRINK = 0.8;
/** Fraction to pull the tab centre toward mid-edge (0.5) on the move rungs. */
const CENTRE_PULL = 0.5;

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;
        return smoothedTabSplicer.splice(edge, placement, tracedTabTemplate, random);
    },

    *generateVariants(edge: Curve, random: () => number, _config: unknown): Iterable<Curve> {
        // All PRNG draws up front: placement (2 calls) + template path (1).
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return;
        const basePath = tracedTabTemplate.generate(random);

        const { tCenter, isTab } = placement;
        const tCentre = tCenter + (0.5 - tCenter) * CENTRE_PULL;
        const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);

        // Best-first ladder: [tCenter, isTab, path].
        const rungs: ReadonlyArray<readonly [number, boolean, typeof basePath]> = [
            [tCenter, isTab, basePath],   // base (== generate())
            [tCenter, isTab, shrunk],     // shrink
            [tCentre, isTab, basePath],   // pull to centre
            [tCentre, isTab, shrunk],     // shrink + centre
            [tCenter, !isTab, basePath],  // flip sign
        ];

        for (const [tc, tab, path] of rungs) {
            const candidate = spliceSmoothedFromPath(edge, tc, tab, path);
            if (candidate) yield candidate;
        }
    },
};
