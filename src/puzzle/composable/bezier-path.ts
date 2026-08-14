/**
 * A `BezierPath` is a flat point array: one start point then groups of three
 * (cp1, cp2, end) per cubic segment — `[p0, cp1, cp2, p1, cp1, cp2, p2, ...]`.
 * Shared by the procedural and composable/topology pipelines.
 *
 * `bezierPathToSvg` assumes the caller already moved to `path[0]` and emits
 * only `C` commands; short paths (<4 points) fall back to a single `L` to the
 * last point so the caller's sub-path stays connected.
 */

import type { Point } from '../../model/types.js';
import { fmt } from '../../model/build-shape.js';

export type BezierPath = Point[];

export function bezierPathToSvg(path: BezierPath): string {
    if (path.length < 4) {
        if (path.length === 0) return '';
        const last = path[path.length - 1];
        return `L ${fmt(last.x)} ${fmt(last.y)}`;
    }

    const parts: string[] = [];
    for (let i = 1; i + 2 < path.length; i += 3) {
        const cp1 = path[i];
        const cp2 = path[i + 1];
        const end = path[i + 2];
        parts.push(
            `C ${fmt(cp1.x)} ${fmt(cp1.y)}, ${fmt(cp2.x)} ${fmt(cp2.y)}, ${fmt(end.x)} ${fmt(end.y)}`,
        );
    }

    return parts.join(' ');
}

/**
 * Reverse a BezierPath to create the mating edge.
 */
export function reverseBezierPath(path: BezierPath): BezierPath {
    const reversed: Point[] = [];
    const n = path.length;

    reversed.push(path[n - 1]);

    for (let i = n - 2; i >= 0; i -= 3) {
        reversed.push(path[i]);
        reversed.push(path[i - 1]);
        reversed.push(path[i - 2]);
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
 * Shrink a tab (footprint and depth) without regenerating it. Placement is
 * relative to the path's midpoint, so scaling about the origin shrinks uniformly.
 */
export function scaleBezierPath(path: BezierPath, sx: number, sy: number): BezierPath {
    return path.map(p => ({ x: p.x * sx, y: p.y * sy }));
}
