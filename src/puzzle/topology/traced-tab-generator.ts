/**
 * Traced tab generator: produces tab shapes from the photographed
 * library using the shared placement helpers.
 *
 * Same shape as classic — different template.
 */

import type { Curve } from './curve.js';
import { tracedTabTemplate } from '../composable/tab-shapes-traced.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;

        const prepared = prepareTab(edge, placement.tCenter, placement.isTab, tracedTabTemplate, random);
        if (!prepared) return null;

        return commitTab(prepared);
    },
};
