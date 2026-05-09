/**
 * Classic tab generator: produces the mushroom-shaped tabs from
 * tab-shapes.ts as a TabGenerator plug-in.
 *
 * Reuses prepareTab/commitTab from tab-merge.ts to do the heavy
 * lifting. The wrapper picks a placement (centre position and
 * tab/socket polarity) and asks tab-merge to assemble the curve.
 *
 * Returns null when the edge is too short for the tab — same
 * conditions as the existing computeTabPlacement + prepareTab
 * sequence.
 */

import type { Curve } from './curve.js';
import { prepareTab, commitTab, computeTabPlacement, DEFAULT_TAB_PLACEMENT } from './tab-merge.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabGenerator } from './plugin-types.js';

export const classicTabGenerator: TabGenerator = {
    id: 'classic',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, classicTabTemplate, random);
        if (!prepared) return null;

        return commitTab(prepared);
    },
};
