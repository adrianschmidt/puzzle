/**
 * SVG serialization helpers for Bézier paths.
 *
 * `bezierPathToSvg` is shared by every layer that emits an edge or
 * tab path string. It assumes the caller has already moved to
 * `path[0]` (e.g. via an `M` or preceding `L` command) and emits only
 * the `C` commands for each segment. Short paths (fewer than 4
 * points) fall back to a single `L` to the last point so the caller's
 * sub-path stays connected.
 */

import type { BezierPath } from './tab-shapes.js';

/** Format a coordinate, dropping trailing zeros for integer values. */
export function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Convert a Bézier path to SVG path commands.
 *
 * Skips `path[0]` because the caller is assumed to be there already,
 * then emits one `C` command per (cp1, cp2, end) triple.
 */
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
