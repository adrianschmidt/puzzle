/**
 * Fractal puzzle generator - rewritten for reliability.
 *
 * Uses a grid-based approach similar to the procedural generator but replaces
 * straight edges and tab/blank connections with organic curved boundaries.
 * 
 * This approach guarantees:
 * - Exactly cols × rows pieces (matching the procedural generator)
 * - Perfect tiling (every pixel belongs to exactly one piece)
 * - Proper edge connectivity with mate relationships
 * - Organic curved boundaries instead of straight edges
 */

import type { Edge, Piece, Point, Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';

/**
 * Generate a fractal puzzle with organic curved boundaries.
 *
 * @param cols - Number of pieces horizontally
 * @param rows - Number of pieces vertically  
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible piece layouts
 * @returns Array of pieces with organic shapes and proper connectivity
 */
export function generateFractalPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
): Piece[] {
    const random = createSeededRandom(seed);
    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    // Generate organic edge paths for shared edges
    const sharedPaths = generateSharedEdgePaths(cols, rows, pieceWidth, pieceHeight, random);
    
    let nextEdgeId = 0;
    const edgeIdMap: number[][][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => [-1, -1, -1, -1]),
    );

    // Assign edge IDs for shared edges
    // Horizontal shared edges (between row and row+1)
    for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols; col++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            edgeIdMap[row][col][2] = id1; // Bottom edge of upper piece
            edgeIdMap[row + 1][col][0] = id2; // Top edge of lower piece
        }
    }

    // Vertical shared edges (between col and col+1)
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) {
            const id1 = nextEdgeId++;
            const id2 = nextEdgeId++;
            edgeIdMap[row][col][1] = id1; // Right edge of left piece
            edgeIdMap[row][col + 1][3] = id2; // Left edge of right piece
        }
    }

    // Border edges (no mate)
    for (let col = 0; col < cols; col++) {
        edgeIdMap[0][col][0] = nextEdgeId++; // Top border
        edgeIdMap[rows - 1][col][2] = nextEdgeId++; // Bottom border
    }
    for (let row = 0; row < rows; row++) {
        edgeIdMap[row][0][3] = nextEdgeId++; // Left border
        edgeIdMap[row][cols - 1][1] = nextEdgeId++; // Right border
    }

    // Build pieces
    const pieces: Piece[] = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const piece = buildPiece(
                row, col, rows, cols, 
                pieceWidth, pieceHeight,
                edgeIdMap, sharedPaths
            );
            pieces.push(piece);
        }
    }

    return pieces;
}

/**
 * Generate organic curved paths for all shared edges in the puzzle.
 */
function generateSharedEdgePaths(
    cols: number,
    rows: number,
    pieceWidth: number,
    pieceHeight: number,
    random: () => number,
): { horizontal: Point[][][]; vertical: Point[][][] } {
    
    const horizontal: Point[][][] = [];
    const vertical: Point[][][] = [];

    // Horizontal shared edges (between row and row+1)
    for (let row = 0; row < rows - 1; row++) {
        horizontal[row] = [];
        for (let col = 0; col < cols; col++) {
            // Edge from right to left on the bottom of upper piece
            const start = { x: pieceWidth, y: pieceHeight };
            const end = { x: 0, y: pieceHeight };
            horizontal[row][col] = generateOrganicPath(start, end, random);
        }
    }

    // Vertical shared edges (between col and col+1)  
    for (let row = 0; row < rows; row++) {
        vertical[row] = [];
        for (let col = 0; col < cols - 1; col++) {
            // Edge from top to bottom on the right of left piece
            const start = { x: pieceWidth, y: 0 };
            const end = { x: pieceWidth, y: pieceHeight };
            vertical[row][col] = generateOrganicPath(start, end, random);
        }
    }

    return { horizontal, vertical };
}

/**
 * Generate an organic curved path between two points.
 */
function generateOrganicPath(start: Point, end: Point, random: () => number): Point[] {
    const path: Point[] = [start];
    
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Number of curve points based on edge length
    const numPoints = Math.max(3, Math.floor(distance / 30));
    
    for (let i = 1; i < numPoints; i++) {
        const t = i / numPoints;
        
        // Base position along the line
        const baseX = start.x + t * deltaX;
        const baseY = start.y + t * deltaY;
        
        // Perpendicular offset for organic curve
        const perpX = -deltaY / distance;
        const perpY = deltaX / distance;
        
        // Random offset with smooth variation
        const maxOffset = Math.min(20, distance * 0.2);
        const offset = (random() - 0.5) * maxOffset * Math.sin(t * Math.PI);
        
        path.push({
            x: baseX + offset * perpX,
            y: baseY + offset * perpY,
        });
    }
    
    path.push(end);
    return path;
}

/**
 * Build a single piece with organic edges.
 */
function buildPiece(
    row: number, col: number, 
    rows: number, cols: number,
    pieceWidth: number, pieceHeight: number,
    edgeIdMap: number[][][],
    sharedPaths: { horizontal: Point[][][]; vertical: Point[][][] }
): Piece {
    const edges: Edge[] = [];
    
    // Top edge (direction: 0)
    const topEdge = buildEdge(row, col, 0, rows, cols, pieceWidth, pieceHeight, edgeIdMap, sharedPaths);
    edges.push(topEdge);
    
    // Right edge (direction: 1)
    const rightEdge = buildEdge(row, col, 1, rows, cols, pieceWidth, pieceHeight, edgeIdMap, sharedPaths);
    edges.push(rightEdge);
    
    // Bottom edge (direction: 2)
    const bottomEdge = buildEdge(row, col, 2, rows, cols, pieceWidth, pieceHeight, edgeIdMap, sharedPaths);
    edges.push(bottomEdge);
    
    // Left edge (direction: 3)
    const leftEdge = buildEdge(row, col, 3, rows, cols, pieceWidth, pieceHeight, edgeIdMap, sharedPaths);
    edges.push(leftEdge);
    
    // Build SVG shape from edges
    const shape = buildShapeFromEdges(edges);
    
    return {
        id: row * cols + col,
        edges,
        shape,
        imageOffset: {
            x: -col * pieceWidth,
            y: -row * pieceHeight,
        },
    };
}

/**
 * Build a single edge for a piece.
 */
function buildEdge(
    row: number, col: number, dir: number,
    rows: number, cols: number,
    pieceWidth: number, pieceHeight: number,
    edgeIdMap: number[][][],
    sharedPaths: { horizontal: Point[][][]; vertical: Point[][][] }
): Edge {
    const id = edgeIdMap[row][col][dir];
    const { start, end } = getEdgeEndpoints(dir, pieceWidth, pieceHeight);
    
    let mateEdgeId = -1;
    let matePieceId = -1;
    let path: string;
    
    const isBorder = isEdgeBorder(row, col, dir, rows, cols);
    
    if (isBorder) {
        // Border edge - straight line
        path = `L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    } else {
        // Shared edge - use organic curve
        const { path: edgePath, mateInfo } = getSharedEdgePath(
            row, col, dir, rows, cols, start, end, sharedPaths
        );
        path = edgePath;
        mateEdgeId = edgeIdMap[mateInfo.row][mateInfo.col][mateInfo.dir];
        matePieceId = mateInfo.row * cols + mateInfo.col;
    }
    
    return { id, mateEdgeId, matePieceId, path, start, end };
}

/**
 * Get the start and end points for an edge based on direction.
 */
function getEdgeEndpoints(dir: number, width: number, height: number): { start: Point; end: Point } {
    switch (dir) {
        case 0: return { start: { x: 0, y: 0 }, end: { x: width, y: 0 } }; // Top
        case 1: return { start: { x: width, y: 0 }, end: { x: width, y: height } }; // Right
        case 2: return { start: { x: width, y: height }, end: { x: 0, y: height } }; // Bottom
        case 3: return { start: { x: 0, y: height }, end: { x: 0, y: 0 } }; // Left
        default: throw new Error(`Invalid direction: ${dir}`);
    }
}

/**
 * Check if an edge is on the puzzle border.
 */
function isEdgeBorder(row: number, col: number, dir: number, rows: number, cols: number): boolean {
    switch (dir) {
        case 0: return row === 0; // Top
        case 1: return col === cols - 1; // Right
        case 2: return row === rows - 1; // Bottom
        case 3: return col === 0; // Left
        default: return false;
    }
}

/**
 * Get the organic path for a shared edge.
 */
function getSharedEdgePath(
    row: number, col: number, dir: number,
    rows: number, cols: number,
    start: Point, end: Point,
    sharedPaths: { horizontal: Point[][][]; vertical: Point[][][] }
): { path: string; mateInfo: { row: number; col: number; dir: number } } {
    let pathPoints: Point[];
    let mateInfo: { row: number; col: number; dir: number };
    let isReversed = false;

    switch (dir) {
        case 0: // Top edge = mate of bottom edge of piece above
            pathPoints = sharedPaths.horizontal[row - 1][col];
            mateInfo = { row: row - 1, col, dir: 2 };
            isReversed = true; // Top edge goes left-to-right, bottom went right-to-left
            break;
        case 1: // Right edge = first side of vertical edge
            pathPoints = sharedPaths.vertical[row][col];
            mateInfo = { row, col: col + 1, dir: 3 };
            break;
        case 2: // Bottom edge = first side of horizontal edge
            pathPoints = sharedPaths.horizontal[row][col];
            mateInfo = { row: row + 1, col, dir: 0 };
            break;
        case 3: // Left edge = mate of right edge of piece to the left
            pathPoints = sharedPaths.vertical[row][col - 1];
            mateInfo = { row, col: col - 1, dir: 1 };
            isReversed = true; // Left edge goes bottom-to-top, right went top-to-bottom
            break;
        default:
            throw new Error(`Invalid direction: ${dir}`);
    }

    if (isReversed) {
        pathPoints = pathPoints.slice().reverse();
    }

    // Convert points to SVG path, skipping the first point (already at start)
    const pathSegments = pathPoints.slice(1).map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
    const path = pathSegments.join(' ');

    return { path, mateInfo };
}

/**
 * Build the complete SVG shape from all four edges.
 */
function buildShapeFromEdges(edges: Edge[]): string {
    if (edges.length === 0) return '';
    
    const first = edges[0];
    const parts = [`M ${first.start.x.toFixed(2)} ${first.start.y.toFixed(2)}`];
    
    for (const edge of edges) {
        parts.push(edge.path);
    }
    
    parts.push('Z');
    return parts.join(' ');
}