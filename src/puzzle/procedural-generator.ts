/**
 * Procedural puzzle generator.
 *
 * Produces a grid of pieces with varied, natural-looking cuts that
 * resemble real die-cut jigsaw puzzle pieces. Each game has unique
 * cut patterns thanks to a seeded PRNG that randomises:
 *   - Tab/blank assignment per edge
 *   - Tab shape: mushroom/knob heads with narrow necks
 *   - Tab head profile: round, square-ish, or heart-shaped
 *   - Tab size, position along edge, and asymmetry
 *   - Edge line wobble: subtle waviness in "straight" segments
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
export const Dir = {
    Top: 0,
    Right: 1,
    Bottom: 2,
    Left: 3,
} as const;

type Dir = (typeof Dir)[keyof typeof Dir];

/**
 * Parameters controlling the shape of a single tab/blank.
 * Generated per shared internal edge by the PRNG.
 *
 * The shape model is based on real die-cut puzzle pieces:
 * - A narrow neck connects the tab head to the piece body
 * - The tab head is wider than the neck (mushroom/knob shape)
 * - The head profile varies: round, square-ish, or heart-shaped
 * - "Straight" edge segments have subtle wobble
 */
export interface TabParams {
    /** Whether the "first" side of the shared edge gets a tab (true) or blank (false). */
    isTab: boolean;
    /** Total bump height as a fraction of edge length. Range: [0.22, 0.36]. */
    heightFraction: number;
    /** Neck width as a fraction of edge length (narrower than head). Range: [0.04, 0.09]. */
    neckFraction: number;
    /** Tab head width as a fraction of edge length (wider than neck). Range: [0.18, 0.30]. */
    headWidthFraction: number;
    /** Tab centre offset along the edge, 0 = dead centre. Range: [-0.05, 0.05]. */
    centreOffset: number;
    /** Asymmetry: slight left/right skew of the tab head. Range: [-0.03, 0.03]. */
    skew: number;
    /** Head profile shape: 0 = round, 0.5 = square-ish, 1 = heart-shaped. */
    headProfile: number;
    /** Neck curvature: how much the neck pinches inward. Range: [0.3, 0.8]. */
    neckPinch: number;
    /** Edge wobble amplitude as a fraction of edge length. Range: [0.003, 0.012]. */
    wobbleAmplitude: number;
    /** Edge wobble phase offset. Range: [0, 2π]. */
    wobblePhase: number;
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
 *
 * The ranges are tuned to produce shapes resembling real die-cut
 * puzzle pieces: bulbous heads, narrow necks, and subtle edge wobble.
 */
export function randomTabParams(random: () => number): TabParams {
    return {
        isTab: random() < 0.5,
        heightFraction: lerp(0.22, 0.36, random()),
        neckFraction: lerp(0.04, 0.09, random()),
        headWidthFraction: lerp(0.18, 0.30, random()),
        centreOffset: lerp(-0.05, 0.05, random()),
        skew: lerp(-0.03, 0.03, random()),
        headProfile: random(),
        neckPinch: lerp(0.3, 0.8, random()),
        wobbleAmplitude: lerp(0.003, 0.012, random()),
        wobblePhase: lerp(0, Math.PI * 2, random()),
    };
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Straight line path segment (for border edges). */
function buildFlatEdgePath(end: Point): string {
    return `L ${fmt(end.x)} ${fmt(end.y)}`;
}

/**
 * Build a wobbly "straight" line for the portions of an edge before
 * and after the tab/blank. Real puzzle dies don't cut perfectly
 * straight lines — there's subtle waviness.
 *
 * Uses a single quadratic Bézier with a small perpendicular offset
 * to create a subtle curve instead of a hard straight line.
 */
export function buildWobbleLine(
    from: Point,
    to: Point,
    nx: number,
    ny: number,
    amplitude: number,
    phase: number,
): string {
    // If the segment is too short, just use a straight line
    const segDx = to.x - from.x;
    const segDy = to.y - from.y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);

    if (segLen < 1) {
        return `L ${fmt(to.x)} ${fmt(to.y)}`;
    }

    // Single control point at midpoint, offset perpendicular by wobble
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const wobble = Math.sin(phase) * amplitude;
    const cpX = midX + nx * wobble;
    const cpY = midY + ny * wobble;

    return `Q ${fmt(cpX)} ${fmt(cpY)}, ${fmt(to.x)} ${fmt(to.y)}`;
}

/**
 * Build a realistic Bézier curve path for an interlocking edge.
 *
 * The shape is modelled after real die-cut jigsaw pieces:
 *
 * 1. A narrow **neck** connects the tab to the piece body, with a
 *    slight inward pinch (the piece body curves inward before the
 *    neck starts).
 *
 * 2. The **tab head** is wider than the neck, creating a mushroom/
 *    knob shape. The head widens progressively from the neck.
 *
 * 3. The head **profile** varies between round (smooth dome),
 *    square-ish (flatter top with rounded corners), and heart-shaped
 *    (slight dip at the centre of the head).
 *
 * 4. The "straight" segments before and after the tab have subtle
 *    **wobble** to simulate imperfect die cuts.
 *
 * The path is constructed as:
 *   wobbleLine → neck entry (cubic) → head left (cubic) →
 *   head right (cubic) → neck exit (cubic) → wobbleLine
 */
export function buildProceduralEdgePath(
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
    const nx = -uy; // normal (perpendicular)
    const ny = ux;

    const sign = isTab ? 1 : -1;

    const bumpHeight = edgeLength * params.heightFraction;
    const neckHalfWidth = (edgeLength * params.neckFraction) / 2;
    const headHalfWidth = (edgeLength * params.headWidthFraction) / 2;
    const wobbleAmp = edgeLength * params.wobbleAmplitude;

    // Tab centre position (0.5 = dead centre, offset shifts it)
    const tCentre = 0.5 + params.centreOffset;
    const neckSpan = 0.08; // half the span of the neck along the edge

    // t-values for key points along the edge
    const tNeckStart = tCentre - neckSpan;
    const tNeckEnd = tCentre + neckSpan;

    // Points on the edge line where the neck begins/ends
    const neckStart = addVec(start, scaleVec(ux, uy, edgeLength * tNeckStart));
    const neckEnd = addVec(start, scaleVec(ux, uy, edgeLength * tNeckEnd));
    const centre = addVec(start, scaleVec(ux, uy, edgeLength * tCentre));

    // Neck height is about 35-45% of total bump height (controlled by neckPinch)
    const neckHeight = bumpHeight * lerp(0.35, 0.45, params.neckPinch);

    // --- Neck entry: piece body pinches inward slightly, then neck rises ---
    const pinchInward = neckHalfWidth * params.neckPinch * 0.5;
    const pinchPoint = addVec(neckStart, scaleVec(nx, ny, -sign * pinchInward));

    // Top of the neck (where it meets the head underside)
    const skewAlongEdge = params.skew * edgeLength;
    const neckTopLeft = addVec(
        addVec(neckStart, scaleVec(nx, ny, sign * neckHeight)),
        scaleVec(ux, uy, skewAlongEdge * 0.3),
    );
    const neckTopRight = addVec(
        addVec(neckEnd, scaleVec(nx, ny, sign * neckHeight)),
        scaleVec(ux, uy, skewAlongEdge * 0.3),
    );

    // --- Head shape: the mushroom cap ---
    const headTop = addVec(
        addVec(centre, scaleVec(nx, ny, sign * bumpHeight)),
        scaleVec(ux, uy, skewAlongEdge),
    );

    // Head profile: 0 = round, 0.5 = square-ish, 1 = heart-shaped
    // This controls the flatness of the control points at the top of the head
    const flatness = params.headProfile < 0.5
        ? params.headProfile * 2 // 0→1 for round→square
        : 1.0 - (params.headProfile - 0.5) * 2; // 1→0 for square→heart

    // Heart-shaped heads: the top centre dips down slightly
    const heartDip = params.headProfile > 0.5
        ? (params.headProfile - 0.5) * 2 * bumpHeight * 0.15
        : 0;
    const headCentre = addVec(headTop, scaleVec(nx, ny, -sign * heartDip));

    // Left side of head: from neck top left → widening → head peak
    // CP1: controls how the neck widens into the head (pull outward from neck)
    const headLeftCP1 = addVec(
        neckTopLeft,
        scaleVec(nx, ny, sign * (bumpHeight - neckHeight) * 0.7),
    );
    // CP2: controls the curvature at the head peak (flatter = more square)
    const headLeftCP2 = addVec(
        addVec(headCentre, scaleVec(ux, uy, -headHalfWidth * lerp(0.6, 0.2, flatness))),
        scaleVec(nx, ny, sign * bumpHeight * 0.02),
    );

    // Right side of head: from head peak → narrowing → neck top right
    const headRightCP1 = addVec(
        addVec(headCentre, scaleVec(ux, uy, headHalfWidth * lerp(0.6, 0.2, flatness))),
        scaleVec(nx, ny, sign * bumpHeight * 0.02),
    );
    const headRightCP2 = addVec(
        neckTopRight,
        scaleVec(nx, ny, sign * (bumpHeight - neckHeight) * 0.7),
    );

    // Neck exit pinch (mirror of entry)
    const pinchPointExit = addVec(neckEnd, scaleVec(nx, ny, -sign * pinchInward));

    void dir; // dir already encoded in sign via isTab

    // Wobble for "straight" segments before and after the tab
    const wobbleBefore = buildWobbleLine(
        start, neckStart, nx, ny, wobbleAmp, params.wobblePhase,
    );
    const wobbleAfter = buildWobbleLine(
        neckEnd, end, nx, ny, wobbleAmp, params.wobblePhase + 2.3,
    );

    return [
        // Wobbly line from edge start to neck start
        wobbleBefore,
        // Neck entry: pinch inward, then rise up the neck
        `C ${fmt(pinchPoint.x)} ${fmt(pinchPoint.y)}, ${fmt(neckTopLeft.x)} ${fmt(neckTopLeft.y)}, ${fmt(neckTopLeft.x)} ${fmt(neckTopLeft.y)}`,
        // Head left side: neck top → widening → head peak
        `C ${fmt(headLeftCP1.x)} ${fmt(headLeftCP1.y)}, ${fmt(headLeftCP2.x)} ${fmt(headLeftCP2.y)}, ${fmt(headCentre.x)} ${fmt(headCentre.y)}`,
        // Head right side: head peak → narrowing → neck top
        `C ${fmt(headRightCP1.x)} ${fmt(headRightCP1.y)}, ${fmt(headRightCP2.x)} ${fmt(headRightCP2.y)}, ${fmt(neckTopRight.x)} ${fmt(neckTopRight.y)}`,
        // Neck exit: descend neck, pinch outward
        `C ${fmt(neckTopRight.x)} ${fmt(neckTopRight.y)}, ${fmt(pinchPointExit.x)} ${fmt(pinchPointExit.y)}, ${fmt(neckEnd.x)} ${fmt(neckEnd.y)}`,
        // Wobbly line from neck end to edge end
        wobbleAfter,
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
