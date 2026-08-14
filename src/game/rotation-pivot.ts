/**
 * Pivot selection for manual rotation (#530). When a mated edge is within snap
 * DISTANCE (angular error deliberately ignored — rotating is what fixes it),
 * rotate around that mate's center so the near-connected piece stays put;
 * closest mate wins. `null` = no mate near (caller uses bbox-center default).
 *
 * Free-rotation only. Stickiness is the caller's job: pick once at drag start
 * and reuse it — re-picking mid-gesture would move the pivot under the hand.
 */

import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import { getBorderEdges } from '../model/helpers.js';
import { measureEdgeAlignment } from './merge-detection.js';
import { pieceCenterLocal } from './group-bounds.js';

export interface ManualRotationPivot {
    /** The anchored piece (moved-group side) — also the position assist's anchor. */
    pieceId: number;
    /** The piece's center in un-rotated group-local space. */
    pivotLocal: Point;
}

export function pickManualRotationPivot(
    state: GameState,
    group: PieceGroup,
    tolerancePx: number,
): ManualRotationPivot | null {
    if (state.rotationMode !== 'free') return null;
    if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) return null;

    let bestDistance = Infinity;
    let bestPiece: Piece | null = null;
    for (const candidate of getBorderEdges(group, state)) {
        const m = measureEdgeAlignment(
            candidate.piece, candidate.edge, group,
            candidate.matePiece, candidate.mateEdge, candidate.mateGroup,
        );
        if (m.distance > tolerancePx) continue;
        if (m.distance < bestDistance) {
            bestDistance = m.distance;
            bestPiece = candidate.piece;
        }
    }
    if (bestPiece === null) return null;
    const pivotLocal = pieceCenterLocal(group, bestPiece);
    return Number.isFinite(pivotLocal.x) && Number.isFinite(pivotLocal.y)
        ? { pieceId: bestPiece.id, pivotLocal }
        : null;
}
