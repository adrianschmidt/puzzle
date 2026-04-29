/**
 * Group bounds primitives.
 *
 * Three flavours of "bounding box" for a `PieceGroup`, used by layout
 * (gather), rotation pivot math, and anywhere else the on-screen footprint
 * of a group matters:
 *
 * - `getGroupOffsetBounds` — min/max of piece offsets only (no edge geometry).
 * - `getGroupLocalBounds` — un-rotated local-space AABB including tab paths.
 * - `getGroupVisualBounds` — rendered footprint, accounting for `group.rotation`.
 */

import type { Point, Piece, PieceGroup } from '../model/types.js';
import { rotatePoint } from '../model/helpers.js';
import { getPathBounds } from './path-bounds.js';

/**
 * Compute bounding box of piece offsets within a group (group-local space).
 *
 * Returns the min/max of all piece offset coordinates. For a single-piece
 * group at offset (0,0), this returns {minX:0, minY:0, maxX:0, maxY:0}.
 *
 * Note: This uses piece offsets only (not edge geometry). For accurate
 * world-space bounding boxes that include tab shapes, use
 * `getGroupBounds` from pile-detection.
 */
export function getGroupOffsetBounds(group: PieceGroup): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const offset of group.pieces.values()) {
        if (offset.x < minX) {
            minX = offset.x;
        }

        if (offset.y < minY) {
            minY = offset.y;
        }

        if (offset.x > maxX) {
            maxX = offset.x;
        }

        if (offset.y > maxY) {
            maxY = offset.y;
        }
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Compute the bounding box of a group in its un-rotated local space by
 * examining the actual SVG shape geometry of its pieces. Piece offsets
 * live in un-rotated local coordinates, and so do the bounds this returns.
 *
 * Includes bezier control points from edge paths to account for tab
 * geometry that extends beyond the start/end corner vertices.
 *
 * Use this (not `getGroupVisualBounds`) when doing rotation pivot math or
 * anywhere else you need rotation-invariant bounds.
 */
export function getGroupLocalBounds(
    group: PieceGroup,
    pieces: ReadonlyArray<Readonly<Piece>>,
): { minX: number; minY: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [pieceId, offset] of group.pieces) {
        const piece = pieces.find(p => p.id === pieceId);
        if (!piece) continue;

        for (const edge of piece.edges) {
            // Always include start/end points
            const points = [edge.start, edge.end];
            for (const pt of points) {
                const wx = offset.x + pt.x;
                const wy = offset.y + pt.y;
                if (wx < minX) minX = wx;
                if (wy < minY) minY = wy;
                if (wx > maxX) maxX = wx;
                if (wy > maxY) maxY = wy;
            }

            // Include path geometry (control points, curve endpoints)
            if (edge.path) {
                const pathBounds = getPathBounds(edge.path, edge.start);
                const pts = [
                    { x: pathBounds.minX, y: pathBounds.minY },
                    { x: pathBounds.maxX, y: pathBounds.maxY },
                ];
                for (const pt of pts) {
                    const wx = offset.x + pt.x;
                    const wy = offset.y + pt.y;
                    if (wx < minX) minX = wx;
                    if (wy < minY) minY = wy;
                    if (wx > maxX) maxX = wx;
                    if (wy > maxY) maxY = wy;
                }
            }
        }
    }

    if (!isFinite(minX)) {
        return { minX: 0, minY: 0, width: 0, height: 0 };
    }

    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compute the bounding box of a group as it actually renders, accounting
 * for `group.rotation`. Returned coordinates are offsets from the group's
 * `position` (pre-translation) in rotated local space, so
 * `group.position.x + bounds.minX` is the world-space left edge.
 *
 * Use this for layout, gather packing, or anywhere the rendered footprint
 * matters. For rotation pivot math use `getGroupLocalBounds` instead.
 */
export function getGroupVisualBounds(
    group: PieceGroup,
    pieces: ReadonlyArray<Readonly<Piece>>,
): { minX: number; minY: number; width: number; height: number } {
    const local = getGroupLocalBounds(group, pieces);

    if (group.rotation === 0) {
        return local;
    }

    if (local.width === 0 && local.height === 0) {
        return local;
    }

    // Rotate the four local-space corners and recompute the AABB.
    const corners: Point[] = [
        { x: local.minX, y: local.minY },
        { x: local.minX + local.width, y: local.minY },
        { x: local.minX + local.width, y: local.minY + local.height },
        { x: local.minX, y: local.minY + local.height },
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
        const r = rotatePoint(c, group.rotation);
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x > maxX) maxX = r.x;
        if (r.y > maxY) maxY = r.y;
    }

    return { minX, minY, width: maxX - minX, height: maxY - minY };
}
