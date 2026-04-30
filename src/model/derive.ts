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
 * Get the base dimension of a piece (width or height) from its edge endpoints.
 * This is the rectangular cell size, not including tab protrusions.
 */
export function getPieceBaseDimension(
    piece: Piece,
    axis: 'x' | 'y',
): number {
    let min = Infinity;
    let max = -Infinity;

    for (const edge of piece.edges) {
        const startVal = edge.start[axis];
        const endVal = edge.end[axis];
        min = Math.min(min, startVal, endVal);
        max = Math.max(max, startVal, endVal);
    }

    return max - min;
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
