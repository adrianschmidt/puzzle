/**
 * Snap proximity rotation — progressive rotation feedback while dragging.
 *
 * When free rotation is enabled and a dragged group is close enough to a
 * matching neighbor that dropping it would merge (within both the snap
 * distance and the rotation tolerance), the group progressively rotates
 * toward the snapped orientation as the remaining distance shrinks.
 *
 * The rotation is one-way by construction: the allowed angular error is
 * capped by a ramp that equals `rotationTolerance` at the zone edge and
 * reaches zero once within `ROTATION_COMPLETE_AT_FRACTION` of the snap
 * distance. Moving closer tightens the cap (rotation is applied and
 * persists); moving away only loosens it, which never rotates the group
 * back. Pivot-preserving rotation (`rotateGroup`) keeps the group's bbox
 * center fixed, so the measured distance is invariant under the rotation
 * this module applies — the ramp is driven purely by how close the player
 * drags the group.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group
 * would snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { getBorderEdges, tryGetGroup } from '../model/helpers.js';
import type { GroupBorderEdge } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';
import { measureEdgeAlignment, SNAP_EPSILON_DEG } from './merge-detection.js';

/**
 * Rotation reaches the exact orientation once the dragged group is within
 * this fraction of the snap distance — not only at the exact position. The
 * cap still equals the full rotation tolerance at the zone edge (no jump on
 * entry) and ramps to zero here. Experiment knob: 0 reproduces the original
 * "exact only at d = 0" behavior. Keep it in [0, 1). Exported so tests can
 * anchor their fixtures to it and stay valid when it is retuned.
 */
export const ROTATION_COMPLETE_AT_FRACTION = 0.2;

/** Clamp a value to the unit interval [0, 1]. */
function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * The pair of thresholds that define when a drop would merge — shared by
 * merge detection on drop and snap proximity rotation during a drag, so
 * both always agree on what "close enough" means.
 */
export interface SnapTolerances {
    /** Snap distance (D) in world px. */
    tolerancePx: number;
    /** Rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Per-drag precomputed context. Valid only while the dragged group's
 * composition and every mate group stay unchanged — true for the duration
 * of a single-group drag, because merges happen only on drop. Build at
 * drag start, discard on drop/cancel.
 */
export interface ProximityContext {
    /** The dragged group. */
    groupId: number;
    /** Border edges of the dragged group and their mates (fixed during a drag). */
    candidates: GroupBorderEdge[];
    /** Dragged group's bbox center in un-rotated local space — the rotation pivot. */
    centerLocal: Point;
    /** Active snap distance (D) in world px. */
    tolerancePx: number;
    /** Active rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Build the per-drag context, or `null` when the feature does not apply:
 * not in free-rotation mode, unknown group, no cross-group mates, or a
 * degenerate tolerance. Non-finite tolerances (possible from corrupted
 * saved state upstream) are rejected here so `NaN`/`Infinity` can never
 * flow into the rotation math and get persisted as a group rotation.
 */
export function buildProximityContext(
    state: GameState,
    movedGroupId: number,
    tolerances: SnapTolerances,
): ProximityContext | null {
    const { tolerancePx, rotationToleranceDeg } = tolerances;
    if (state.rotationMode !== 'free') return null;
    if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) return null;
    if (!Number.isFinite(rotationToleranceDeg)) return null;

    const group = tryGetGroup(state, movedGroupId);
    if (!group) return null;

    const candidates = getBorderEdges(group, state);
    if (candidates.length === 0) return null;

    const bounds = getGroupLocalBounds(group, state.piecesById);
    return {
        groupId: movedGroupId,
        candidates,
        centerLocal: {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        },
        tolerancePx,
        rotationToleranceDeg,
    };
}

/**
 * Compute the rotation to apply to the dragged group right now, in signed
 * degrees (apply via `rotateGroup`), or `null` when no correction is due.
 *
 * A candidate qualifies exactly when a drop would merge it: simulated-snap
 * distance `d ≤ tolerancePx` AND angular error `|θ| ≤ rotationToleranceDeg`.
 * Among qualifying candidates the smallest `d` wins. The correction
 * reduces `|θ|` to a distance-driven `cap` that equals
 * `rotationToleranceDeg` at the zone edge (no jump on entry) and reaches
 * zero once `d` is within `ROTATION_COMPLETE_AT_FRACTION` of the snap
 * distance, so the group is fully aligned across that inner fraction.
 */
export function computeSnapProximityRotation(
    state: GameState,
    ctx: ProximityContext,
): number | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    let bestDistance = Infinity;
    let bestRotationDelta = 0;
    for (const candidate of ctx.candidates) {
        const m = measureEdgeAlignment(
            candidate.piece, candidate.edge, group,
            candidate.matePiece, candidate.mateEdge, candidate.mateGroup,
            state.piecesById, ctx.centerLocal,
        );
        if (Math.abs(m.rotationDelta) > ctx.rotationToleranceDeg) continue;
        if (m.distance > ctx.tolerancePx) continue;
        if (m.distance < bestDistance) {
            bestDistance = m.distance;
            bestRotationDelta = m.rotationDelta;
        }
    }
    if (!Number.isFinite(bestDistance)) return null;

    const ramp =
        (bestDistance / ctx.tolerancePx - ROTATION_COMPLETE_AT_FRACTION) /
        (1 - ROTATION_COMPLETE_AT_FRACTION);
    const cap = ctx.rotationToleranceDeg * clamp01(ramp);
    const excess = Math.abs(bestRotationDelta) - cap;
    if (excess <= SNAP_EPSILON_DEG) return null;

    return Math.sign(bestRotationDelta) * excess;
}
