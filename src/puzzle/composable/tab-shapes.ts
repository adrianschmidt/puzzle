/**
 * Tab shape layer for the composable puzzle generator.
 *
 * Tab shapes are standalone Bézier paths defined in normalized space:
 * - Start point: (0, 0)
 * - End point: (1, 0)
 * - The tab protrudes in the positive Y direction
 * - A blank protrudes in the negative Y direction
 *
 * The composition layer transforms these onto actual edges.
 *
 * See issue #127 for the composable architecture design,
 * and #137 for this layer specifically.
 */

import type { Point } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A series of Bézier curve segments represented as points.
 * Format: [p0, cp1_1, cp2_1, p1, cp1_2, cp2_2, p2, ...]
 * where each segment after the first shares the previous end as start.
 */
export type BezierPath = Point[];

/**
 * A tab shape template that generates Bézier paths in normalized space.
 */
export interface TabTemplate {
    /** Human-readable name for this template. */
    name: string;

    /**
     * Generate a tab shape path in normalized space.
     *
     * The path starts at (0, 0) and ends at (1, 0).
     * The tab protrudes in the positive Y direction.
     * To create a blank, the composition layer mirrors the Y coordinates.
     *
     * @param random - Seeded PRNG for shape variation
     * @returns BezierPath in normalized coordinates
     */
    generate(random: () => number): BezierPath;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Classic tab template (Dillo-inspired 6-Bézier mushroom shape)
// ---------------------------------------------------------------------------

/**
 * The classic jigsaw tab shape: a mushroom/knob with a narrow neck
 * and wide head, using 6 cubic Bézier segments.
 *
 * Inspired by Dillo's CodePen `twist0` function.
 * Randomizes: horizontal scale, vertical scale, centre position,
 * and neck-to-head width ratio.
 */
export const classicTabTemplate: TabTemplate = {
    name: 'Classic',

    generate(random: () => number): BezierPath {
        // Randomization parameters
        const scalex = lerp(0.65, 1.0, random());
        const scaley = lerp(0.7, 1.1, random());
        const mid = lerp(0.38, 0.62, random());
        const neckRatio = lerp(0.25, 0.80, random());

        const halfWidth = 0.17 * scalex;
        const neckHalfWidth = halfWidth * neckRatio;

        // Helper: point in normalized space (h = along edge 0-1, v = perpendicular)
        const pt = (h: number, v: number): Point => ({ x: h, y: v });

        // 5 key points defining the mushroom shape
        const pa = pt(mid - neckHalfWidth, 0.08 * scaley);
        const pb = pt(mid - halfWidth * 0.9, 0.25 * scaley);
        const pc = pt(mid, 0.33 * scaley);
        const pd = pt(mid + halfWidth * 0.9, 0.25 * scaley);
        const pe = pt(mid + neckHalfWidth, 0.08 * scaley);

        // Control points for 6 Bézier segments
        const cp1_1 = pt(mid - neckHalfWidth * 2.5, 0);
        const cp1_2 = pt(mid - neckHalfWidth * 1.5, 0);

        const cp2_1 = pt(mid - neckHalfWidth * 0.7, 0.12 * scaley);
        const cp2_2 = pt(mid - halfWidth * 1.1, 0.20 * scaley);

        const cp3_1 = pt(mid - halfWidth * 0.6, 0.32 * scaley);
        const cp3_2 = pt(mid - halfWidth * 0.3, 0.33 * scaley);

        const cp4_1 = pt(mid + halfWidth * 0.3, 0.33 * scaley);
        const cp4_2 = pt(mid + halfWidth * 0.6, 0.32 * scaley);

        const cp5_1 = pt(mid + halfWidth * 1.1, 0.20 * scaley);
        const cp5_2 = pt(mid + neckHalfWidth * 0.7, 0.12 * scaley);

        const cp6_1 = pt(mid + neckHalfWidth * 1.5, 0);
        const cp6_2 = pt(mid + neckHalfWidth * 2.5, 0);

        // Rescale so the tab shape fills [0,1] with the protrusion
        // taking up most of the space. The neck entry/exit points are
        // mapped to ~0.1 and ~0.9 instead of ~0.4 and ~0.6.
        // This prevents long flat flanges when curve-clamped.
        const neckLeft = mid - neckHalfWidth;
        const neckRight = mid + neckHalfWidth;
        const margin = 0.08; // small flange at each end
        const scale = (1 - 2 * margin) / (neckRight - neckLeft);
        const offset = margin - neckLeft * scale;

        const remap = (p: Point): Point => ({
            x: p.x * scale + offset,
            y: p.y * scale, // scale y proportionally to maintain aspect ratio
        });

        return [
            pt(0, 0),                                      // Start
            remap(cp1_1), remap(cp1_2), remap(pa),         // Segment 1
            remap(cp2_1), remap(cp2_2), remap(pb),         // Segment 2
            remap(cp3_1), remap(cp3_2), remap(pc),         // Segment 3
            remap(cp4_1), remap(cp4_2), remap(pd),         // Segment 4
            remap(cp5_1), remap(cp5_2), remap(pe),         // Segment 5
            remap(cp6_1), remap(cp6_2), pt(1, 0),          // Segment 6
        ];
    },
};

/**
 * Reverse a BezierPath to create the mating edge.
 * Reverses the point order and swaps control point pairs within each segment.
 */
export function reverseBezierPath(path: BezierPath): BezierPath {
    const reversed: Point[] = [];
    const n = path.length;

    // The path has (n-1)/3 segments.
    // Walk backwards through segments.
    reversed.push(path[n - 1]); // New start = old end

    for (let i = n - 2; i >= 0; i -= 3) {
        // Old segment ended at path[i+1] with control points path[i-1], path[i]
        // Reversed: swap cp1 and cp2
        reversed.push(path[i]);     // was cp2, becomes cp1
        reversed.push(path[i - 1]); // was cp1, becomes cp2
        reversed.push(path[i - 2]); // was segment start, becomes segment end
    }

    return reversed;
}

/**
 * Mirror a BezierPath's Y coordinates to convert a tab into a blank
 * (or vice versa).
 */
export function mirrorBezierPathY(path: BezierPath): BezierPath {
    return path.map(p => ({ x: p.x, y: -p.y }));
}

/**
 * All available tab templates.
 */
export const TAB_TEMPLATES: readonly TabTemplate[] = [
    classicTabTemplate,
];
