/**
 * Classic tab generator: produces the mushroom-shaped tabs from
 * tab-shapes.ts using the shared tab-generator helpers.
 */

import type { Curve } from './curve.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    prepareTab,
    commitTab,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

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
