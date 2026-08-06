/**
 * Geometry and layout metadata that can be computed from a `GameState`
 * (or a single `Piece`) without any DOM, SVG, or rendering involvement.
 */

import type { GameState, GeneratedEdge, Piece, PieceBounds } from './types.js';

/**
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
 * Compute the piece-local bounding box by scanning edge endpoints and
 * `curvePoints` (when present). Used at generation time (sealing) and
 * when migrating v≤11 saves whose edges still carry curve samples —
 * after sealing, read `piece.bounds` (via `getPieceBounds`) instead.
 */
export function computePieceBounds(piece: { edges: GeneratedEdge[] }): PieceBounds {
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

    return { minX, minY, maxX, maxY };
}

/**
 * Reads the piece-local bounds stored on the piece; every `Piece` carries them, set by
 * `model/seal-geometry.ts` — at generation time, or on load (restored as
 * stored for a v12+ save, recomputed from curve samples when migrating an
 * older one).
 */
export function getPieceBounds(piece: Piece): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
} {
    const b = piece.bounds;
    return { ...b, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/** The rectangular cell size, not including tab protrusions. */
export function getPieceBaseDimension(
    piece: Piece,
    axis: 'x' | 'y',
): number {
    const bounds = getPieceBounds(piece);
    return axis === 'x' ? bounds.width : bounds.height;
}

export function getGridCols(state: GameState): number {
    if (state.pieces.length === 0) return 1;

    const uniqueXOffsets = new Set(
        state.pieces.map((p) => p.imageOffset.x),
    );

    return uniqueXOffsets.size;
}

export function getGridRows(state: GameState): number {
    if (state.pieces.length === 0) return 1;

    const uniqueYOffsets = new Set(
        state.pieces.map((p) => p.imageOffset.y),
    );

    return uniqueYOffsets.size;
}
