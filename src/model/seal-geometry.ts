/**
 * Freeze each piece's derived geometry: stored `bounds`, no curve samples.
 *
 * Computes `bounds` from edge endpoints plus the generator's dense curve
 * samples, then drops the samples — post-composition their only consumer
 * was this very bounding box (`getPieceBounds`), while they dominated the
 * persisted geometry blob (~61% of it before #493).
 *
 * Every `Piece` in the app comes through here, from two callers:
 *
 *  - Generation (`game/init.ts`), after `quantizePieceGeometry` so bounds
 *    inherit the 2-decimal precision, and before `createInitialGroups` so
 *    the groups describe the geometry the state keeps. Generated pieces
 *    carry no `bounds`, so the box is computed here.
 *  - Loading a save (`persistence/serialization.ts`, *both* `restorePieces`
 *    branches). A v12+ blob's pieces arrive **with** the `bounds` it stored,
 *    and `piece.bounds ?? computePieceBounds(piece)` below is the mechanism
 *    that preserves them — not defensive idempotence. By then the edges
 *    carry no curve samples, so simplifying the `??` to an unconditional
 *    `computePieceBounds` would silently shrink every restored curved
 *    piece's box to its endpoints (`persistence/serialization.test.ts` and
 *    `game/init-geometry-precision.test.ts` both fail if it goes). v≤11
 *    pieces deliberately arrive without `bounds`, so theirs is recomputed
 *    from the samples those saves still carry.
 *
 * The corollary of trusting an incoming `bounds`: a generator must never
 * emit one. It would bypass both the curve-sample walk here and
 * `quantizePieceGeometry` (which rounds edges and `imageOffset`, not
 * `bounds`) — the parameter type's optional `bounds` is the load path's
 * contract, not an extension point for generators.
 *
 * Pure: returns new piece objects, never mutates input, consumes no
 * randomness, and never touches `shape` / `edge.path` — rendered geometry
 * and the share-link contract are unaffected.
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
