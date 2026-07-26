/**
 * Final generation pass: freeze each piece's derived geometry.
 *
 * Computes `bounds` from edge endpoints plus the generator's dense curve
 * samples, then drops the samples — post-composition their only consumer
 * was this very bounding box (`getPieceBounds`), while they dominated the
 * persisted geometry blob (~61% of it before #493). Runs in
 * `createNewGame` after `quantizePieceGeometry`, so bounds inherit the
 * 2-decimal precision, and before `createInitialGroups`, so the groups
 * describe the geometry the state keeps.
 *
 * Pure: returns new piece objects, never mutates input, consumes no
 * randomness, and never touches `shape` / `edge.path` — rendered geometry
 * and the share-link contract are unaffected.
 *
 * Idempotent: a piece that already carries `bounds` keeps it rather than
 * recomputing from (by then curve-sample-free) edges, which would shrink
 * the box. Sealing runs once per generation, but this keeps a redundant
 * call harmless instead of quietly corrupting bounds.
 */

import type { Edge, Piece } from './types.js';
import { computePieceBounds } from './derive.js';

function stripCurvePoints(edge: Edge): Edge {
    if (!edge.curvePoints) return edge;
    const { curvePoints: _dropped, ...rest } = edge;
    return rest;
}

export function sealPieceGeometry(pieces: Piece[]): Piece[] {
    return pieces.map((piece) => ({
        ...piece,
        bounds: piece.bounds ?? computePieceBounds(piece),
        edges: piece.edges.map(stripCurvePoints),
    }));
}
