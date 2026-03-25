/**
 * Composition layer for the composable puzzle generator.
 *
 * Takes a GridDefinition and TabTemplate, and produces Piece[] by:
 * 1. Deciding tab/blank assignment per shared edge
 * 2. Generating tab shapes from the template in normalized space
 * 3. Transforming tab shapes onto actual grid edges
 * 4. Building the final Piece objects with mate relationships
 *
 * See issue #127 for the composable architecture design,
 * and #138 for this layer specifically.
 */

import type { Edge, Piece, Point } from '../../model/types.js';
import type { GridDefinition } from './grid-cuts.js';
import type { TabTemplate, BezierPath } from './tab-shapes.js';
import { reverseBezierPath, mirrorBezierPathY } from './tab-shapes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Direction of an edge relative to a piece. */
const Dir = {
    Top: 0,
    Right: 1,
    Bottom: 2,
    Left: 3,
} as const;

type Dir = (typeof Dir)[keyof typeof Dir];

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Compose a puzzle from a grid definition and tab template.
 *
 * @param grid - The grid structure (cuts, corners, edges)
 * @param template - Tab shape template to use
 * @param random - Seeded PRNG for tab assignment and shape variation
 * @returns Complete Piece[] ready for the game engine
 */
export function composePuzzle(
    grid: GridDefinition,
    template: TabTemplate,
    random: () => number,
): Piece[] {
    const { cols, rows, pieceWidth, pieceHeight, corners } = grid;

    // Helper: convert a world-space corner position to piece-local coordinates
    // by subtracting the piece's top-left corner position.
    const toLocal = (worldPt: Point, pieceRow: number, pieceCol: number): Point => {
        const origin = corners[pieceRow][pieceCol].position;
        return { x: worldPt.x - origin.x, y: worldPt.y - origin.y };
    };

    // Step 1: Generate tab shapes in NORMALIZED space (0,0)→(1,0).
    // Store them normalized — each side transforms on-the-fly using its own
    // corner positions. This avoids coordinate space mismatches between
    // the first side and the reversed second side.
    const horizontalPaths: BezierPath[][] = []; // [row][col] between row and row+1
    const verticalPaths: BezierPath[][] = [];   // [row][col] between col and col+1

    for (let row = 0; row < rows - 1; row++) {
        horizontalPaths[row] = [];
        for (let col = 0; col < cols; col++) {
            const isTab = random() > 0.5;
            let normalizedPath = template.generate(random);
            if (!isTab) {
                normalizedPath = mirrorBezierPathY(normalizedPath);
            }
            horizontalPaths[row][col] = normalizedPath;
        }
    }

    for (let row = 0; row < rows; row++) {
        verticalPaths[row] = [];
        for (let col = 0; col < cols - 1; col++) {
            const isTab = random() > 0.5;
            let normalizedPath = template.generate(random);
            if (!isTab) {
                normalizedPath = mirrorBezierPathY(normalizedPath);
            }
            verticalPaths[row][col] = normalizedPath;
        }
    }

    // Step 2: Assign edge IDs
    let nextEdgeId = 0;
    const edgeIdMap: number[][][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => [-1, -1, -1, -1]),
    );

    // Shared horizontal edges (between row and row+1)
    for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols; col++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            edgeIdMap[row][col][Dir.Bottom] = id1;
            edgeIdMap[row + 1][col][Dir.Top] = id2;
        }
    }

    // Shared vertical edges (between col and col+1)
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            edgeIdMap[row][col][Dir.Right] = id1;
            edgeIdMap[row][col + 1][Dir.Left] = id2;
        }
    }

    // Border edges
    for (let col = 0; col < cols; col++) {
        edgeIdMap[0][col][Dir.Top] = nextEdgeId++;
        edgeIdMap[rows - 1][col][Dir.Bottom] = nextEdgeId++;
    }
    for (let row = 0; row < rows; row++) {
        edgeIdMap[row][0][Dir.Left] = nextEdgeId++;
        edgeIdMap[row][cols - 1][Dir.Right] = nextEdgeId++;
    }

    // Step 3: Build pieces
    const pieces: Piece[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const edges: Edge[] = [];

            for (const dir of [Dir.Top, Dir.Right, Dir.Bottom, Dir.Left]) {
                edges.push(buildEdge(
                    edgeIdMap[row][col][dir],
                    dir, row, col, rows, cols,
                    pieceWidth, pieceHeight,
                    edgeIdMap,
                    horizontalPaths, verticalPaths,
                    corners, toLocal,
                ));
            }

            const shape = buildShape(edges);

            // Image offset: the piece's top-left corner in image space
            const origin = corners[row][col].position;
            pieces.push({
                id: row * cols + col,
                edges,
                shape,
                imageOffset: {
                    x: -origin.x,
                    y: -origin.y,
                },
            });
        }
    }

    return pieces;
}

// ---------------------------------------------------------------------------
// Path transformation
// ---------------------------------------------------------------------------

/**
 * Transform a BezierPath from normalized space ((0,0)→(1,0)) to
 * actual edge coordinates (start→end).
 *
 * Uses an affine transform that maps:
 *   (0,0) → start
 *   (1,0) → end
 *   (0,1) → perpendicular direction (for tab height)
 */

function buildEdge(
    id: number,
    dir: Dir,
    row: number,
    col: number,
    rows: number,
    cols: number,
    pieceWidth: number,
    pieceHeight: number,
    edgeIdMap: number[][][],
    horizontalPaths: BezierPath[][],
    verticalPaths: BezierPath[][],
    corners: import('./grid-cuts.js').GridCorner[][],
    toLocal: (worldPt: Point, pieceRow: number, pieceCol: number) => Point,
): Edge {
    const { start, end } = getEdgeEndpointsFromCorners(dir, row, col, corners, toLocal);
    const border = isBorderEdge(dir, row, col, rows, cols);

    if (border) {
        return {
            id,
            mateEdgeId: -1,
            matePieceId: -1,
            path: `L ${fmt(end.x)} ${fmt(end.y)}`,
            start,
            end,
        };
    }

    // Shared edge — get the stored path
    const { path, mateEdgeId, matePieceId } = getSharedEdge(
        dir, row, col, cols,
        pieceWidth, pieceHeight,
        edgeIdMap,
        horizontalPaths, verticalPaths,
        start, end,
    );

    return { id, mateEdgeId, matePieceId, path, start, end };
}

function getSharedEdge(
    dir: Dir,
    row: number,
    col: number,
    cols: number,
    _pieceWidth: number,
    _pieceHeight: number,
    edgeIdMap: number[][][],
    horizontalPaths: BezierPath[][],
    verticalPaths: BezierPath[][],
    start: Point,
    end: Point,
): { path: string; mateEdgeId: number; matePieceId: number } {
    // Paths are stored in normalized space (0,0)→(1,0).
    // For the first side, transform normalized to start→end.
    // For the second side, reverse normalized path first.
    let normalizedPath: BezierPath;
    let mateRow: number;
    let mateCol: number;
    let mateDir: Dir;
    let isSecondSide: boolean;

    switch (dir) {
        case Dir.Bottom:
            normalizedPath = horizontalPaths[row][col];
            isSecondSide = false;
            mateRow = row + 1; mateCol = col; mateDir = Dir.Top;
            break;
        case Dir.Top:
            normalizedPath = horizontalPaths[row - 1][col];
            isSecondSide = true;
            mateRow = row - 1; mateCol = col; mateDir = Dir.Bottom;
            break;
        case Dir.Right:
            normalizedPath = verticalPaths[row][col];
            isSecondSide = false;
            mateRow = row; mateCol = col + 1; mateDir = Dir.Left;
            break;
        case Dir.Left:
            normalizedPath = verticalPaths[row][col - 1];
            isSecondSide = true;
            mateRow = row; mateCol = col - 1; mateDir = Dir.Right;
            break;
    }

    let pathToTransform = normalizedPath;
    if (isSecondSide) {
        pathToTransform = reverseBezierPath(normalizedPath);
    }

    // Transform from normalized space to this edge's actual piece-local coordinates.
    const nStart = isSecondSide ? { x: 1, y: 0 } : { x: 0, y: 0 };
    const nEnd = isSecondSide ? { x: 0, y: 0 } : { x: 1, y: 0 };
    const transformed = transformBezierPath(pathToTransform, nStart, nEnd, start, end);

    const mateEdgeId = edgeIdMap[mateRow][mateCol][mateDir];
    const matePieceId = mateRow * cols + mateCol;

    return {
        path: bezierPathToSvg(transformed),
        mateEdgeId,
        matePieceId,
    };
}

// ---------------------------------------------------------------------------
// Geometry helpers (copied from composable-generator, will be deduplicated)
// ---------------------------------------------------------------------------

function getEdgeEndpointsFromCorners(
    dir: Dir,
    row: number,
    col: number,
    corners: import('./grid-cuts.js').GridCorner[][],
    toLocal: (worldPt: Point, pieceRow: number, pieceCol: number) => Point,
): { start: Point; end: Point } {
    // Map each edge direction to its two corner positions
    switch (dir) {
        case Dir.Top: return {
            start: toLocal(corners[row][col].position, row, col),
            end: toLocal(corners[row][col + 1].position, row, col),
        };
        case Dir.Right: return {
            start: toLocal(corners[row][col + 1].position, row, col),
            end: toLocal(corners[row + 1][col + 1].position, row, col),
        };
        case Dir.Bottom: return {
            start: toLocal(corners[row + 1][col + 1].position, row, col),
            end: toLocal(corners[row + 1][col].position, row, col),
        };
        case Dir.Left: return {
            start: toLocal(corners[row][col].position, row, col),
            end: toLocal(corners[row + 1][col].position, row, col),
        };
    }
}

function isBorderEdge(dir: Dir, row: number, col: number, rows: number, cols: number): boolean {
    switch (dir) {
        case Dir.Top: return row === 0;
        case Dir.Right: return col === cols - 1;
        case Dir.Bottom: return row === rows - 1;
        case Dir.Left: return col === 0;
    }
}

function transformBezierPath(
    path: BezierPath,
    fromStart: Point, fromEnd: Point,
    toStart: Point, toEnd: Point,
): BezierPath {
    const fdx = fromEnd.x - fromStart.x;
    const fdy = fromEnd.y - fromStart.y;
    const fLen = Math.sqrt(fdx * fdx + fdy * fdy);

    const tdx = toEnd.x - toStart.x;
    const tdy = toEnd.y - toStart.y;
    const tLen = Math.sqrt(tdx * tdx + tdy * tdy);

    if (fLen < 1e-10 || tLen < 1e-10) return path;

    const scale = tLen / fLen;
    const cosFrom = fdx / fLen;
    const sinFrom = fdy / fLen;
    const cosTo = tdx / tLen;
    const sinTo = tdy / tLen;
    const cosRot = cosFrom * cosTo + sinFrom * sinTo;
    const sinRot = sinFrom * cosTo - cosFrom * sinTo;

    return path.map(p => {
        const rx = p.x - fromStart.x;
        const ry = p.y - fromStart.y;
        const rotX = rx * cosRot - ry * sinRot;
        const rotY = rx * sinRot + ry * cosRot;

        return {
            x: toStart.x + rotX * scale,
            y: toStart.y + rotY * scale,
        };
    });
}

function bezierPathToSvg(path: BezierPath): string {
    if (path.length < 4) {
        const last = path[path.length - 1];
        return `L ${fmt(last.x)} ${fmt(last.y)}`;
    }

    const parts: string[] = [];
    for (let i = 1; i < path.length; i += 3) {
        const cp1 = path[i];
        const cp2 = path[i + 1];
        const end = path[i + 2];
        parts.push(
            `C ${fmt(cp1.x)} ${fmt(cp1.y)}, ${fmt(cp2.x)} ${fmt(cp2.y)}, ${fmt(end.x)} ${fmt(end.y)}`,
        );
    }

    return parts.join(' ');
}

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

function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
