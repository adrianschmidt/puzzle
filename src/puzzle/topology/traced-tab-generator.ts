/**
 * Traced tab generator: produces tab shapes from the photographed
 * library. Uses the tangent-smoothed splicer so the flowy
 * photographed curves join the parent edge with C1 continuity.
 *
 * Both entry points share one ladder generator, `tracedTabVariants`:
 * it yields the base tab first, then a short "retry ladder" of cheap
 * local variations (shrink, pull-to-center, sign flip). The framework
 * commits the first that survives its crossing checks — recovering
 * edges that would otherwise be left flat because the base tab crossed
 * a neighbor. `generate` simply returns the ladder's first rung, so the
 * "rung 0 == generate()" equivalence holds structurally rather than by
 * two code paths kept in sync.
 *
 * All PRNG draws happen before the first yield, so per-edge consumption
 * is exactly 3 outer calls regardless of how many rungs are tried.
 */

import type { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import { scaleBezierPath } from '../composable/bezier-path.js';
import type { BezierPath } from '../composable/bezier-path.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    spliceSmoothedFromPath,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

/** Shrink factor for the "smaller tab" rungs. */
const SHRINK = 0.8;
/** Fraction to pull the tab center toward mid-edge (0.5) on the move rungs. */
const CENTER_PULL = 0.5;

/**
 * The retry ladder, shared by `generate` and `generateVariants`. Yields
 * best-first: the base tab, then cheap local variants. All PRNG draws
 * (placement + the one template path) happen before the first yield, so
 * a caller that pulls only the first element advances the PRNG by the
 * same fixed amount as one that drains the whole ladder.
 */
function* tracedTabVariants(edge: Curve, random: () => number): Generator<Curve> {
    // All PRNG draws up front: placement (2 calls) + template path (1).
    const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
    if (!placement) return;
    // Draws the base template path. NOTE: this also fires the traced-tab
    // debug recorder, which captures the BASE rung's params — if a later
    // rung (shrink / center / flip) is the one committed, the recorded
    // geometry won't match the committed tab (edge/accepted correlation
    // is still correct; only the recorded scale/flip/mid may differ).
    const basePath = tracedTabTemplate.generate(random);

    const { tCenter, isTab } = placement;
    // lerp toward mid-edge by CENTER_PULL (0.5 = halfway)
    const tPulled = tCenter + (0.5 - tCenter) * CENTER_PULL;
    const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);

    // Best-first ladder: [tCenter, isTab, path].
    const rungs: ReadonlyArray<readonly [number, boolean, BezierPath]> = [
        [tCenter, isTab, basePath],   // base (== generate())
        [tCenter, isTab, shrunk],     // shrink
        [tPulled, isTab, basePath],   // pull to center
        [tPulled, isTab, shrunk],     // shrink + center
        [tCenter, !isTab, basePath],  // flip sign (last: changes the tab/blank sense, so least preferred)
    ];

    for (const [tc, tab, path] of rungs) {
        const candidate = spliceSmoothedFromPath(edge, tc, tab, path);
        if (candidate) yield candidate;
    }
}

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    // Retained for the TabGenerator interface and as the lazy-load stub's
    // fallback. Returns the ladder's first rung, so it is the same code
    // path as generateVariants' first candidate (no separate splice to
    // drift out of sync). In the app, applyTabs always uses generateVariants.
    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        for (const variant of tracedTabVariants(edge, random)) {
            return variant;
        }
        return null;
    },

    generateVariants(edge: Curve, random: () => number, _config: unknown): Iterable<Curve> {
        return tracedTabVariants(edge, random);
    },
};
