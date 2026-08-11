/**
 * Shared per-gesture context for the snap-proximity features.
 *
 * Both directions of the "close enough to merge" assist — rotation driven by
 * translation (`snap-proximity-rotation.ts`) and translation driven by
 * rotation (`snap-proximity-position.ts`) — operate on the same dragged
 * group against the same border-edge candidates and tolerances. This module
 * owns that shared context so neither feature depends on the other.
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
 * The pair of thresholds that define when a drop would merge — shared by
 * merge detection on drop and the snap-proximity assists during a gesture,
 * so they always agree on what "close enough" means.
 */
export interface SnapTolerances {
    /** Snap distance (D) in world px. */
    tolerancePx: number;
    /** Rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Per-gesture precomputed context. Valid only while the dragged group's
 * composition and every mate group stay unchanged — true for the duration
 * of a single-group gesture, because merges happen only on drop/commit.
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
     * Gesture-scoped memory for the sticky winner: index into `candidates`,
     * or null when nothing is latched. Written only by `selectStickyWinner`.
     * Cleared by construction — the context is rebuilt per gesture.
     */
    latchedCandidateIndex: number | null;
}

/**
 * Sticky-winner selection, shared by both assists so a gesture has one
 * winner protocol: the latched candidate keeps winning while it still
 * qualifies (re-measured fresh each call); only when it stops qualifying
 * does the smallest-distance qualifying candidate win and become the new
 * latch. Keeps the correction target — pivot, orientation, or slide
 * direction — from flipping mid-gesture while the player closes in on it.
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
        // A NaN distance from corrupt geometry passes both `>` gates below;
        // it must decline here or it would latch and emit a NaN correction.
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
 * Build the per-gesture context, or `null` when the assist does not apply:
 * not in free-rotation mode, unknown group, no cross-group mates, or a
 * degenerate tolerance. Non-finite tolerances (possible from corrupted
 * saved state upstream) are rejected here so `NaN`/`Infinity` can never
 * flow into the assist math and get persisted onto a group.
 *
 * `anchorPieceId` restricts the candidates to that moved-group piece. A
 * manual rotation pivots on the anchored piece's center, which leaves that
 * piece's candidates' measured distances invariant while every other
 * candidate's shifts — so an unrestricted assist could latch a different
 * mate mid-rotate and slide the anchored piece out of merge range. The
 * rotate gesture passes its manual-pivot piece here so "which mate wins
 * this gesture" has exactly one owner.
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
