/**
 * Ported from the Fractal Jigsaw Generator by proceduraljigsaw:
 * https://github.com/proceduraljigsaw/Fractalpuzzlejs
 */

import type { GeneratedPiece, Size } from '../../model/types.js';
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
 * The grid aspect must match the image aspect closely, otherwise the
 * generator's per-axis scaling turns the circular tile arcs into ellipses
 * (visibly "squashed" discs). The effective aspect is:
 *   - `cols / rows` for borderless puzzles
 *   - `(cols-1) / (rows-1)` for framed puzzles (the trimmed rectangle)
 *
 * The search minimizes a weighted sum of aspect error and piece-count
 * error; aspect is weighted 10× since even small ovalness is perceptible
 * while piece-count drift of ±20% is not.
 *
 * @param imageAspect  - Image width / height (e.g. 4/3 ≈ 1.333)
 */
export function scaleFractalGrid(
    targetPieces: number,
    imageAspect: number,
    borderless: boolean = false,
): { cols: number; rows: number } {
    const totalTiles = targetPieces * TILES_PER_PIECE;

    const idealRows = Math.sqrt(totalTiles / imageAspect);
    const rowsSpan = Math.max(20, Math.ceil(idealRows * 2));

    let best = { cols: 3, rows: 3, score: Infinity };

    for (let rows = 3; rows <= rowsSpan; rows++) {
        const idealCols = borderless
            ? rows * imageAspect
            : (rows - 1) * imageAspect + 1;

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
 * @param cols - Grid columns (tile grid, NOT piece columns)
 * @param rows - Grid rows (tile grid, NOT piece rows)
 * @param imageSize - Pixel dimensions of the puzzle image
 */
export function generateFractalPuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: FractalConfig,
): GeneratedPiece[] {
    const random = createSeededRandom(seed);
    const minPieceSize = config?.minPieceSize ?? 2;
    const maxPieceSize = config?.maxPieceSize ?? 8;
    // `=== true`, not `?? false`: identical for every `boolean | undefined`
    // the type admits, but it keeps a crafted non-boolean from generating a
    // borderless puzzle that the share encoder re-emits as bordered. See the
    // note on `fractalStrategy` in `game/cut-style-strategies.ts` for the
    // full rationale; pinned here by `index.test.ts`'s non-boolean case, and
    // together with the strategy's own two reads by
    // `game/cut-style-strategies.test.ts`.
    const borderless = config?.borderless === true;

    // Tile radius in abstract units. The actual pixel size is
    // determined by scaling in convertToStandardPieces.
    const rad = 6.0;
    const frameOffset = 0;

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

    while (fillHoles(grid, pieces, false)) { /* keep going */ }
    fillHoles(grid, pieces, true);

    adoptOrphanTiles(grid, pieces, cols, rows);

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

    return convertToStandardPieces(
        pieces, orphanDiscs, rad, frameOffset, imageSize, cols, rows, borderless,
    );
}

/**
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
