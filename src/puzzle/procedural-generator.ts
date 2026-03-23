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
 * Parameters controlling the shape of a single tab/blank.
 * Generated per shared internal edge by the PRNG.
 */
export interface TabParams {
    /** Whether the "first" side of the shared edge gets a tab (true) or blank (false). */
    isTab: boolean;
    /** Bump height as a fraction of edge length. Range: [0.14, 0.36]. */
    heightFraction: number;
    /** Neck width as a fraction of edge length. Range: [0.04, 0.10]. */
    neckFraction: number;
    /** Tab head width as a fraction of edge length. Range: [0.16, 0.28]. */
    headWidthFraction: number;
    /** Tab centre offset along the edge, 0 = dead centre. Range: [-0.18, 0.18]. */
    centreOffset: number;
    /** Asymmetry: slight left/right skew of the tab head. Range: [-0.04, 0.04]. */
    skew: number;
}

/**
 * A series of Bézier curve segments represented as points.
 * Each segment has: startPoint, controlPoint1, controlPoint2, endPoint.
 * For N segments, we store: [start, cp1, cp2, end, cp1, cp2, end, ...]
 * where each segment after the first shares the previous end as its start.
 *
 * Format: [p0, cp1_1, cp2_1, p1, cp1_2, cp2_2, p2, ...]
 * - Index 0: start point
 * - Then groups of 3: (cp1, cp2, endpoint) for each segment
 */
type BezierPath = Point[];

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

    // Generate unique tab parameters for each shared internal edge
    const horizontalParams = createParamsMap(cols, rows - 1, random); // between rows
    const verticalParams = createParamsMap(cols - 1, rows, random); // between cols

    // Generate shared edge paths ONCE for each internal edge
    const sharedPaths = generateAllSharedEdgePaths(
        cols,
        rows,
        pieceWidth,
        pieceHeight,
        horizontalParams,
        verticalParams,
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
                        horizontalParams,
                        verticalParams,
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
    horizontalParams: TabParams[][],
    verticalParams: TabParams[][],
): SharedEdgePaths {
    // Horizontal edges (between row and row+1)
    // The "first side" is the bottom edge of the upper piece
    const horizontal: BezierPath[][] = [];
    for (let row = 0; row < rows - 1; row++) {
        horizontal[row] = [];
        for (let col = 0; col < cols; col++) {
            const params = horizontalParams[row][col];
            // Bottom edge of piece at (row, col): goes from (w, h) to (0, h)
            // Start and end in piece-local coordinates
            const start: Point = { x: pieceWidth, y: pieceHeight };
            const end: Point = { x: 0, y: pieceHeight };

            horizontal[row][col] = generateSharedEdgePath(
                start,
                end,
                params.isTab, // first side uses isTab directly
                params,
            );
        }
    }

    // Vertical edges (between col and col+1)
    // The "first side" is the right edge of the left piece
    const vertical: BezierPath[][] = [];
    for (let row = 0; row < rows; row++) {
        vertical[row] = [];
        for (let col = 0; col < cols - 1; col++) {
            const params = verticalParams[row][col];
            // Right edge of piece at (row, col): goes from (w, 0) to (w, h)
            const start: Point = { x: pieceWidth, y: 0 };
            const end: Point = { x: pieceWidth, y: pieceHeight };

            vertical[row][col] = generateSharedEdgePath(
                start,
                end,
                params.isTab, // first side uses isTab directly
                params,
            );
        }
    }

    return { horizontal, vertical };
}

/**
 * Generate a Bézier path for a shared edge.
 * This produces the path from the "first side" perspective.
 * The "second side" will reverse this path.
 *
 * @param start - Start point of the edge (in piece-local coordinates)
 * @param end - End point of the edge (in piece-local coordinates)
 * @param isTab - Whether this side gets a tab (true) or blank (false)
 * @param params - Shape parameters for the tab/blank
 * @returns Array of points representing Bézier curve segments
 */
function generateSharedEdgePath(
    start: Point,
    end: Point,
    isTab: boolean,
    params: TabParams,
): BezierPath {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    // Unit vectors along and perpendicular to the edge
    const ux = dx / edgeLength;
    const uy = dy / edgeLength;
    const nx = -uy; // normal (perpendicular)
    const ny = ux;

    const sign = isTab ? 1 : -1;

    const bumpHeight = edgeLength * params.heightFraction;
    const neckWidth = edgeLength * params.neckFraction;
    const headWidth = edgeLength * params.headWidthFraction;

    // Tab centre position (0.5 = dead centre, offset shifts it)
    // centreOffset and skew are used directly for first side
    const tCentre = 0.5 + params.centreOffset;
    const halfSpan = 0.15;

    const t1 = tCentre - halfSpan; // start of neck
    const t2 = tCentre;            // centre of bump
    const t3 = tCentre + halfSpan; // end of neck

    // Points along the edge
    const p1 = addVec(start, scaleVec(ux, uy, edgeLength * t1));
    const p2 = addVec(start, scaleVec(ux, uy, edgeLength * t2));
    const p3 = addVec(start, scaleVec(ux, uy, edgeLength * t3));

    // Neck entry/exit points
    const neck1 = addVec(p1, scaleVec(nx, ny, sign * neckWidth * 0.4));
    const neck2 = addVec(p3, scaleVec(nx, ny, sign * neckWidth * 0.4));

    // Tab head peak points with skew for asymmetry
    const skewOffset = params.skew * edgeLength;

    const peak1 = addVec(
        addVec(p1, scaleVec(nx, ny, sign * bumpHeight)),
        scaleVec(ux, uy, -headWidth * 0.3 + skewOffset),
    );
    const peakCentre = addVec(p2, scaleVec(nx, ny, sign * bumpHeight));
    const peak2 = addVec(
        addVec(p3, scaleVec(nx, ny, sign * bumpHeight)),
        scaleVec(ux, uy, headWidth * 0.3 + skewOffset),
    );

    // Build the Bézier path as an array of points
    // Format: [start, cp1, cp2, end, cp1, cp2, end, ...]
    // We have 4 segments:
    // 1. start → p1 (line, but we'll use degenerate cubic)
    // 2. p1 → peakCentre (neck to head via neck1 and peak1)
    // 3. peakCentre → p3 (head to neck via peak2 and neck2)
    // 4. p3 → end (line)

    return [
        start,
        // Segment 1: start → p1 (straight line as degenerate cubic)
        start, p1, p1,
        // Segment 2: p1 → peakCentre (through neck1 and peak1)
        neck1, peak1, peakCentre,
        // Segment 3: peakCentre → p3 (through peak2 and neck2)
        peak2, neck2, p3,
        // Segment 4: p3 → end (straight line as degenerate cubic)
        p3, end, end,
    ];
}

/**
 * Reverse a Bézier path to create the mating edge.
 * This reverses both the order of points and the control point pairs.
 *
 * Input format: [p0, cp1_1, cp2_1, p1, cp1_2, cp2_2, p2, ...]
 * Each segment: p_{i} uses cp1_{i+1}, cp2_{i+1} to reach p_{i+1}
 *
 * For reversal, we need to swap the order of control points within each segment.
 */
function reverseBezierPath(path: BezierPath): BezierPath {
    if (path.length < 4) return [...path].reverse();

    // Path format: [p0, cp1_1, cp2_1, p1, cp1_2, cp2_2, p2, ...]
    // Each group of 3 after the first point is (cp1, cp2, endpoint)
    // Number of segments = (path.length - 1) / 3

    const result: BezierPath = [];
    const numSegments = (path.length - 1) / 3;

    // Start with the last endpoint
    result.push(path[path.length - 1]);

    // Work backwards through segments, swapping control points
    for (let i = numSegments - 1; i >= 0; i--) {
        const segmentStart = 1 + i * 3;
        const cp1 = path[segmentStart];
        const cp2 = path[segmentStart + 1];
        // Swap control points: cp2 becomes new cp1, cp1 becomes new cp2
        result.push(cp2);
        result.push(cp1);
        // The endpoint of reversed segment is the start of original segment
        // For segment 0, that's path[0]; for segment i, that's path[1 + (i-1)*3 + 2] = path[i*3]
        const prevEndpoint = i === 0 ? path[0] : path[i * 3];
        result.push(prevEndpoint);
    }

    return result;
}

/**
 * Convert a Bézier path to SVG path commands.
 * The path starts from the current position (after M command),
 * so we skip the first point and emit C commands for each segment.
 */
function bezierPathToSvg(path: BezierPath): string {
    if (path.length < 4) return '';

    const commands: string[] = [];
    const numSegments = (path.length - 1) / 3;

    for (let i = 0; i < numSegments; i++) {
        const segmentStart = 1 + i * 3;
        const cp1 = path[segmentStart];
        const cp2 = path[segmentStart + 1];
        const end = path[segmentStart + 2];
        commands.push(
            `C ${fmt(cp1.x)} ${fmt(cp1.y)}, ${fmt(cp2.x)} ${fmt(cp2.y)}, ${fmt(end.x)} ${fmt(end.y)}`,
        );
    }

    return commands.join(' ');
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
    horizontalParams: TabParams[][];
    verticalParams: TabParams[][];
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
        horizontalParams,
        verticalParams,
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
            horizontalParams,
            verticalParams,
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
    _horizontalParams: TabParams[][],
    _verticalParams: TabParams[][],
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
 * Create a map of randomized TabParams for shared edges.
 */
function createParamsMap(
    width: number,
    height: number,
    random: () => number,
): TabParams[][] {
    return Array.from({ length: height }, () =>
        Array.from({ length: width }, () => randomTabParams(random)),
    );
}

/**
 * Generate random tab parameters within natural-looking ranges.
 */
export function randomTabParams(random: () => number): TabParams {
    return {
        isTab: random() < 0.5,
        heightFraction: lerp(0.14, 0.36, random()),
        neckFraction: lerp(0.04, 0.10, random()),
        headWidthFraction: lerp(0.16, 0.28, random()),
        centreOffset: lerp(-0.18, 0.18, random()),
        skew: lerp(-0.04, 0.04, random()),
    };
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Straight line path segment (for border edges). */
function buildFlatEdgePath(end: Point): string {
    return `L ${end.x} ${end.y}`;
}

function fmt(n: number): string {
    return n.toFixed(2);
}

function addVec(p: Point, v: Point): Point {
    return { x: p.x + v.x, y: p.y + v.y };
}

function scaleVec(ux: number, uy: number, s: number): Point {
    return { x: ux * s, y: uy * s };
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
