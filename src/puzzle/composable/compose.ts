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
    const { cols, rows, pieceWidth, pieceHeight } = grid;

    // Step 1: Generate tab/blank assignment and shapes for all shared edges
    // Each shared edge gets one BezierPath, generated once from the "first side"
    const horizontalPaths: BezierPath[][] = []; // [row][col] between row and row+1
    const verticalPaths: BezierPath[][] = [];   // [row][col] between col and col+1
    const horizontalIsTab: boolean[][] = [];
    const verticalIsTab: boolean[][] = [];

    for (let row = 0; row < rows - 1; row++) {
        horizontalPaths[row] = [];
        horizontalIsTab[row] = [];
        for (let col = 0; col < cols; col++) {
            const isTab = random() > 0.5;
            horizontalIsTab[row][col] = isTab;

            // Generate in normalized space, mirror if blank
            let normalizedPath = template.generate(random);
            if (!isTab) {
                normalizedPath = mirrorBezierPathY(normalizedPath);
            }

            // Transform from normalized (0,0)→(1,0) to edge coordinates
            // Bottom edge of piece at (row, col): goes from (pieceWidth, pieceHeight) to (0, pieceHeight)
            const start: Point = { x: pieceWidth, y: pieceHeight };
            const end: Point = { x: 0, y: pieceHeight };
            horizontalPaths[row][col] = transformNormalizedPath(normalizedPath, start, end);
        }
    }

    for (let row = 0; row < rows; row++) {
        verticalPaths[row] = [];
        verticalIsTab[row] = [];
        for (let col = 0; col < cols - 1; col++) {
            const isTab = random() > 0.5;
            verticalIsTab[row][col] = isTab;

            let normalizedPath = template.generate(random);
            if (!isTab) {
                normalizedPath = mirrorBezierPathY(normalizedPath);
            }

            // Right edge of piece at (row, col): goes from (pieceWidth, 0) to (pieceWidth, pieceHeight)
            const start: Point = { x: pieceWidth, y: 0 };
            const end: Point = { x: pieceWidth, y: pieceHeight };
            verticalPaths[row][col] = transformNormalizedPath(normalizedPath, start, end);
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
                ));
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
function transformNormalizedPath(
    path: BezierPath,
    start: Point,
    end: Point,
): BezierPath {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // Perpendicular (90° counterclockwise)
    const px = -dy;
    const py = dx;

    return path.map(p => ({
        x: start.x + p.x * dx + p.y * px,
        y: start.y + p.x * dy + p.y * py,
    }));
}

// ---------------------------------------------------------------------------
// Edge building
// ---------------------------------------------------------------------------

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
): Edge {
    const { start, end } = getEdgeEndpoints(dir, pieceWidth, pieceHeight);
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
    pieceWidth: number,
    pieceHeight: number,
    edgeIdMap: number[][][],
    horizontalPaths: BezierPath[][],
    verticalPaths: BezierPath[][],
    start: Point,
    end: Point,
): { path: string; mateEdgeId: number; matePieceId: number } {
    let storedPath: BezierPath;
    let originalStart: Point;
    let originalEnd: Point;
    let isSecondSide: boolean;
    let mateRow: number;
    let mateCol: number;
    let mateDir: Dir;

    switch (dir) {
        case Dir.Bottom:
            storedPath = horizontalPaths[row][col];
            originalStart = { x: pieceWidth, y: pieceHeight };
            originalEnd = { x: 0, y: pieceHeight };
            isSecondSide = false;
            mateRow = row + 1; mateCol = col; mateDir = Dir.Top;
            break;
        case Dir.Top:
            storedPath = horizontalPaths[row - 1][col];
            originalStart = { x: pieceWidth, y: pieceHeight };
            originalEnd = { x: 0, y: pieceHeight };
            isSecondSide = true;
            mateRow = row - 1; mateCol = col; mateDir = Dir.Bottom;
            break;
        case Dir.Right:
            storedPath = verticalPaths[row][col];
            originalStart = { x: pieceWidth, y: 0 };
            originalEnd = { x: pieceWidth, y: pieceHeight };
            isSecondSide = false;
            mateRow = row; mateCol = col + 1; mateDir = Dir.Left;
            break;
        case Dir.Left:
            storedPath = verticalPaths[row][col - 1];
            originalStart = { x: pieceWidth, y: 0 };
            originalEnd = { x: pieceWidth, y: pieceHeight };
            isSecondSide = true;
            mateRow = row; mateCol = col - 1; mateDir = Dir.Right;
            break;
    }

    let pathToUse = storedPath;
    if (isSecondSide) {
        pathToUse = reverseBezierPath(storedPath);
        const temp = originalStart;
        originalStart = originalEnd;
        originalEnd = temp;
    }

    // Transform from storage coordinates to this piece's local coordinates
    const transformedPath = transformBezierPath(
        pathToUse, originalStart, originalEnd, start, end,
    );

    const mateEdgeId = edgeIdMap[mateRow][mateCol][mateDir];
    const matePieceId = mateRow * cols + mateCol;

    return {
        path: bezierPathToSvg(transformedPath),
        mateEdgeId,
        matePieceId,
    };
}

// ---------------------------------------------------------------------------
// Geometry helpers (copied from composable-generator, will be deduplicated)
// ---------------------------------------------------------------------------

function getEdgeEndpoints(dir: Dir, w: number, h: number): { start: Point; end: Point } {
    switch (dir) {
        case Dir.Top: return { start: { x: 0, y: 0 }, end: { x: w, y: 0 } };
        case Dir.Right: return { start: { x: w, y: 0 }, end: { x: w, y: h } };
        case Dir.Bottom: return { start: { x: w, y: h }, end: { x: 0, y: h } };
        case Dir.Left: return { start: { x: 0, y: h }, end: { x: 0, y: 0 } };
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
