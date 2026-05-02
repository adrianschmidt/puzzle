/**
 * Fractal circle-packing puzzle generator.
 *
 * Ported from the Fractal Jigsaw Generator by proceduraljigsaw:
 * https://github.com/proceduraljigsaw/Fractalpuzzlejs
 *
 * The algorithm places tiles on a square grid and connects them
 * diagonally to form pieces. Each piece is bounded by quarter-circle
 * arcs around the tile centres, producing organic, dragon-curve-like
 * shapes that interlock without traditional tabs/blanks.
 *
 * Public API:
 *   - generateFractalPuzzle — produce Piece[] from grid + image size + seed.
 *   - scaleFractalGrid     — pick a tile-grid shape that yields ~N pieces
 *                            while matching the image aspect ratio.
 *
 * Pipeline modules (internal):
 *   - types.ts        — Tile, DiagonalConnection, ArcData
 *   - tile.ts         — small constructors / equality helpers
 *   - cell-grid.ts    — visited-tile / occupied-cell bookkeeping
 *   - arcs.ts         — quarter-circle arc construction
 *   - piece-growth.ts — flood-fill, hole filling, orphan adoption
 *   - convert.ts      — abstract pieces → standard Piece[] with mates
 */

import type { Piece, Size } from '../../model/types.js';
import { diagnostics } from '../../diagnostics.js';
import { createSeededRandom } from '../seeded-random.js';
import { CellGrid } from './cell-grid.js';
import type { DiagonalConnection, Tile } from './types.js';
import { makeTile } from './tile.js';
import {
    adoptOrphanTiles,
    createPiece,
    fillEmptyCells,
    fillHoles,
} from './piece-growth.js';
import { convertToStandardPieces } from './convert.js';

/**
 * Average number of tiles consumed per piece in the fractal generator.
 * Empirically measured across many seeds with default piece-size params.
 * Orphan tiles (issue #224) are absorbed as disc sub-paths on an adjacent
 * piece, so they do not add to the piece count.
 */
const TILES_PER_PIECE = 4.9;

/**
 * Compute tile-grid dimensions that produce approximately `targetPieces`
 * fractal pieces while matching the aspect ratio of the puzzle image.
 *
 * The grid aspect must match the image aspect closely, otherwise the
 * generator's per-axis scaling turns the circular tile arcs into ellipses
 * (visibly "squashed" discs). The effective aspect is:
 *   - `cols / rows` for borderless puzzles
 *   - `(cols-1) / (rows-1)` for framed puzzles (the trimmed rectangle)
 *
 * The search minimises a weighted sum of aspect error and piece-count
 * error; aspect is weighted 10× since even small ovalness is perceptible
 * while piece-count drift of ±20% is not.
 *
 * @param targetPieces - Desired number of pieces (e.g. 24, 48, 96, 192)
 * @param imageAspect  - Image width / height (e.g. 4/3 ≈ 1.333)
 * @param borderless   - Whether the puzzle uses borderless (curved-edge) fitting
 * @returns `{ cols, rows }` for the tile grid
 */
export function scaleFractalGrid(
    targetPieces: number,
    imageAspect: number,
    borderless: boolean = false,
): { cols: number; rows: number } {
    const totalTiles = targetPieces * TILES_PER_PIECE;

    // Iterate rows over a generous range; for each, pick the cols values
    // around the ideal (for perfect aspect match) and score each candidate.
    const idealRows = Math.sqrt(totalTiles / imageAspect);
    const rowsSpan = Math.max(20, Math.ceil(idealRows * 2));

    let best = { cols: 3, rows: 3, score: Infinity };

    for (let rows = 3; rows <= rowsSpan; rows++) {
        const idealCols = borderless
            ? rows * imageAspect
            : (rows - 1) * imageAspect + 1;

        // Try floor and ceil to cover both sides of the ideal.
        const candidates = new Set([
            Math.floor(idealCols),
            Math.ceil(idealCols),
        ]);

        for (const cols of candidates) {
            if (cols < 3) continue;

            const actualAspect = borderless
                ? cols / rows
                : (cols - 1) / (rows - 1);
            const aspectError = Math.abs(actualAspect - imageAspect) / imageAspect;

            const pieceCount = (cols * rows) / TILES_PER_PIECE;
            const pieceCountError = Math.abs(pieceCount - targetPieces) / targetPieces;

            const score = aspectError * 10 + pieceCountError;
            if (score < best.score) {
                best = { cols, rows, score };
            }
        }
    }

    return { cols: best.cols, rows: best.rows };
}

/**
 * Configuration for the fractal generator.
 */
export interface FractalConfig {
    /** Minimum number of tiles per piece (default: 2). */
    minPieceSize?: number;
    /** Maximum number of tiles per piece (default: 8). */
    maxPieceSize?: number;
    /**
     * Borderless mode: keep curved outer edges and do not attach orphan-tile
     * discs to neighbour pieces. Makes the puzzle harder because no piece is
     * clearly identifiable as a border piece. Default: false.
     */
    borderless?: boolean;
}

/**
 * Generate a fractal puzzle using the circle-packing diagonal connection algorithm.
 *
 * @param cols - Grid columns (tile grid, NOT piece columns)
 * @param rows - Grid rows (tile grid, NOT piece rows)
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible layouts
 * @param config - Optional configuration for piece sizes
 * @returns Array of pieces with organic arc-based shapes
 */
export function generateFractalPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: FractalConfig,
): Piece[] {
    const random = createSeededRandom(seed);
    const minPieceSize = config?.minPieceSize ?? 2;
    const maxPieceSize = config?.maxPieceSize ?? 8;
    const borderless = config?.borderless ?? false;

    // Tile radius in abstract units. The actual pixel size is
    // determined by scaling in convertToStandardPieces.
    const rad = 6.0;
    const frameOffset = 0;

    // Create grid and generate pieces
    const grid = new CellGrid(cols, rows);
    const pieces: DiagonalConnection[][] = [];

    while (grid.nunvisited > 0) {
        const piece = createPiece(grid, minPieceSize, maxPieceSize, random);
        if (piece) {
            pieces.push(piece);
        }
    }

    // Regenerate grid state for hole-filling
    grid.reset();
    for (const p of pieces) {
        for (const c of p) {
            if (!grid.isTileVisited(c.p1)) grid.visitTile(c.p1);
            if (c.p2_taken && !grid.isTileVisited(c.p2)) grid.visitTile(c.p2);
            grid.occupyCell(c.cell);
        }
    }

    // Fill remaining holes
    while (fillHoles(grid, pieces, false)) { /* keep going */ }
    fillHoles(grid, pieces, true);

    // Adopt orphan tiles: tiles that were visited but never ended up in
    // a piece (e.g. because the piece was too small and got discarded).
    // For each orphan, find an adjacent piece and add a connection to it.
    adoptOrphanTiles(grid, pieces, cols, rows);

    // Fill any remaining empty cells (star-shaped holes)
    fillEmptyCells(grid, pieces, cols, rows);

    // Any tile still not attached to a piece — because all of its
    // diagonal cells are already occupied and no adoption path exists —
    // becomes a disc sub-path on an adjacent piece. Without this, the
    // tile's circular region is left uncovered in the puzzle (a literal
    // hole). The owner is the piece holding a diagonal in any adjacent
    // cell; empirically (>4000 discs sampled) every orphan's surrounding
    // diagonals belong to exactly one piece.
    const attached = new Set<string>();
    for (const p of pieces) {
        for (const c of p) {
            attached.add(`${c.p1.x},${c.p1.y}`);
            attached.add(`${c.p2.x},${c.p2.y}`);
        }
    }
    const orphanDiscs: Array<{ tile: Tile; ownerPieceIdx: number }> = [];
    if (!borderless) {
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (attached.has(`${x},${y}`)) continue;

                const ownerPieceIdx = findDiagonalOwner(pieces, x, y, cols, rows);
                if (ownerPieceIdx === -1) {
                    diagnostics.warn(
                        `[fractal] Orphan tile (${x},${y}) has no adjacent`
                        + ' piece; disc cannot be attached',
                    );
                    continue;
                }
                orphanDiscs.push({ tile: makeTile(x, y), ownerPieceIdx });
            }
        }
    }

    // Convert to standard Piece[] format
    return convertToStandardPieces(
        pieces, orphanDiscs, rad, frameOffset, imageSize, cols, rows, borderless,
    );
}

/**
 * Find the piece that owns any diagonal in a cell adjacent to (x,y).
 * Returns -1 if no adjacent cell contains a diagonal (shouldn't happen
 * for a true orphan — every orphan tile is boxed in by occupied cells).
 */
function findDiagonalOwner(
    pieces: DiagonalConnection[][],
    x: number, y: number,
    cols: number, rows: number,
): number {
    const adjCells = [
        { cx: x - 1, cy: y - 1 },
        { cx: x, cy: y - 1 },
        { cx: x - 1, cy: y },
        { cx: x, cy: y },
    ];
    for (const { cx, cy } of adjCells) {
        if (cx < 0 || cx >= cols - 1 || cy < 0 || cy >= rows - 1) continue;
        for (let pi = 0; pi < pieces.length; pi++) {
            if (pieces[pi].some(c => c.cell.x === cx && c.cell.y === cy)) {
                return pi;
            }
        }
    }

    return -1;
}
