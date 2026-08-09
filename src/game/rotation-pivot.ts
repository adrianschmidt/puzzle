/**
 * Pivot selection for manual rotation (issue #530, follow-up).
 *
 * When a group's mated edge is within the snap DISTANCE — angular error is
 * deliberately ignored, since the whole point of rotating is to fix it —
 * the group rotates around that mated piece's center, so the near-connected
 * piece stays put while the rest swings into place. Closest mate wins when
 * several are in range. `null` means no mate is near: the caller falls back
 * to its bbox-center default.
 *
 * Free-rotation only — quarter-turn taps keep the group-center pivot.
 * Stickiness is the caller's job: pick once at drag start and reuse the
 * result for that whole rotation — re-picking mid-gesture would move the
 * pivot under the player's hand.
 */

import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import { getBorderEdges } from '../model/helpers.js';
import { measureEdgeAlignment, pieceCenterLocal } from './merge-detection.js';

export function pickManualRotationPivot(
    state: GameState,
    group: PieceGroup,
    tolerancePx: number,
): Point | null {
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
        ? pivotLocal
        : null;
}
