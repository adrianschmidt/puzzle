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
        const tabParams = getTabParams(dir, row, col, horizontalParams, verticalParams);
        const isTab = getIsTab(dir, row, col, tabParams);
        path = buildProceduralEdgePath(start, end, dir, isTab, tabParams);
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

/**
 * Get the TabParams for a given edge direction and grid position.
 */
function getTabParams(
    dir: Dir,
    row: number,
    col: number,
    horizontalParams: TabParams[][],
    verticalParams: TabParams[][],
): TabParams {
    switch (dir) {
        case Dir.Top:
            return horizontalParams[row - 1][col];
        case Dir.Bottom:
            return horizontalParams[row][col];
        case Dir.Left:
            return verticalParams[row][col - 1];
        case Dir.Right:
            return verticalParams[row][col];
    }
}

/**
 * Determine if this side of the edge gets a tab or blank.
 * The "first" side (bottom of upper piece, right of left piece) uses isTab directly.
 * The "second" side (top of lower piece, left of right piece) inverts it.
 */
function getIsTab(
    dir: Dir,
    row: number,
    col: number,
    params: TabParams,
): boolean {
    void row;
    void col;

    switch (dir) {
        case Dir.Bottom:
        case Dir.Right:
            // "first" side — use isTab as-is
            return params.isTab;
        case Dir.Top:
        case Dir.Left:
            // "second" side — invert
            return !params.isTab;
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

/**
 * Build a varied Bézier curve path for an interlocking edge.
 *
 * Uses the TabParams to create unique-looking tabs/blanks that differ
 * in height, width, neck shape, position along the edge, and asymmetry.
 */
function buildProceduralEdgePath(
    start: Point,
    end: Point,
    dir: Dir,
    isTab: boolean,
    params: TabParams,
): string {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    // Unit vectors along and perpendicular to the edge
    const ux = dx / edgeLength;
    const uy = dy / edgeLength;
    const nx = -uy; // normal
    const ny = ux;

    const sign = isTab ? 1 : -1;

    const bumpHeight = edgeLength * params.heightFraction;
    const neckWidth = edgeLength * params.neckFraction;
    const headWidth = edgeLength * params.headWidthFraction;

    // Tab centre position (0.5 = dead centre, offset shifts it)
    const tCentre = 0.5 + params.centreOffset;
    const halfSpan = 0.15; // half the span of the tab along the edge

    const t1 = tCentre - halfSpan; // start of neck
    const t2 = tCentre; // centre of bump
    const t3 = tCentre + halfSpan; // end of neck

    // Points along the edge
    const p1 = addVec(start, scaleVec(ux, uy, edgeLength * t1));
    const p2 = addVec(start, scaleVec(ux, uy, edgeLength * t2));
    const p3 = addVec(start, scaleVec(ux, uy, edgeLength * t3));

    // Neck entry — slight inward curve to the neck
    const neck1 = addVec(p1, scaleVec(nx, ny, sign * neckWidth * 0.4));
    // Neck exit
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

    void dir; // dir already encoded in sign via isTab

    return [
        `L ${fmt(p1.x)} ${fmt(p1.y)}`,
        `C ${fmt(neck1.x)} ${fmt(neck1.y)}, ${fmt(peak1.x)} ${fmt(peak1.y)}, ${fmt(peakCentre.x)} ${fmt(peakCentre.y)}`,
        `C ${fmt(peak2.x)} ${fmt(peak2.y)}, ${fmt(neck2.x)} ${fmt(neck2.y)}, ${fmt(p3.x)} ${fmt(p3.y)}`,
        `L ${fmt(end.x)} ${fmt(end.y)}`,
    ].join(' ');
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
