/**
 * Two-circle Venn base-cut generator.
 *
 * The framework's smoke test that non-grid topologies work. Two
 * overlapping circles inside a rectangular frame produce four
 * inner faces: the frame piece (with the circle component as
 * an inner boundary), two crescents, and a lens.
 */

import type { Size, Point } from '../../model/types.js';
import { Curve } from './curve.js';
import type { BaseCutGenerator } from './plugin-types.js';

export interface VennCutConfig {
    leftCenter: Point;
    leftRadius: number;
    rightCenter: Point;
    rightRadius: number;
}

export const vennCutGenerator: BaseCutGenerator = {
    id: 'venn',

    generate(frame: Size, _random: () => number, config: unknown): Curve[] {
        const cfg = config as VennCutConfig;
        return [
            Curve.line({ x: 0, y: 0 }, { x: frame.width, y: 0 }),
            Curve.line({ x: frame.width, y: 0 }, { x: frame.width, y: frame.height }),
            Curve.line({ x: frame.width, y: frame.height }, { x: 0, y: frame.height }),
            Curve.line({ x: 0, y: frame.height }, { x: 0, y: 0 }),
            Curve.circle(cfg.leftCenter, cfg.leftRadius),
            Curve.circle(cfg.rightCenter, cfg.rightRadius),
        ];
    },
};
