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

import type { GameState } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { measureEdgeAlignment, SNAP_EPSILON_DEG } from './merge-detection.js';

import {
    buildProximityContext,
    clamp01,
    type ProximityContext,
    type SnapTolerances,
} from './snap-proximity-context.js';

// Re-exported so existing importers of these symbols from this module keep
// working; their canonical home is now snap-proximity-context.ts.
export { buildProximityContext, clamp01 };
export type { ProximityContext, SnapTolerances };

/**
 * Rotation reaches the exact orientation once the dragged group is within
 * this fraction of the snap distance — not only at the exact position. The
 * cap still equals the full rotation tolerance at the zone edge (no jump on
 * entry) and ramps to zero here. Experiment knob: 0 reproduces the original
 * "exact only at d = 0" behavior. Keep it in [0, 1). Exported so tests can
 * anchor their fixtures to it and stay valid when it is retuned.
 */
export const ROTATION_COMPLETE_AT_FRACTION = 0.2;

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
