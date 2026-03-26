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
import { Bezier } from 'bezier-js';

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

// ---------------------------------------------------------------------------
// Wavy grid generation
// ---------------------------------------------------------------------------

/**
 * Configuration for wavy grid cuts.
 *
 * Horizontal and vertical cuts can be configured independently.
 * Amplitude is the peak-to-trough distance as a fraction of piece size
 * (0 = straight, 0.5 = half a piece height/width).
 * Frequency is in Hz: 1 Hz = one full sine wave across the puzzle width/height.
 */
export interface WavyGridConfig {
    /** Horizontal cuts (rows): amplitude as fraction of piece height (0–0.5). Default: 0 */
    horizontalAmplitude?: number;
    /** Horizontal cuts (rows): frequency in Hz across puzzle width. Default: 0 */
    horizontalFrequency?: number;
    /** Vertical cuts (columns): amplitude as fraction of piece width (0–0.5). Default: 0 */
    verticalAmplitude?: number;
    /** Vertical cuts (columns): frequency in Hz across puzzle height. Default: 0 */
    verticalFrequency?: number;
}

/**
 * Generate a wavy grid definition.
 *
 * Each internal cut meanders gently perpendicular to its main direction.
 * Border cuts (top, bottom, left, right edges) remain straight.
 * Corners are computed via Bézier curve-curve intersection.
 *
 * @param cols - Number of piece columns
 * @param rows - Number of piece rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param random - Seeded PRNG
 * @param config - Waviness configuration
 * @returns Complete grid definition with wavy internal cuts
 */
export function generateWavyGrid(
    cols: number,
    rows: number,
    imageSize: Size,
    random: () => number,
    config?: WavyGridConfig,
): GridDefinition {
    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    const hAmp = config?.horizontalAmplitude ?? 0;
    const hFreq = config?.horizontalFrequency ?? 0;
    const vAmp = config?.verticalAmplitude ?? 0;
    const vFreq = config?.verticalFrequency ?? 0;

    // Horizontal amplitude in pixels: fraction of piece height / 2
    // (amplitude is peak-to-trough, we need half for the sine displacement)
    const hPixelAmp = (hAmp * pieceHeight) / 2;
    const vPixelAmp = (vAmp * pieceWidth) / 2;

    // Random phase offset per cut so they don't all look identical
    const rowPhases: number[] = [];
    for (let r = 0; r <= rows; r++) {
        rowPhases.push(random() * Math.PI * 2);
    }
    const colPhases: number[] = [];
    for (let c = 0; c <= cols; c++) {
        colPhases.push(random() * Math.PI * 2);
    }

    // Generate row cuts (horizontal). Borders are straight.
    const rowCuts: CutLine[] = [];
    for (let r = 0; r <= rows; r++) {
        const y = r * pieceHeight;
        if (r === 0 || r === rows || hAmp === 0 || hFreq === 0) {
            rowCuts.push({
                points: [{ x: 0, y }, { x: imageSize.width, y }],
            });
        } else {
            rowCuts.push({
                points: generateSineCut(
                    { x: 0, y },
                    { x: imageSize.width, y },
                    hPixelAmp,
                    hFreq,
                    rowPhases[r],
                ),
            });
        }
    }

    // Generate column cuts (vertical). Borders are straight.
    const colCuts: CutLine[] = [];
    for (let c = 0; c <= cols; c++) {
        const x = c * pieceWidth;
        if (c === 0 || c === cols || vAmp === 0 || vFreq === 0) {
            colCuts.push({
                points: [{ x, y: 0 }, { x, y: imageSize.height }],
            });
        } else {
            colCuts.push({
                points: generateSineCut(
                    { x, y: 0 },
                    { x, y: imageSize.height },
                    vPixelAmp,
                    vFreq,
                    colPhases[c],
                ),
            });
        }
    }

    // Compute corners via curve-curve intersection
    const corners: GridCorner[][] = [];
    for (let r = 0; r <= rows; r++) {
        corners[r] = [];
        for (let c = 0; c <= cols; c++) {
            const position = findCutIntersection(
                rowCuts[r], colCuts[c],
                { x: c * pieceWidth, y: r * pieceHeight },
            );
            corners[r][c] = { position, rowIndex: r, colIndex: c };
        }
    }

    // Build edge map (same logic as straight grid)
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

// ---------------------------------------------------------------------------
// Wavy cut helpers
// ---------------------------------------------------------------------------

/**
 * Generate a sine-wave cut line.
 *
 * The cut goes from start to end with a sinusoidal displacement
 * perpendicular to the main direction.
 *
 * @param start - Start point of the cut
 * @param end - End point of the cut
 * @param amplitude - Half the peak-to-trough displacement in pixels
 * @param frequency - Number of full waves across the puzzle (Hz)
 * @param phase - Phase offset in radians (for variety between cuts)
 * @returns Array of points forming a polyline approximation of the sine curve
 */
function generateSineCut(
    start: Point,
    end: Point,
    amplitude: number,
    frequency: number,
    phase: number,
): Point[] {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular unit vector
    const px = -dy / len;
    const py = dx / len;

    // Sample enough points for smooth rendering
    // At least 8 points per wave cycle, minimum 20 total
    const numPoints = Math.max(20, Math.ceil(frequency * 16));
    const points: Point[] = [];

    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        // Sine displacement: frequency is relative to the full cut length
        const offset = amplitude * Math.sin(2 * Math.PI * frequency * t + phase);
        points.push({
            x: start.x + t * dx + offset * px,
            y: start.y + t * dy + offset * py,
        });
    }

    return points;
}

/**
 * Find the intersection point of two cut lines.
 *
 * For straight lines (2 points each), uses simple line-line intersection.
 * For curved lines (Bézier paths), uses bezier-js curve intersection.
 *
 * @param rowCut - The horizontal cut line
 * @param colCut - The vertical cut line
 * @param hint - Approximate expected position (for disambiguation)
 */
function findCutIntersection(
    rowCut: CutLine,
    colCut: CutLine,
    hint: Point,
): Point {
    const rPts = rowCut.points;
    const cPts = colCut.points;

    // Simple case: both are straight lines (2 points each)
    if (rPts.length === 2 && cPts.length === 2) {
        return lineLineIntersection(rPts[0], rPts[1], cPts[0], cPts[1]) ?? hint;
    }

    // Curved case: use bezier-js
    // Convert point arrays to Bezier curves and find intersections
    const rowBeziers = pointsToBeziers(rPts);
    const colBeziers = pointsToBeziers(cPts);

    let bestPoint = hint;
    let bestDist = Infinity;

    for (const rb of rowBeziers) {
        for (const cb of colBeziers) {
            const pairs = rb.intersects(cb);
            for (const pair of pairs) {
                const [tStr] = (pair as string).split('/');
                const t = parseFloat(tStr);
                const pt = rb.get(t);
                const d = dist(pt, hint);
                if (d < bestDist) {
                    bestDist = d;
                    bestPoint = { x: pt.x, y: pt.y };
                }
            }
        }
    }

    return bestPoint;
}

/**
 * Convert a point array to an array of cubic Bézier curves.
 *
 * The points are in BezierPath format:
 * [p0, cp1, cp2, p1, cp1, cp2, p2, ...]
 *
 * If the path has only 2 points (straight line), creates a
 * degenerate cubic Bézier.
 */
function pointsToBeziers(points: Point[]): any[] {
    if (points.length === 2) {
        // Straight line: degenerate cubic
        const [a, b] = points;
        return [new Bezier(
            a.x, a.y,
            a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3,
            a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3,
            b.x, b.y,
        )];
    }

    const beziers: any[] = [];
    for (let i = 0; i < points.length - 1; i += 3) {
        if (i + 3 < points.length) {
            const p0 = points[i];
            const cp1 = points[i + 1];
            const cp2 = points[i + 2];
            const p1 = points[i + 3];
            beziers.push(new Bezier(
                p0.x, p0.y, cp1.x, cp1.y, cp2.x, cp2.y, p1.x, p1.y,
            ));
        }
    }

    return beziers;
}

function lineLineIntersection(
    a1: Point, a2: Point, b1: Point, b2: Point,
): Point | null {
    const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
    if (Math.abs(d) < 1e-10) return null;

    const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;

    return {
        x: a1.x + t * (a2.x - a1.x),
        y: a1.y + t * (a2.y - a1.y),
    };
}

function dist(a: { x: number; y: number }, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Grid → PieceDefinition conversion
// ---------------------------------------------------------------------------

import type { PieceDefinition, EdgeDefinition } from './types.js';

/**
 * Convert a GridDefinition to an array of PieceDefinitions.
 *
 * This resolves all grid-specific concepts (rows, columns, directions)
 * into abstract edges with mate relationships. The composition layer
 * can then work purely with edges — no grid knowledge needed.
 *
 * Edge IDs are assigned in a deterministic order. Shared edges get
 * paired IDs (first side, second side) and a shared key for tab storage.
 */
export function gridToPieceDefinitions(grid: GridDefinition): PieceDefinition[] {
    const { cols, rows, corners } = grid;

    // Assign edge IDs. Shared edges get two IDs (one per side).
    let nextEdgeId = 0;

    // Store edge ID assignments: edgeIds[row][col] = [top, right, bottom, left]
    const edgeIds: number[][][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => [-1, -1, -1, -1]),
    );

    // Shared keys: sharedKeys[row][col] = [top, right, bottom, left]
    const sharedKeys: (string | undefined)[][][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => [undefined, undefined, undefined, undefined] as (string | undefined)[]),
    );

    // Horizontal shared edges (between row and row+1)
    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols; c++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            const key = `h_${r}_${c}`;
            edgeIds[r][c][2] = id1;     // bottom of upper piece (first side)
            edgeIds[r + 1][c][0] = id2; // top of lower piece (second side)
            sharedKeys[r][c][2] = key;
            sharedKeys[r + 1][c][0] = key;
        }
    }

    // Vertical shared edges (between col and col+1)
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            const key = `v_${r}_${c}`;
            edgeIds[r][c][1] = id1;     // right of left piece (first side)
            edgeIds[r][c + 1][3] = id2; // left of right piece (second side)
            sharedKeys[r][c][1] = key;
            sharedKeys[r][c + 1][3] = key;
        }
    }

    // Border edges
    for (let c = 0; c < cols; c++) {
        edgeIds[0][c][0] = nextEdgeId++;         // top border
        edgeIds[rows - 1][c][2] = nextEdgeId++;  // bottom border
    }
    for (let r = 0; r < rows; r++) {
        edgeIds[r][0][3] = nextEdgeId++;         // left border
        edgeIds[r][cols - 1][1] = nextEdgeId++;  // right border
    }

    /**
     * Extract the polyline segment from a CutLine between two world-space
     * corner positions, converted to piece-local coordinates.
     * If the cut is a straight line (2 points), returns undefined (straight edge).
     */
    function extractCurveSegment(
        cut: CutLine,
        fromWorld: Point,
        toWorld: Point,
        origin: Point,
    ): Point[] | undefined {
        if (cut.points.length <= 2) return undefined;

        // Find the closest point indices to the from/to corners
        const fromIdx = findClosestPointIndex(cut.points, fromWorld);
        const toIdx = findClosestPointIndex(cut.points, toWorld);

        if (fromIdx === toIdx) return undefined;

        // Extract the segment (may be forward or reversed)
        const localPoints: Point[] = [];
        if (fromIdx < toIdx) {
            for (let i = fromIdx; i <= toIdx; i++) {
                localPoints.push({
                    x: cut.points[i].x - origin.x,
                    y: cut.points[i].y - origin.y,
                });
            }
        } else {
            for (let i = fromIdx; i >= toIdx; i--) {
                localPoints.push({
                    x: cut.points[i].x - origin.x,
                    y: cut.points[i].y - origin.y,
                });
            }
        }

        return localPoints.length > 2 ? localPoints : undefined;
    }

    function findClosestPointIndex(points: Point[], target: Point): number {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const dx = points[i].x - target.x;
            const dy = points[i].y - target.y;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    // Build PieceDefinitions
    const pieces: PieceDefinition[] = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const origin = corners[r][c].position;
            const toLocal = (p: Point): Point => ({
                x: p.x - origin.x,
                y: p.y - origin.y,
            });

            // Corner positions for this piece (clockwise: TL, TR, BR, BL)
            const tl = toLocal(corners[r][c].position);
            const tr = toLocal(corners[r][c + 1].position);
            const br = toLocal(corners[r + 1][c + 1].position);
            const bl = toLocal(corners[r + 1][c].position);

            // Directions: 0=top, 1=right, 2=bottom, 3=left
            // Edge endpoints (clockwise) + world-space corners + which cut line
            const edgeEndpoints: [Point, Point][] = [
                [tl, tr],  // top: TL → TR
                [tr, br],  // right: TR → BR
                [br, bl],  // bottom: BR → BL
                [bl, tl],  // left: BL → TL
            ];

            // World-space corner pairs and cut lines for curve extraction.
            // The from→to direction must match the edge direction (clockwise).
            const edgeCurveInfo: [Point, Point, CutLine][] = [
                [corners[r][c].position, corners[r][c + 1].position, grid.rowCuts[r]],          // top: left → right
                [corners[r][c + 1].position, corners[r + 1][c + 1].position, grid.colCuts[c + 1]], // right: top → bottom
                [corners[r + 1][c + 1].position, corners[r + 1][c].position, grid.rowCuts[r + 1]], // bottom: right → left
                [corners[r + 1][c].position, corners[r][c].position, grid.colCuts[c]],           // left: bottom → top
            ];

            // Mate info
            const matePositions: [number, number, number][] = [
                // [mateRow, mateCol, mateDir]
                [r - 1, c, 2],   // top's mate is bottom of piece above
                [r, c + 1, 3],   // right's mate is left of piece to right
                [r + 1, c, 0],   // bottom's mate is top of piece below
                [r, c - 1, 1],   // left's mate is right of piece to left
            ];

            const isBorder = [r === 0, c === cols - 1, r === rows - 1, c === 0];

            // "First side" convention: bottom and right edges are first side
            const isFirstSide = [false, true, true, false];

            const edges: EdgeDefinition[] = [];
            for (let d = 0; d < 4; d++) {
                const [start, end] = edgeEndpoints[d];
                const border = isBorder[d];
                const [fromWorld, toWorld, cutLine] = edgeCurveInfo[d];
                const curvePoints = extractCurveSegment(cutLine, fromWorld, toWorld, origin);

                if (border) {
                    edges.push({
                        id: edgeIds[r][c][d],
                        start,
                        end,
                        mateEdgeId: -1,
                        matePieceId: -1,
                        curvePoints,
                    });
                } else {
                    const [mr, mc, md] = matePositions[d];
                    edges.push({
                        id: edgeIds[r][c][d],
                        start,
                        end,
                        mateEdgeId: edgeIds[mr][mc][md],
                        matePieceId: mr * cols + mc,
                        sharedEdgeKey: sharedKeys[r][c][d],
                        isFirstSide: isFirstSide[d],
                        curvePoints,
                    });
                }
            }

            pieces.push({
                id: r * cols + c,
                edges,
                imageOffset: { x: -origin.x, y: -origin.y },
            });
        }
    }

    return pieces;
}
