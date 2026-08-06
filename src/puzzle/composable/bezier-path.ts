/**
 * A `BezierPath` is a flat point array storing one start point followed by
 * groups of three (cp1, cp2, end) per cubic segment:
 * `[p0, cp1_1, cp2_1, p1, cp1_2, cp2_2, p2, ...]`. Both the procedural
 * generator and the composable/topology pipelines emit and consume paths
 * in this format.
 *
 * `bezierPathToSvg` assumes the caller has already moved to `path[0]`
 * (e.g. via an `M` or preceding `L` command) and emits only the `C`
 * commands for each segment. Short paths (fewer than 4 points) fall back
 * to a single `L` to the last point so the caller's sub-path stays
 * connected.
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
 * Used to shrink a tab (smaller footprint and depth) without regenerating
 * its shape. Tab placement positions everything relative to the path's own
 * midpoint, so scaling about the origin uniformly shrinks the tab.
 */
export function scaleBezierPath(path: BezierPath, sx: number, sy: number): BezierPath {
    return path.map(p => ({ x: p.x * sx, y: p.y * sy }));
}
