/**
 * No-op tab generator: leaves every edge flat.
 *
 * Useful for base-cut-driven topologies (e.g. Venn) where the cuts
 * themselves define the piece geometry and tabs would only confuse it.
 */

import type { Curve } from './curve.js';
import type { TabGenerator } from './plugin-types.js';

export const noneTabGenerator: TabGenerator = {
    id: 'none',

    generate(_edge: Curve, _random: () => number, _config: unknown): Curve | null {
        return null;
    },
};
