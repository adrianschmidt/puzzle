/**
 * Non-grid topology (framework smoke test): two overlapping circles in a
 * rectangular frame produce four inner faces — the frame piece (circles as an
 * inner boundary), two crescents, and a lens.
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
