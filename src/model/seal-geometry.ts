/**
 * Computes `bounds` from edge endpoints plus the generator's dense curve
 * samples, then drops the samples — post-composition their only consumer was
 * this bounding box.
 *
 * Two callers: generation (`game/init.ts`), after `quantizePieceGeometry` so
 * bounds inherit its precision; and loading (`persistence/serialization.ts`).
 * A v12+ blob arrives WITH its stored `bounds`, and `piece.bounds ??
 * computePieceBounds(piece)` is what preserves them — by then the edges carry
 * no curve samples, so an unconditional `computePieceBounds` would silently
 * shrink every restored curved piece's box to its endpoints. v≤11 pieces arrive
 * without `bounds`, recomputed from the samples those saves still carry.
 *
 * Corollary: a generator must never emit `bounds` — it would bypass this walk
 * and `quantizePieceGeometry`. Pure: new objects, no mutation, no randomness,
 * never touches `shape` / `edge.path`.
 */

import type { Edge, GeneratedEdge, GeneratedPiece, Piece, PieceBounds } from './types.js';
import { computePieceBounds } from './derive.js';

function stripCurvePoints(edge: GeneratedEdge): Edge {
    if (!edge.curvePoints) return edge;
    const { curvePoints: _dropped, ...rest } = edge;
    return rest;
}

export function sealPieceGeometry(
    pieces: (GeneratedPiece & { bounds?: PieceBounds })[],
): Piece[] {
    return pieces.map((piece) => ({
        ...piece,
        bounds: piece.bounds ?? computePieceBounds(piece),
        edges: piece.edges.map(stripCurvePoints),
    }));
}
