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
 * back.
 *
 * The applied rotation pivots on the latched candidate piece's center —
 * the same pivot the measurement simulates — so that candidate's measured
 * distance is invariant under the rotation this module applies; the ramp
 * is driven purely by how close the player drags the group. The winner is
 * sticky: the first qualifying winner stays latched for as long as it
 * keeps qualifying, so the pivot and target orientation cannot flip
 * mid-drag; the latch re-arms onto the closest qualifying candidate only
 * after the latched one stops qualifying.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group
 * would snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { SNAP_EPSILON_DEG } from './merge-detection.js';
import { pieceCenterLocal } from './group-bounds.js';

import {
    buildProximityContext,
    clamp01,
    selectStickyWinner,
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

export interface SnapProximityRotationResult {
    /** Signed degrees to apply now via `rotateGroup`. */
    deltaDeg: number;
    /** Rotation pivot in un-rotated group-local space: the winning candidate piece's center. */
    pivotLocal: Point;
}

/**
 * Compute the rotation to apply to the dragged group right now — apply
 * `deltaDeg` around `pivotLocal` via `rotateGroup` — or `null` when no
 * correction is due.
 *
 * A candidate qualifies exactly when a drop would merge it: simulated-snap
 * distance `d ≤ tolerancePx` AND angular error `|θ| ≤ rotationToleranceDeg`.
 * The latched candidate is used while it still qualifies; otherwise the
 * smallest-`d` qualifying candidate wins and becomes the latch. The correction
 * reduces `|θ|` to a distance-driven `cap` that equals
 * `rotationToleranceDeg` at the zone edge (no jump on entry) and reaches
 * zero once `d` is within `ROTATION_COMPLETE_AT_FRACTION` of the snap
 * distance, so the group is fully aligned across that inner fraction.
 */
export function computeSnapProximityRotation(
    state: GameState,
    ctx: ProximityContext,
): SnapProximityRotationResult | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    const winner = selectStickyWinner(group, ctx);
    if (winner === null) return null;
    const chosen = winner.measurement;

    const ramp =
        (chosen.distance / ctx.tolerancePx - ROTATION_COMPLETE_AT_FRACTION) /
        (1 - ROTATION_COMPLETE_AT_FRACTION);
    const cap = ctx.rotationToleranceDeg * clamp01(ramp);
    const excess = Math.abs(chosen.rotationDelta) - cap;
    if (excess <= SNAP_EPSILON_DEG) return null;

    return {
        deltaDeg: Math.sign(chosen.rotationDelta) * excess,
        pivotLocal: pieceCenterLocal(group, winner.candidate.piece),
    };
}
