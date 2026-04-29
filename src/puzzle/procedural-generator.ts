/**
 * Procedural puzzle generator.
 *
 * Produces a grid of pieces with varied, natural-looking cuts.
 * Each game has unique cut patterns thanks to a seeded PRNG that
 * randomises:
 *   - Tab/blank assignment per edge
 *   - Tab shape (Bézier control point variation)
 *   - Tab size (height and width)
 *   - Tab position along the edge (offset from centre)
 *   - Neck width
 *
 * The generator still outputs Piece[] conforming to the generic
 * model — the engine never sees grids or procedural parameters.
 *
 * Using the same seed reproduces the exact same cut pattern,
 * which is essential for save/restore.
 *
 * Edge Matching Approach (generate once, reverse for mate):
 * Each shared internal edge is generated ONCE as a series of Bézier
 * curve points. The "first side" (bottom of upper piece, right of
 * left piece) uses these points directly. The "second side" (top of
 * lower piece, left of right piece) reverses the points array.
 * This guarantees perfect matching since reversed Bézier control
 * points produce exact mirror curves.
 */

import type { Edge, Piece, Point, Size } from '../model/types.js';
import {
    bezierPathToSvg,
    fmt,
    reverseBezierPath,
} from './composable/bezier-path.js';
import type { BezierPath } from './composable/bezier-path.js';
import { createSeededRandom } from './seeded-random.js';

/** Direction of an edge relative to a grid cell. */
const Dir = {
    Top: 0,
    Right: 1,
    Bottom: 2,
    Left: 3,
} as const;

type Dir = (typeof Dir)[keyof typeof Dir];

/**
 * Stored edge paths for shared internal edges.
 * Key: "h_{row}_{col}" for horizontal edges (between row and row+1)
 * Key: "v_{row}_{col}" for vertical edges (between col and col+1)
 */
interface SharedEdgePaths {
    horizontal: BezierPath[][]; // [row][col] - edges between row and row+1
    vertical: BezierPath[][];   // [row][col] - edges between col and col+1
}

/**
 * Generate a procedural grid puzzle.
 *
 * @param cols - Number of columns
 * @param rows - Number of rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible cuts
 * @returns Array of pieces with full edge connectivity and SVG paths
 */
export function generateProceduralPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
): Piece[] {
    const random = createSeededRandom(seed);
    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    // Decide tab vs blank for each shared internal edge.
    // Each entry: true = first side gets a tab, false = first side gets a blank.
    const horizontalIsTab = createIsTabMap(cols, rows - 1, random); // between rows
    const verticalIsTab = createIsTabMap(cols - 1, rows, random); // between cols

    // Generate shared edge paths ONCE for each internal edge
    const sharedPaths = generateAllSharedEdgePaths(
        cols,
        rows,
        pieceWidth,
        pieceHeight,
        horizontalIsTab,
        verticalIsTab,
        random,
    );

    let nextEdgeId = 0;

    // Assign edge IDs in pairs for shared edges
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
            const edges: Edge[] = [];

            for (const dir of [Dir.Top, Dir.Right, Dir.Bottom, Dir.Left]) {
                edges.push(
                    buildEdge({
                        id: edgeIdMap[row][col][dir],
                        dir,
                        row,
                        col,
                        rows,
                        cols,
                        pieceWidth,
                        pieceHeight,
                        edgeIdMap,
                        sharedPaths,
                    }),
                );
            }

            const shape = buildShape(edges);

            pieces.push({
                id: row * cols + col,
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

/**
 * Generate all shared edge paths for the puzzle grid.
 * Each edge is generated ONCE from the "first side" perspective.
 */
function generateAllSharedEdgePaths(
    cols: number,
    rows: number,
    pieceWidth: number,
    pieceHeight: number,
    horizontalIsTab: boolean[][],
    verticalIsTab: boolean[][],
    random: () => number,
): SharedEdgePaths {
    // Horizontal edges (between row and row+1)
    // The "first side" is the bottom edge of the upper piece
    const horizontal: BezierPath[][] = [];
    for (let row = 0; row < rows - 1; row++) {
        horizontal[row] = [];
        for (let col = 0; col < cols; col++) {
            // Bottom edge of piece at (row, col): goes from (w, h) to (0, h)
            // Start and end in piece-local coordinates
            const start: Point = { x: pieceWidth, y: pieceHeight };
            const end: Point = { x: 0, y: pieceHeight };

            horizontal[row][col] = generateSharedEdgePath(
                start,
                end,
                horizontalIsTab[row][col],
                random,
            );
        }
    }

    // Vertical edges (between col and col+1)
    // The "first side" is the right edge of the left piece
    const vertical: BezierPath[][] = [];
    for (let row = 0; row < rows; row++) {
        vertical[row] = [];
        for (let col = 0; col < cols - 1; col++) {
            // Right edge of piece at (row, col): goes from (w, 0) to (w, h)
            const start: Point = { x: pieceWidth, y: 0 };
            const end: Point = { x: pieceWidth, y: pieceHeight };

            vertical[row][col] = generateSharedEdgePath(
                start,
                end,
                verticalIsTab[row][col],
                random,
            );
        }
    }

    return { horizontal, vertical };
}

/**
 * Generate a Bézier path for a shared edge using the classic 6-segment
 * jigsaw shape inspired by Dillo's twist0 algorithm.
 *
 * The algorithm uses a coordinate system relative to the edge:
 * - p0, p1 = start and end of the edge
 * - dxh, dyh = delta along the edge (horizontal in edge-relative coords)
 * - dxv, dyv = delta perpendicular to edge (vertical in edge-relative coords)
 * - pointAt(coeffh, coeffv) = p0 + coeffh * (dxh, dyh) + coeffv * (dxv, dyv)
 *
 * This produces the path from the "first side" perspective.
 * The "second side" will reverse this path.
 *
 * @param start - Start point of the edge (in piece-local coordinates)
 * @param end - End point of the edge (in piece-local coordinates)
 * @param isTab - Whether this side gets a tab (true) or blank (false)
 * @param random - Seeded PRNG function for consistent randomization
 * @returns Array of points representing Bézier curve segments
 */
function generateSharedEdgePath(
    start: Point,
    end: Point,
    isTab: boolean,
    random: () => number,
): BezierPath {
    // Edge vectors
    const dxh = end.x - start.x;
    const dyh = end.y - start.y;

    // Perpendicular vectors (90° counterclockwise rotation)
    // For a tab, this points outward from the piece
    const sign = isTab ? 1 : -1;
    const dxv = -dyh * sign;
    const dyv = dxh * sign;

    // Randomization parameters (seeded PRNG for consistency)
    // Fix #3: Widen size variation ranges
    const scalex = lerp(0.65, 1.0, random()); // horizontal scale of tab (was 0.8-1.0)
    const scaley = lerp(0.7, 1.1, random()); // vertical scale/height (was 0.9-1.0)
    const mid = lerp(0.38, 0.62, random()); // centre position along edge (was 0.45-0.55)

    // Fix #1: Add neck thickness variation
    // neckRatio = ratio of neck width to head width (0.25 = thin classic look, 0.80 = thick)
    const neckRatio = lerp(0.25, 0.80, random());

    // Helper to compute point at (coeffh, coeffv) in edge-relative coordinates
    const pointAt = (coeffh: number, coeffv: number): Point => ({
        x: start.x + coeffh * dxh + coeffv * dxv,
        y: start.y + coeffh * dyh + coeffv * dyv,
    });

    // Key points defining the classic mushroom tab shape
    // Adjusted by scalex (horizontal), scaley (vertical), and mid (centre position)
    const halfWidth = 0.17 * scalex; // half-width of the tab section (head width)

    // 5 key points along the tab:
    // pa = neck entry (where edge curves into neck)
    // pb = head left (left side of mushroom head)
    // pc = head top (top centre of mushroom)
    // pd = head right (right side of mushroom head)
    // pe = neck exit (where neck returns to edge)

    // Neck entry/exit perpendicular coefficient varies with neckRatio
    // neckRatio affects the horizontal position of neck points relative to head width
    const neckHalfWidth = halfWidth * neckRatio;

    const pa = pointAt(mid - neckHalfWidth, 0.08 * scaley);
    const pb = pointAt(mid - halfWidth * 0.9, 0.25 * scaley);
    const pc = pointAt(mid, 0.33 * scaley);
    const pd = pointAt(mid + halfWidth * 0.9, 0.25 * scaley);
    const pe = pointAt(mid + neckHalfWidth, 0.08 * scaley);

    // Build 6 cubic Bézier segments with appropriate control points
    // The control points create the smooth curves of the classic jigsaw shape

    // Fix #2: First and last segments should have control points ON the edge line
    // (zero perpendicular component) to prevent bulging that depends on tab direction.
    // The control points now only vary along the edge axis, not perpendicular to it.

    // Segment 1: p0 → pa (straight portion leading to neck entry)
    // Control points lie on edge line (coeffv = 0) to avoid direction-dependent bulge
    const cp1_1 = pointAt(mid - neckHalfWidth * 2.5, 0);
    const cp1_2 = pointAt(mid - neckHalfWidth * 1.5, 0);

    // Segment 2: pa → pb (neck curves outward to head left)
    // Adjust control points to smoothly transition from the narrower neck
    const cp2_1 = pointAt(mid - neckHalfWidth * 0.7, 0.12 * scaley);
    const cp2_2 = pointAt(mid - halfWidth * 1.1, 0.20 * scaley);

    // Segment 3: pb → pc (head left curves across to head top)
    const cp3_1 = pointAt(mid - halfWidth * 0.6, 0.32 * scaley);
    const cp3_2 = pointAt(mid - halfWidth * 0.3, 0.33 * scaley);

    // Segment 4: pc → pd (head top curves to head right)
    const cp4_1 = pointAt(mid + halfWidth * 0.3, 0.33 * scaley);
    const cp4_2 = pointAt(mid + halfWidth * 0.6, 0.32 * scaley);

    // Segment 5: pd → pe (head right curves back to neck exit)
    // Adjust control points to smoothly transition to the narrower neck
    const cp5_1 = pointAt(mid + halfWidth * 1.1, 0.20 * scaley);
    const cp5_2 = pointAt(mid + neckHalfWidth * 0.7, 0.12 * scaley);

    // Segment 6: pe → p1 (straight portion from neck exit to edge end)
    // Control points lie on edge line (coeffv = 0) to avoid direction-dependent bulge
    const cp6_1 = pointAt(mid + neckHalfWidth * 1.5, 0);
    const cp6_2 = pointAt(mid + neckHalfWidth * 2.5, 0);

    // Build the Bézier path as an array of points
    // Format: [start, cp1, cp2, end, cp1, cp2, end, ...]
    return [
        start,
        // Segment 1: start → pa
        cp1_1,
        cp1_2,
        pa,
        // Segment 2: pa → pb
        cp2_1,
        cp2_2,
        pb,
        // Segment 3: pb → pc
        cp3_1,
        cp3_2,
        pc,
        // Segment 4: pc → pd
        cp4_1,
        cp4_2,
        pd,
        // Segment 5: pd → pe
        cp5_1,
        cp5_2,
        pe,
        // Segment 6: pe → end
        cp6_1,
        cp6_2,
        end,
    ];
}

/**
 * Transform a Bézier path to new start/end coordinates.
 * The path was generated for a specific edge position; this transforms
 * it to the actual edge position in piece-local coordinates.
 */
function transformBezierPath(
    path: BezierPath,
    originalStart: Point,
    originalEnd: Point,
    newStart: Point,
    newEnd: Point,
): BezierPath {
    // Calculate transformation: original edge → new edge
    const origDx = originalEnd.x - originalStart.x;
    const origDy = originalEnd.y - originalStart.y;
    const newDx = newEnd.x - newStart.x;
    const newDy = newEnd.y - newStart.y;

    const origLen = Math.sqrt(origDx * origDx + origDy * origDy);
    const newLen = Math.sqrt(newDx * newDx + newDy * newDy);

    // Original unit vectors
    const origUx = origDx / origLen;
    const origUy = origDy / origLen;
    const origNx = -origUy;
    const origNy = origUx;

    // New unit vectors
    const newUx = newDx / newLen;
    const newUy = newDy / newLen;
    const newNx = -newUy;
    const newNy = newUx;

    const scale = newLen / origLen;

    return path.map((p) => {
        // Get point relative to original start in original coordinate system
        const relX = p.x - originalStart.x;
        const relY = p.y - originalStart.y;

        // Project onto original axes
        const alongEdge = relX * origUx + relY * origUy;
        const perpEdge = relX * origNx + relY * origNy;

        // Scale and reconstruct in new coordinate system
        const scaledAlong = alongEdge * scale;
        const scaledPerp = perpEdge * scale;

        return {
            x: newStart.x + scaledAlong * newUx + scaledPerp * newNx,
            y: newStart.y + scaledAlong * newUy + scaledPerp * newNy,
        };
    });
}

interface BuildEdgeParams {
    id: number;
    dir: Dir;
    row: number;
    col: number;
    rows: number;
    cols: number;
    pieceWidth: number;
    pieceHeight: number;
    edgeIdMap: number[][][];
    sharedPaths: SharedEdgePaths;
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
        edgeIdMap,
        sharedPaths,
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
        path = buildFlatEdgePath(end);
    } else {
        path = buildSharedEdgePath(
            dir,
            row,
            col,
            start,
            end,
            pieceWidth,
            pieceHeight,
            sharedPaths,
        );
    }

    return { id, mateEdgeId, matePieceId, path, start, end };
}

/**
 * Build the SVG path for a shared (non-border) edge.
 * Uses the pre-generated Bézier path, reversing it if this is the "second side".
 */
function buildSharedEdgePath(
    dir: Dir,
    row: number,
    col: number,
    start: Point,
    end: Point,
    pieceWidth: number,
    pieceHeight: number,
    sharedPaths: SharedEdgePaths,
): string {
    let storedPath: BezierPath;
    let originalStart: Point;
    let originalEnd: Point;
    let isSecondSide: boolean;

    switch (dir) {
        case Dir.Bottom:
            // First side: bottom edge of this piece
            // Path was generated for bottom edge: (w, h) → (0, h)
            storedPath = sharedPaths.horizontal[row][col];
            originalStart = { x: pieceWidth, y: pieceHeight };
            originalEnd = { x: 0, y: pieceHeight };
            isSecondSide = false;
            break;

        case Dir.Top:
            // Second side: top edge of this piece = mate of bottom edge of piece above
            // Path was generated for bottom edge of piece at (row-1, col)
            storedPath = sharedPaths.horizontal[row - 1][col];
            originalStart = { x: pieceWidth, y: pieceHeight };
            originalEnd = { x: 0, y: pieceHeight };
            isSecondSide = true;
            break;

        case Dir.Right:
            // First side: right edge of this piece
            // Path was generated for right edge: (w, 0) → (w, h)
            storedPath = sharedPaths.vertical[row][col];
            originalStart = { x: pieceWidth, y: 0 };
            originalEnd = { x: pieceWidth, y: pieceHeight };
            isSecondSide = false;
            break;

        case Dir.Left:
            // Second side: left edge of this piece = mate of right edge of piece to left
            // Path was generated for right edge of piece at (row, col-1)
            storedPath = sharedPaths.vertical[row][col - 1];
            originalStart = { x: pieceWidth, y: 0 };
            originalEnd = { x: pieceWidth, y: pieceHeight };
            isSecondSide = true;
            break;
    }

    // For second side, reverse the path
    let pathToUse = storedPath;
    if (isSecondSide) {
        pathToUse = reverseBezierPath(storedPath);
        // After reversal, the start/end are swapped
        const temp = originalStart;
        originalStart = originalEnd;
        originalEnd = temp;
    }

    // Transform the path to the actual edge coordinates
    const transformedPath = transformBezierPath(
        pathToUse,
        originalStart,
        originalEnd,
        start,
        end,
    );

    return bezierPathToSvg(transformedPath);
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

/**
 * Build a 2D map of isTab flags (one per shared internal edge).
 * true = first side gets a tab, false = first side gets a blank.
 *
 * Advances the seeded PRNG by 6 calls per edge: the historical
 * randomTabParams() consumed 6 values (isTab + 5 shape fields that
 * the rest of the generator never read). Existing share links store
 * only the seed and re-run this generator, so the exact sequence of
 * PRNG calls is part of the on-the-wire contract. The 5 reserved
 * calls are also slots available for future per-edge shape randomness.
 */
function createIsTabMap(
    width: number,
    height: number,
    random: () => number,
): boolean[][] {
    return Array.from({ length: height }, () =>
        Array.from({ length: width }, () => {
            const isTab = random() < 0.5;
            random(); random(); random(); random(); random();
            return isTab;
        }),
    );
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Straight line path segment (for border edges). */
function buildFlatEdgePath(end: Point): string {
    return `L ${end.x} ${end.y}`;
}

/**
 * Build the full SVG `d` attribute from the four edge paths.
 */
function buildShape(edges: Edge[]): string {
    if (edges.length === 0) return '';

    const first = edges[0];
    const parts = [`M ${fmt(first.start.x)} ${fmt(first.start.y)}`];

    for (const edge of edges) {
        parts.push(edge.path);
    }

    parts.push('Z');

    return parts.join(' ');
}
