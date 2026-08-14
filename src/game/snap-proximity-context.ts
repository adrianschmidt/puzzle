/**
 * Shared per-gesture context for the two snap-proximity assists
 * (`snap-proximity-rotation.ts`, `snap-proximity-position.ts`), owned here so
 * neither feature depends on the other.
 */

import type { GameState, PieceGroup } from '../model/types.js';
import { getBorderEdges, tryGetGroup } from '../model/helpers.js';
import type { GroupBorderEdge } from '../model/helpers.js';
import {
    measureEdgeAlignment,
    type EdgeAlignmentMeasurement,
} from './merge-detection.js';

export function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * Thresholds that define when a drop merges — shared by merge detection and
 * the assists so they agree on "close enough".
 */
export interface SnapTolerances {
    /** Snap distance (D) in world px. */
    tolerancePx: number;
    /** Rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Per-gesture precomputed context. Valid only while the group's composition and
 * mates stay unchanged — true within a gesture since merges happen on drop.
 * Build at gesture start, discard on end/cancel.
 */
export interface ProximityContext {
    groupId: number;
    /** Border edges of the dragged group and their mates (fixed during a gesture). */
    candidates: GroupBorderEdge[];
    /** Active snap distance (D) in world px. */
    tolerancePx: number;
    /** Active rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
    /**
     * Sticky-winner memory: index into `candidates`, or null when nothing is
     * latched. Written only by `selectStickyWinner`.
     */
    latchedCandidateIndex: number | null;
}

/**
 * Sticky-winner selection shared by both assists: the latched candidate keeps
 * winning while it still qualifies (re-measured each call); otherwise the
 * smallest-distance qualifying candidate wins and re-latches. Stops the
 * correction target from flipping mid-gesture.
 */
export function selectStickyWinner(
    group: PieceGroup,
    ctx: ProximityContext,
): { measurement: EdgeAlignmentMeasurement; candidate: GroupBorderEdge } | null {
    const measureQualifying = (
        candidate: GroupBorderEdge,
    ): EdgeAlignmentMeasurement | null => {
        const m = measureEdgeAlignment(
            candidate.piece, candidate.edge, group,
            candidate.matePiece, candidate.mateEdge, candidate.mateGroup,
        );
        // A NaN distance passes the `>` gates below, so reject it here or it
        // would latch and emit a NaN correction.
        if (!Number.isFinite(m.distance)) return null;
        if (Math.abs(m.rotationDelta) > ctx.rotationToleranceDeg) return null;
        if (m.distance > ctx.tolerancePx) return null;
        return m;
    };

    let chosenIndex = ctx.latchedCandidateIndex;
    let chosen: EdgeAlignmentMeasurement | null = null;
    if (chosenIndex !== null) {
        chosen = measureQualifying(ctx.candidates[chosenIndex]);
    }
    if (chosen === null) {
        chosenIndex = null;
        for (let i = 0; i < ctx.candidates.length; i++) {
            const m = measureQualifying(ctx.candidates[i]);
            if (m !== null && (chosen === null || m.distance < chosen.distance)) {
                chosen = m;
                chosenIndex = i;
            }
        }
    }
    ctx.latchedCandidateIndex = chosenIndex;
    if (chosen === null || chosenIndex === null) return null;
    return { measurement: chosen, candidate: ctx.candidates[chosenIndex] };
}

/**
 * Build the per-gesture context, or `null` when the assist doesn't apply: not
 * free-rotation, unknown group, no cross-group mates, or a degenerate/non-finite
 * tolerance (rejected so NaN/Infinity can't flow into the math and get persisted).
 *
 * `anchorPieceId` restricts candidates to that moved-group piece: a manual
 * rotation leaves that piece's distances invariant but shifts others, so an
 * unrestricted assist could latch a different mate and slide the anchored piece
 * out of merge range.
 */
export function buildProximityContext(
    state: GameState,
    movedGroupId: number,
    tolerances: SnapTolerances,
    anchorPieceId?: number,
): ProximityContext | null {
    const { tolerancePx, rotationToleranceDeg } = tolerances;
    if (state.rotationMode !== 'free') return null;
    if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) return null;
    if (!Number.isFinite(rotationToleranceDeg) || rotationToleranceDeg <= 0) return null;

    const group = tryGetGroup(state, movedGroupId);
    if (!group) return null;

    let candidates = getBorderEdges(group, state);
    if (anchorPieceId !== undefined) {
        candidates = candidates.filter((c) => c.piece.id === anchorPieceId);
    }
    if (candidates.length === 0) return null;

    return {
        groupId: movedGroupId,
        candidates,
        tolerancePx,
        rotationToleranceDeg,
        latchedCandidateIndex: null,
    };
}
