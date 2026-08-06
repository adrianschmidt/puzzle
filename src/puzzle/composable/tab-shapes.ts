/**
 * Tab shapes are standalone Bézier paths defined in normalized space:
 * - x runs along the edge, y perpendicular to it
 * - Start and end points sit on the y = 0 baseline at the neck, not at
 *   x = 0 / x = 1 — consumers renormalize from the path's own endpoints
 * - The tab protrudes in the positive Y direction
 * - A blank protrudes in the negative Y direction
 *
 * The composition layer transforms these onto actual edges.
 *
 * See issue #127 for the composable architecture design,
 * and #137 for this layer specifically.
 */

import type { Point } from '../../model/types.js';
import type { BezierPath } from './bezier-path.js';

export interface TabTemplate {
    name: string;

    generate(random: () => number): BezierPath;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * The classic jigsaw tab shape: a mushroom/knob with a narrow neck
 * and wide head.
 *
 * Inspired by Dillo's CodePen `twist0` function.
 */
export const classicTabTemplate: TabTemplate = {
    name: 'Classic',

    generate(random: () => number): BezierPath {
        const scalex = lerp(0.65, 1.0, random());
        const scaley = lerp(0.7, 1.1, random());
        const mid = lerp(0.38, 0.62, random());
        const neckRatio = lerp(0.25, 0.80, random());

        const halfWidth = 0.17 * scalex;
        const neckHalfWidth = halfWidth * neckRatio;

        // Point in normalized space (h = along edge, v = perpendicular).
        // Shift y down so the neck entry/exit sits at y=0 — no flat flanges
        // needed. The shape starts and ends exactly at the neck points.
        const yShift = 0.08 * scaley;
        const pt = (h: number, v: number): Point => ({ x: h, y: v - yShift });

        const pb = pt(mid - halfWidth * 0.9, 0.25 * scaley);
        const pc = pt(mid, 0.33 * scaley);
        const pd = pt(mid + halfWidth * 0.9, 0.25 * scaley);

        const cp2_1 = pt(mid - neckHalfWidth * 0.7, 0.12 * scaley);
        const cp2_2 = pt(mid - halfWidth * 1.1, 0.20 * scaley);

        const cp3_1 = pt(mid - halfWidth * 0.6, 0.32 * scaley);
        const cp3_2 = pt(mid - halfWidth * 0.3, 0.33 * scaley);

        const cp4_1 = pt(mid + halfWidth * 0.3, 0.33 * scaley);
        const cp4_2 = pt(mid + halfWidth * 0.6, 0.32 * scaley);

        const cp5_1 = pt(mid + halfWidth * 1.1, 0.20 * scaley);
        const cp5_2 = pt(mid + neckHalfWidth * 0.7, 0.12 * scaley);

        return [
            pt(mid - neckHalfWidth, 0.08 * scaley),
            cp2_1, cp2_2, pb,
            cp3_1, cp3_2, pc,
            cp4_1, cp4_2, pd,
            cp5_1, cp5_2,
            pt(mid + neckHalfWidth, 0.08 * scaley),
        ];
    },
};

export const TAB_TEMPLATES: readonly TabTemplate[] = [
    classicTabTemplate,
];
