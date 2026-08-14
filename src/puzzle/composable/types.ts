/**
 * Interface between the grid layer and the composition layer: abstract edges
 * with no grid concepts (no rows, columns, or directions).
 */

import type { Point } from '../../model/types.js';

export interface PieceDefinition {
    id: number;
    /**
     * All edges of the piece, flat. Outer boundary first (each edge's `end`
     * matches the next's `start`); hole loops follow, each chained end-to-start
     * internally. Loop boundaries are detected by the chain breaking, and the
     * renderer emits one SVG `M..Z` subpath per loop.
     */
    edges: EdgeDefinition[];
    /** Offset to position the source image behind the piece. */
    imageOffset: Point;
}

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
     * Shared-edge key; both sides of a shared edge carry the same key, letting
     * the composition layer store/retrieve tab paths. Undefined for border edges.
     */
    sharedEdgeKey?: string;
    /**
     * First side of a shared edge — generates the tab shape; the second side
     * reverses the stored path. Undefined for border edges.
     */
    isFirstSide?: boolean;
    /**
     * Curve points along the edge (piece-local). When present, the edge follows
     * this polyline instead of a straight start→end line (wavy/curved cuts);
     * first point matches `start`, last matches `end`.
     */
    curvePoints?: Point[];
}
