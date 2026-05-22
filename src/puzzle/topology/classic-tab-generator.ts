/**
 * Classic tab generator: produces the mushroom-shaped tabs from
 * tab-shapes.ts. Uses the standard (no-smoothing) splicer to keep
 * the existing Classic / Wavy splice geometry — and the existing
 * PRNG-snapshot test — stable.
 */

import type { Curve } from './curve.js';
import { classicTabTemplate } from '../composable/tab-shapes.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    standardTabSplicer,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

export const classicTabGenerator: TabGenerator = {
    id: 'classic',

    generate(edge: Curve, random: () => number, _config: unknown): Curve | null {
        const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
        if (!placement) return null;
        return standardTabSplicer.splice(edge, placement, classicTabTemplate, random);
    },
};
