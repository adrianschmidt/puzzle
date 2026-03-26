/**
 * Shared types for the composable puzzle generator.
 *
 * These types define the interface between the grid layer and
 * the composition layer, using abstract edges with no grid-specific
 * concepts (no rows, columns, or directions).
 */

import type { Point } from '../../model/types.js';

/**
 * A piece definition produced by the grid layer.
 * Contains abstract edges with mate relationships already resolved.
 */
export interface PieceDefinition {
    /** Unique piece identifier. */
    id: number;
    /** Edges ordered clockwise around the piece. */
    edges: EdgeDefinition[];
    /** Offset to position the source image behind the piece. */
    imageOffset: Point;
}

/**
 * An edge definition with mate relationship and clamping info.
 *
 * The grid layer resolves all topology — the composition layer
 * just sees edges with start/end points and mate references.
 */
export interface EdgeDefinition {
    /** Globally unique edge ID. */
    id: number;
    /** Start point in piece-local coordinates. */
    start: Point;
    /** End point in piece-local coordinates. */
    end: Point;
    /** The matching edge on the adjacent piece (-1 for border). */
    mateEdgeId: number;
    /** Which piece the mate edge belongs to (-1 for border). */
    matePieceId: number;
    /**
     * Key identifying the shared edge between two pieces.
     * Both sides of the same shared edge have the same key.
     * Used by the composition layer to store/retrieve tab paths.
     * Undefined for border edges.
     */
    sharedEdgeKey?: string;
    /**
     * True if this is the "first side" of a shared edge —
     * the side that generates the tab shape. The second side
     * reverses the stored path. Undefined for border edges.
     */
    isFirstSide?: boolean;
}
