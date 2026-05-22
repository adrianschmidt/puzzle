/**
 * Traced tab generator: produces tab shapes from the photographed
 * library. Uses the tangent-smoothed splicer so the flowy
 * photographed curves join the parent edge with C1 continuity
 * (smooth direction) rather than the C0 corner the standard splicer
 * would leave.
 */

import type { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    smoothedTabSplicer,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;
        return smoothedTabSplicer.splice(edge, placement, tracedTabTemplate, random);
    },
};
