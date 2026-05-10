/**
 * Pure derivations from puzzle pieces.
 *
 * Geometry and layout metadata that can be computed from a `GameState`
 * (or a single `Piece`) without any DOM, SVG, or rendering involvement.
 */

import type { GameState, Piece } from './types.js';

/**
 * Derive image dimensions from the puzzle pieces.
 *
 * The bottom-right piece has the most negative image offset.
 * Image size = abs(most negative offset) + one piece cell size.
 */
export function getImageDimensions(
    state: GameState,
): { width: number; height: number } {
    if (state.pieces.length === 0) {
        return { width: 0, height: 0 };
    }

    let maxNegX = 0;
    let maxNegY = 0;

    for (const piece of state.pieces) {
        maxNegX = Math.min(maxNegX, piece.imageOffset.x);
        maxNegY = Math.min(maxNegY, piece.imageOffset.y);
    }

    const piece0 = state.pieces[0];
    const pieceWidth = getPieceBaseDimension(piece0, 'x');
    const pieceHeight = getPieceBaseDimension(piece0, 'y');

    return {
        width: Math.abs(maxNegX) + pieceWidth,
        height: Math.abs(maxNegY) + pieceHeight,
    };
}

/**
 * Get the piece-local bounding box from its edges.
 *
 * Samples both endpoints and `curvePoints` (when present) so curve-
 * bounded pieces (e.g. lens / crescent shapes whose endpoints share
 * an axis) get a meaningful bbox instead of a degenerate line. Tab
 * protrusions are not separately accounted for, but their geometry
 * is captured implicitly via `curvePoints` once tabs have been
 * baked into the edge curves.
 */
export function getPieceBounds(piece: Piece): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
} {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const include = (p: { x: number; y: number }): void => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    };

    for (const edge of piece.edges) {
        include(edge.start);
        include(edge.end);
        if (edge.curvePoints) {
            for (const p of edge.curvePoints) include(p);
        }
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

/**
 * Get the base dimension of a piece (width or height) from its edge endpoints.
 * This is the rectangular cell size, not including tab protrusions.
 */
export function getPieceBaseDimension(
    piece: Piece,
    axis: 'x' | 'y',
): number {
    const bounds = getPieceBounds(piece);
    return axis === 'x' ? bounds.width : bounds.height;
}

/** Derive grid columns from image offsets. */
export function getGridCols(state: GameState): number {
    if (state.pieces.length === 0) return 1;

    const uniqueXOffsets = new Set(
        state.pieces.map((p) => p.imageOffset.x),
    );

    return uniqueXOffsets.size;
}

/** Derive grid rows from image offsets. */
export function getGridRows(state: GameState): number {
    if (state.pieces.length === 0) return 1;

    const uniqueYOffsets = new Set(
        state.pieces.map((p) => p.imageOffset.y),
    );

    return uniqueYOffsets.size;
}
