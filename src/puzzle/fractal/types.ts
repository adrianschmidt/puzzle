/**
 * Internal types for the fractal puzzle generator.
 *
 * - **Tile:** a point on the grid, identified by (x, y).
 * - **DiagonalConnection:** a diagonal link between two tiles, occupying
 *   the cell (square) between them.
 * - **ArcData:** a quarter-circle arc segment forming a piece boundary.
 */

export interface Tile {
    x: number;
    y: number;
    hasconnections: boolean;
}

export interface DiagonalConnection {
    p1: Tile;
    p2: Tile;
    p2_taken: boolean;
    slope: number;
    quad: number;
    cell: { x: number; y: number };
}

export interface ArcData {
    /** Center point of the arc's circle. */
    cx: number;
    cy: number;
    /** Radius. */
    r: number;
    /** Start point. */
    sx: number;
    sy: number;
    /** End point. */
    ex: number;
    ey: number;
    /** Sweep flag (0 or 1). */
    sign: number;
    /** Quadrant (0-3). */
    quad: number;
}
