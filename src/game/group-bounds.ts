import type { Edge, Piece, PieceGroup, Point } from '../model/types.js';
import { localToWorld } from '../model/helpers.js';
import { getPathBounds } from './path-bounds.js';

/**
 * Memoised path-bounds for an edge.
 *
 * `getPathBounds` is a regex-based parser; on a 50-piece group with four
 * edges per piece, free-rotation drag would re-parse ~200 path strings on
 * every pointermove. Edge objects are immutable for the lifetime of a
 * puzzle (paths are baked at generation time and never reassigned), so we
 * key the cache directly off the Edge reference. WeakMap means the cache
 * drops automatically when a new puzzle replaces `state.piecesById`.
 *
 * The returned BoundingRect is shared with future callers — treat it as
 * read-only.
 */
const edgePathBoundsCache = new WeakMap<
    Edge,
    { minX: number; minY: number; maxX: number; maxY: number }
>();

function cachedEdgePathBounds(
    edge: Edge,
): { minX: number; minY: number; maxX: number; maxY: number } {
    let bounds = edgePathBoundsCache.get(edge);
    if (!bounds) {
        bounds = getPathBounds(edge.path, edge.start);
        edgePathBoundsCache.set(edge, bounds);
    }
    return bounds;
}

export interface BoundingRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface GroupBoundsOptions {
    /**
     * - `'local'`: un-rotated piece-offset frame; ignores `group.rotation`
     *   and `group.position`.
     * - `'world'`: applies `group.rotation` and `group.position` to every
     *   sampled point before computing the AABB.
     */
    space: 'local' | 'world';

    /**
     * If true, samples bezier control points from each edge's `path`
     * string for a tighter fit that includes tab geometry. If false,
     * samples only the `start` and `end` corner points.
     */
    includePathGeometry: boolean;
}

/**
 * Single source of truth for group bounds. Pile detection (world-space,
 * endpoints only) and layout (local-space, with path geometry) both call
 * into this via `options`.
 *
 * Takes the `piecesById` index (typically `state.piecesById`) so the
 * per-piece lookup inside the loop is O(1).
 *
 * Returns Infinity-valued bounds when the group has no findable pieces;
 * sugar wrappers normalize that to zero-sized.
 */
export function getGroupBounds(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    options: GroupBoundsOptions,
): BoundingRect {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const expand = (localX: number, localY: number) => {
        const projected = options.space === 'world'
            ? localToWorld({ x: localX, y: localY }, group)
            : { x: localX, y: localY };
        if (projected.x < minX) minX = projected.x;
        if (projected.y < minY) minY = projected.y;
        if (projected.x > maxX) maxX = projected.x;
        if (projected.y > maxY) maxY = projected.y;
    };

    for (const [pieceId, offset] of group.pieces) {
        const piece = piecesById.get(pieceId);
        if (!piece) continue;

        for (const edge of piece.edges) {
            expand(offset.x + edge.start.x, offset.y + edge.start.y);
            expand(offset.x + edge.end.x, offset.y + edge.end.y);

            if (options.includePathGeometry && edge.path) {
                const pb = cachedEdgePathBounds(edge);
                expand(offset.x + pb.minX, offset.y + pb.minY);
                expand(offset.x + pb.maxX, offset.y + pb.maxY);
            }
        }
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Uses piece offsets only (group-local space, no edge geometry). For
 * accurate world-space bounding boxes that include tab shapes, use
 * `getGroupBounds` with `space: 'world'` and `includePathGeometry: true`.
 */
export function getGroupOffsetBounds(group: PieceGroup): BoundingRect {
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
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
): { minX: number; minY: number; width: number; height: number } {
    const b = getGroupBounds(group, piecesById, {
        space: 'local',
        includePathGeometry: true,
    });

    if (!isFinite(b.minX)) {
        return { minX: 0, minY: 0, width: 0, height: 0 };
    }

    return {
        minX: b.minX,
        minY: b.minY,
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
    };
}

/**
 * Center of the assembled image rectangle in un-rotated local space.
 *
 * Samples piece-body corner vertices only (no tab protrusions), so for a
 * completed puzzle — whose outer border is flat — this is the geometric
 * center of the image. Use it as the pivot when spinning the finished
 * puzzle upright, so the rotation looks centered rather than offset by the
 * asymmetric tabs that `getGroupLocalBounds` would include.
 *
 * Returns the local origin for a group with no findable pieces.
 */
export function getGroupImageCenter(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
): Point {
    const b = getGroupBounds(group, piecesById, {
        space: 'local',
        includePathGeometry: false,
    });

    if (!isFinite(b.minX)) {
        return { x: 0, y: 0 };
    }

    return {
        x: (b.minX + b.maxX) / 2,
        y: (b.minY + b.maxY) / 2,
    };
}

/**
 * Center of one piece's tab-inclusive footprint in the group's un-rotated
 * local space — the rotation-snap pivot shared by merge measurement, merge
 * application, and the snap assists, which must agree on it or the measured
 * snapDelta lands the group elsewhere.
 *
 * Sampled from edge path geometry (like `getGroupLocalBounds`) rather than
 * `piece.bounds`: legacy-Classic edges carry no `curvePoints`, so their
 * `bounds` exclude tab protrusions and the two centers diverge. Matching
 * the group-bounds definition keeps a single-piece group's pivot identical
 * to its pre-#530 group-center pivot. Throws if the piece is not in the
 * group.
 */
export function pieceCenterLocal(group: PieceGroup, piece: Piece): Point {
    const offset = group.pieces.get(piece.id);
    if (!offset) throw new Error(`Piece ${piece.id} not in group ${group.id}`);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const expand = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };
    for (const edge of piece.edges) {
        expand(edge.start.x, edge.start.y);
        expand(edge.end.x, edge.end.y);
        if (edge.path) {
            const pb = cachedEdgePathBounds(edge);
            expand(pb.minX, pb.minY);
            expand(pb.maxX, pb.maxY);
        }
    }

    if (!isFinite(minX)) {
        return { x: offset.x, y: offset.y };
    }

    return {
        x: offset.x + (minX + maxX) / 2,
        y: offset.y + (minY + maxY) / 2,
    };
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
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
): { minX: number; minY: number; width: number; height: number } {
    const b = getGroupBounds(group, piecesById, {
        space: 'world',
        includePathGeometry: true,
    });

    if (!isFinite(b.minX)) {
        return { minX: 0, minY: 0, width: 0, height: 0 };
    }

    return {
        minX: b.minX - group.position.x,
        minY: b.minY - group.position.y,
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
    };
}
