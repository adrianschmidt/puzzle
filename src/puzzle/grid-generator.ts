/**
 * Grid puzzle generator.
 *
 * Produces a 6×8 grid of pieces with tab/blank Bézier edges.
 * This is a generator — it outputs Piece[] conforming to the
 * generic model. The engine never sees rows, columns, or grids.
 *
 * Terminology:
 * - "tab" = a protruding bump on an edge (convex)
 * - "blank" = an indentation on an edge (concave)
 * - Adjacent pieces share the exact same curve, inverted.
 */

import type { Edge, Piece, Point, Size } from '../model/types.js';

/** Direction of an edge relative to a grid cell. */
const Dir = {
    Top: 0,
    Right: 1,
    Bottom: 2,
    Left: 3,
} as const;

type Dir = (typeof Dir)[keyof typeof Dir];

/**
 * Generate a grid puzzle.
 *
 * @param cols - Number of columns (e.g. 8)
 * @param rows - Number of rows (e.g. 6)
 * @param imageSize - Pixel dimensions of the puzzle image
 * @returns Array of pieces with full edge connectivity and SVG paths
 */
export function generateGridPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
): Piece[] {
    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    // Pre-compute which edges get tabs vs blanks.
    // For each internal edge, we randomly assign tab/blank to one side;
    // the other side gets the inverse.
    // true = tab (convex), false = blank (concave)
    const horizontalTabs = createTabMap(cols, rows - 1); // horizontal edges between rows
    const verticalTabs = createTabMap(cols - 1, rows); // vertical edges between columns

    let nextEdgeId = 0;

    // First pass: assign edge IDs so we can set up mate relationships.
    // Edge layout per cell: [top, right, bottom, left]
    // We share edges between adjacent cells.
    const edgeIds: number[][][] = []; // [row][col][dir]

    for (let row = 0; row < rows; row++) {
        edgeIds[row] = [];
        for (let col = 0; col < cols; col++) {
            edgeIds[row][col] = [-1, -1, -1, -1];

            // Top edge: shared with cell above's bottom edge
            if (row > 0) {
                edgeIds[row][col][Dir.Top] = edgeIds[row - 1][col][Dir.Bottom] + 1;
                // The mate will be the previous cell's bottom edge;
                // we use +1 as the pair convention: even=top/left, odd=bottom/right
            }

            // Left edge: shared with cell to the left's right edge
            if (col > 0) {
                edgeIds[row][col][Dir.Left] = edgeIds[row][col - 1][Dir.Right] + 1;
            }
        }
    }

    // Simpler approach: assign IDs in pairs for shared edges.
    // For each shared internal edge, assign two consecutive IDs (one per side).
    // Border edges get a single ID each.
    const edgeIdMap: number[][][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => [-1, -1, -1, -1]),
    );

    // Horizontal shared edges (between row and row+1)
    for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols; col++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            edgeIdMap[row][col][Dir.Bottom] = id1;
            edgeIdMap[row + 1][col][Dir.Top] = id2;
        }
    }

    // Vertical shared edges (between col and col+1)
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            edgeIdMap[row][col][Dir.Right] = id1;
            edgeIdMap[row][col + 1][Dir.Left] = id2;
        }
    }

    // Border edges (no mate)
    for (let col = 0; col < cols; col++) {
        edgeIdMap[0][col][Dir.Top] = nextEdgeId++;
        edgeIdMap[rows - 1][col][Dir.Bottom] = nextEdgeId++;
    }
    for (let row = 0; row < rows; row++) {
        edgeIdMap[row][0][Dir.Left] = nextEdgeId++;
        edgeIdMap[row][cols - 1][Dir.Right] = nextEdgeId++;
    }

    // Build pieces
    const pieces: Piece[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const pieceId = row * cols + col;
            const edges: Edge[] = [];

            // Top edge
            edges.push(
                buildEdge({
                    id: edgeIdMap[row][col][Dir.Top],
                    dir: Dir.Top,
                    row,
                    col,
                    rows,
                    cols,
                    pieceWidth,
                    pieceHeight,
                    horizontalTabs,
                    verticalTabs,
                    edgeIdMap,
                }),
            );

            // Right edge
            edges.push(
                buildEdge({
                    id: edgeIdMap[row][col][Dir.Right],
                    dir: Dir.Right,
                    row,
                    col,
                    rows,
                    cols,
                    pieceWidth,
                    pieceHeight,
                    horizontalTabs,
                    verticalTabs,
                    edgeIdMap,
                }),
            );

            // Bottom edge
            edges.push(
                buildEdge({
                    id: edgeIdMap[row][col][Dir.Bottom],
                    dir: Dir.Bottom,
                    row,
                    col,
                    rows,
                    cols,
                    pieceWidth,
                    pieceHeight,
                    horizontalTabs,
                    verticalTabs,
                    edgeIdMap,
                }),
            );

            // Left edge
            edges.push(
                buildEdge({
                    id: edgeIdMap[row][col][Dir.Left],
                    dir: Dir.Left,
                    row,
                    col,
                    rows,
                    cols,
                    pieceWidth,
                    pieceHeight,
                    horizontalTabs,
                    verticalTabs,
                    edgeIdMap,
                }),
            );

            // Build full SVG clip-path from edge paths
            const shape = buildShape(edges);

            pieces.push({
                id: pieceId,
                edges,
                shape,
                imageOffset: {
                    x: -col * pieceWidth,
                    y: -row * pieceHeight,
                },
            });
        }
    }

    return pieces;
}

// --- Internal helpers ---

interface BuildEdgeParams {
    id: number;
    dir: Dir;
    row: number;
    col: number;
    rows: number;
    cols: number;
    pieceWidth: number;
    pieceHeight: number;
    horizontalTabs: boolean[][];
    verticalTabs: boolean[][];
    edgeIdMap: number[][][];
}

function buildEdge(params: BuildEdgeParams): Edge {
    const {
        id,
        dir,
        row,
        col,
        rows,
        cols,
        pieceWidth,
        pieceHeight,
        horizontalTabs,
        verticalTabs,
        edgeIdMap,
    } = params;

    const isBorder = isBorderEdge(dir, row, col, rows, cols);
    const { start, end } = getEdgeEndpoints(dir, pieceWidth, pieceHeight);

    let mateEdgeId = -1;
    let matePieceId = -1;

    if (!isBorder) {
        const matePos = getMatePosition(dir, row, col);
        const mateDir = getOppositeDir(dir);
        mateEdgeId = edgeIdMap[matePos.row][matePos.col][mateDir];
        matePieceId = matePos.row * cols + matePos.col;
    }

    let path: string;

    if (isBorder) {
        path = buildFlatEdgePath(start, end);
    } else {
        const isTab = getIsTab(dir, row, col, horizontalTabs, verticalTabs);
        path = buildCurvedEdgePath(start, end, dir, isTab);
    }

    return { id, mateEdgeId, matePieceId, path, start, end };
}

function isBorderEdge(
    dir: Dir,
    row: number,
    col: number,
    rows: number,
    cols: number,
): boolean {
    switch (dir) {
        case Dir.Top:
            return row === 0;
        case Dir.Bottom:
            return row === rows - 1;
        case Dir.Left:
            return col === 0;
        case Dir.Right:
            return col === cols - 1;
    }
}

function getEdgeEndpoints(
    dir: Dir,
    w: number,
    h: number,
): { start: Point; end: Point } {
    switch (dir) {
        case Dir.Top:
            return { start: { x: 0, y: 0 }, end: { x: w, y: 0 } };
        case Dir.Right:
            return { start: { x: w, y: 0 }, end: { x: w, y: h } };
        case Dir.Bottom:
            return { start: { x: w, y: h }, end: { x: 0, y: h } };
        case Dir.Left:
            return { start: { x: 0, y: h }, end: { x: 0, y: 0 } };
    }
}

function getOppositeDir(dir: Dir): Dir {
    switch (dir) {
        case Dir.Top:
            return Dir.Bottom;
        case Dir.Bottom:
            return Dir.Top;
        case Dir.Left:
            return Dir.Right;
        case Dir.Right:
            return Dir.Left;
    }
}

function getMatePosition(
    dir: Dir,
    row: number,
    col: number,
): { row: number; col: number } {
    switch (dir) {
        case Dir.Top:
            return { row: row - 1, col };
        case Dir.Bottom:
            return { row: row + 1, col };
        case Dir.Left:
            return { row, col: col - 1 };
        case Dir.Right:
            return { row, col: col + 1 };
    }
}

function getIsTab(
    dir: Dir,
    row: number,
    col: number,
    horizontalTabs: boolean[][],
    verticalTabs: boolean[][],
): boolean {
    switch (dir) {
        case Dir.Top:
            // Horizontal edge above this row: horizontalTabs[row-1][col]
            // This cell's top is the "bottom side" of that shared edge → invert
            return !horizontalTabs[row - 1][col];
        case Dir.Bottom:
            // Horizontal edge below this row: horizontalTabs[row][col]
            // This cell's bottom is the "top side" of that shared edge
            return horizontalTabs[row][col];
        case Dir.Left:
            // Vertical edge to the left: verticalTabs[row][col-1]
            // This cell's left is the "right side" → invert
            return !verticalTabs[row][col - 1];
        case Dir.Right:
            // Vertical edge to the right: verticalTabs[row][col]
            // This cell's right is the "left side"
            return verticalTabs[row][col];
    }
}

/**
 * Create a random boolean map for tab assignment.
 * true = tab on the "first" side, false = blank on the "first" side.
 */
function createTabMap(width: number, height: number): boolean[][] {
    return Array.from({ length: height }, () =>
        Array.from({ length: width }, () => Math.random() < 0.5),
    );
}

/** Straight line path segment (for border edges). */
function buildFlatEdgePath(_start: Point, end: Point): string {
    return `L ${end.x} ${end.y}`;
}

/**
 * Build a Bézier curve path for an interlocking edge (tab or blank).
 *
 * The curve creates a rounded tab or indentation along the edge.
 * The bump height is ~25% of the edge length for a natural look.
 *
 * @param start - Edge start point
 * @param end - Edge end point
 * @param dir - Edge direction
 * @param isTab - true for convex (tab), false for concave (blank)
 */
function buildCurvedEdgePath(
    start: Point,
    end: Point,
    _dir: Dir,
    isTab: boolean,
): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    // Unit vectors along and perpendicular to the edge
    const ux = dx / edgeLength; // along the edge
    const uy = dy / edgeLength;
    const nx = -uy; // normal (perpendicular), pointing "outward" for top/right
    const ny = ux;

    // Flip normal direction for tab vs blank
    // For top/right edges, "outward" is away from the piece center.
    // We want tabs to protrude outward.
    const sign = getTabSign(_dir, isTab);

    const bumpHeight = edgeLength * 0.25;
    const neckWidth = edgeLength * 0.1;
    const tabWidth = edgeLength * 0.15;

    // Key points along the edge (parametric)
    // The tab/blank starts at ~35% and ends at ~65% of the edge
    const t1 = 0.35; // start of neck
    const t2 = 0.5; // center of bump
    const t3 = 0.65; // end of neck

    // Points along the edge
    const p1 = addVec(start, scaleVec(ux, uy, edgeLength * t1));
    const p2 = addVec(start, scaleVec(ux, uy, edgeLength * t2));
    const p3 = addVec(start, scaleVec(ux, uy, edgeLength * t3));

    // Neck entry point (slight inward movement)
    const neck1 = addVec(p1, scaleVec(nx, ny, sign * neckWidth * 0.3));
    // Tab peak left
    const peak1 = addVec(
        addVec(p1, scaleVec(nx, ny, sign * bumpHeight)),
        scaleVec(ux, uy, -tabWidth * 0.2),
    );
    // Tab peak center (top of bump)
    const peakCenter = addVec(p2, scaleVec(nx, ny, sign * bumpHeight));
    // Tab peak right
    const peak2 = addVec(
        addVec(p3, scaleVec(nx, ny, sign * bumpHeight)),
        scaleVec(ux, uy, tabWidth * 0.2),
    );
    // Neck exit point
    const neck2 = addVec(p3, scaleVec(nx, ny, sign * neckWidth * 0.3));

    // Build path: straight to neck → cubic Bézier up to peak → cubic Bézier down → straight to end
    return [
        `L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
        `C ${neck1.x.toFixed(2)} ${neck1.y.toFixed(2)}, ${peak1.x.toFixed(2)} ${peak1.y.toFixed(2)}, ${peakCenter.x.toFixed(2)} ${peakCenter.y.toFixed(2)}`,
        `C ${peak2.x.toFixed(2)} ${peak2.y.toFixed(2)}, ${neck2.x.toFixed(2)} ${neck2.y.toFixed(2)}, ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
        `L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    ].join(' ');
}

/**
 * Determine the sign for the bump direction.
 * Positive = bump goes in the normal direction, negative = opposite.
 */
function getTabSign(_dir: Dir, isTab: boolean): number {
    // The normal vector points:
    // Top edge: normal = (0, -1) → upward (away from piece)
    // Right edge: normal = (1, 0) → rightward (away from piece)
    // Bottom edge: normal = (0, 1) → downward (but edge goes right-to-left, so normal flips)
    // Left edge: normal = (-1, 0) → leftward (but edge goes bottom-to-top, so normal flips)
    //
    // For top and right, positive normal = outward from piece.
    // For bottom and left, the edge direction is reversed,
    // so the computed normal already points outward.
    //
    // Tabs protrude outward → positive sign.
    // Blanks indent inward → negative sign.
    return isTab ? 1 : -1;
}

function addVec(p: Point, v: Point): Point {
    return { x: p.x + v.x, y: p.y + v.y };
}

function scaleVec(ux: number, uy: number, s: number): Point {
    return { x: ux * s, y: uy * s };
}

/**
 * Build the full SVG `d` attribute from the four edge paths.
 * Starts with M (move to first edge's start), then appends each edge path.
 */
function buildShape(edges: Edge[]): string {
    if (edges.length === 0) return '';

    const first = edges[0];
    const parts = [`M ${first.start.x.toFixed(2)} ${first.start.y.toFixed(2)}`];

    for (const edge of edges) {
        parts.push(edge.path);
    }

    parts.push('Z');

    return parts.join(' ');
}
