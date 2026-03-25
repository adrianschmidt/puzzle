/**
 * Grid cut layer for the composable puzzle generator.
 *
 * Defines row and column cuts across the puzzle, and computes
 * their intersections to create grid edges. Each edge is a segment
 * of a cut between two intersection points (corners).
 *
 * V1: Straight, equidistant, parallel cuts.
 * Future: Wavy, curved, non-uniform cuts (see #140).
 */

import type { Point, Size } from '../../model/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A cut line across the puzzle (row or column).
 * Defined as a series of points — for V1 these are just two endpoints
 * (a straight line), but future versions will use more points for curves.
 */
export interface CutLine {
    /** Points defining this cut, from start to end. */
    points: Point[];
}

/**
 * A corner where a row cut and a column cut intersect.
 */
export interface GridCorner {
    /** Position of the intersection. */
    position: Point;
    /** Index of the row cut (0 = top border, rows = bottom border). */
    rowIndex: number;
    /** Index of the column cut (0 = left border, cols = right border). */
    colIndex: number;
}

/**
 * An edge segment between two adjacent corners.
 * This is the portion of a cut between two intersections.
 */
export interface GridEdge {
    /** Start corner. */
    start: GridCorner;
    /** End corner. */
    end: GridCorner;
    /** Direction: 'horizontal' (part of a row cut) or 'vertical' (part of a column cut). */
    direction: 'horizontal' | 'vertical';
    /** Whether this edge is on the puzzle border (no mate). */
    isBorder: boolean;
    /** Row index of the piece above/left of this edge. */
    pieceRow: number;
    /** Column index of the piece above/left of this edge. */
    pieceCol: number;
}

/**
 * The complete grid definition: cuts, corners, and edges.
 */
export interface GridDefinition {
    /** Number of piece columns. */
    cols: number;
    /** Number of piece rows. */
    rows: number;
    /** Piece width in pixels. */
    pieceWidth: number;
    /** Piece height in pixels. */
    pieceHeight: number;
    /** Row cuts (horizontal lines). Index 0 = top border, index rows = bottom border. */
    rowCuts: CutLine[];
    /** Column cuts (vertical lines). Index 0 = left border, index cols = right border. */
    colCuts: CutLine[];
    /** All corner points (intersections of row and column cuts). */
    corners: GridCorner[][];
    /** All edges, organized by piece position and direction. */
    edges: GridEdgeMap;
}

/**
 * Lookup structure for edges by piece position and direction.
 *
 * For a piece at (row, col):
 * - top edge: edges[row][col].top
 * - right edge: edges[row][col].right
 * - bottom edge: edges[row][col].bottom
 * - left edge: edges[row][col].left
 */
export interface GridEdgeMap {
    [row: number]: {
        [col: number]: {
            top: GridEdge;
            right: GridEdge;
            bottom: GridEdge;
            left: GridEdge;
        };
    };
}

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

/**
 * Generate a straight grid definition for the given puzzle dimensions.
 *
 * V1: All cuts are straight, equidistant, and perpendicular.
 * The grid has (rows + 1) horizontal cuts and (cols + 1) vertical cuts,
 * creating a rows × cols grid of pieces.
 *
 * @param cols - Number of piece columns
 * @param rows - Number of piece rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @returns Complete grid definition with cuts, corners, and edges
 */
export function generateStraightGrid(
    cols: number,
    rows: number,
    imageSize: Size,
): GridDefinition {
    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    // Generate row cuts (horizontal lines, top to bottom)
    const rowCuts: CutLine[] = [];
    for (let r = 0; r <= rows; r++) {
        const y = r * pieceHeight;
        rowCuts.push({
            points: [
                { x: 0, y },
                { x: imageSize.width, y },
            ],
        });
    }

    // Generate column cuts (vertical lines, left to right)
    const colCuts: CutLine[] = [];
    for (let c = 0; c <= cols; c++) {
        const x = c * pieceWidth;
        colCuts.push({
            points: [
                { x, y: 0 },
                { x, y: imageSize.height },
            ],
        });
    }

    // Compute corners (intersections of row and column cuts)
    // For straight cuts, this is trivially the grid points.
    // Future wavy cuts will use curve-curve intersection here.
    const corners: GridCorner[][] = [];
    for (let r = 0; r <= rows; r++) {
        corners[r] = [];
        for (let c = 0; c <= cols; c++) {
            corners[r][c] = {
                position: { x: c * pieceWidth, y: r * pieceHeight },
                rowIndex: r,
                colIndex: c,
            };
        }
    }

    // Build edge map for each piece
    const edges: GridEdgeMap = {};
    for (let r = 0; r < rows; r++) {
        edges[r] = {};
        for (let c = 0; c < cols; c++) {
            edges[r][c] = {
                top: {
                    start: corners[r][c],
                    end: corners[r][c + 1],
                    direction: 'horizontal',
                    isBorder: r === 0,
                    pieceRow: r,
                    pieceCol: c,
                },
                right: {
                    start: corners[r][c + 1],
                    end: corners[r + 1][c + 1],
                    direction: 'vertical',
                    isBorder: c === cols - 1,
                    pieceRow: r,
                    pieceCol: c,
                },
                bottom: {
                    start: corners[r + 1][c + 1],
                    end: corners[r + 1][c],
                    direction: 'horizontal',
                    isBorder: r === rows - 1,
                    pieceRow: r,
                    pieceCol: c,
                },
                left: {
                    start: corners[r][c],
                    end: corners[r + 1][c],
                    direction: 'vertical',
                    isBorder: c === 0,
                    pieceRow: r,
                    pieceCol: c,
                },
            };
        }
    }

    return {
        cols,
        rows,
        pieceWidth,
        pieceHeight,
        rowCuts,
        colCuts,
        corners,
        edges,
    };
}
