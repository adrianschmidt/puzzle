/**
 * Snap proximity position — progressive translation feedback while rotating.
 *
 * The mirror of `snap-proximity-rotation.ts`. When free rotation is enabled
 * and a group is already within the snap distance of a matching neighbor
 * (a drop would merge), rotating it toward the correct orientation slides it
 * toward the snapped placement: the allowed positional error is capped by a
 * ramp that equals the snap distance at the rotation-tolerance edge (no jump
 * on entry) and reaches zero at exactly-correct rotation (θ = 0), where the
 * full merge correction is applied.
 *
 * One-way by construction: the group's own position is the ratchet's memory.
 * Rotating closer shrinks the cap (translation is applied and persists);
 * rotating away only loosens the cap, which never moves the group back. The
 * rotation gesture pivots on the group's bbox center and `distance` is
 * measured after simulating the rotation snap, so `distance` is invariant to
 * the player's rotation — it responds only to the translation applied here.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group would
 * snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { measureEdgeAlignment } from './merge-detection.js';
import { clamp01, type ProximityContext } from './snap-proximity-context.js';

/**
 * Float-comparison epsilon (world px) for "is this translation effectively
 * zero?" — the positional analog of `SNAP_EPSILON_DEG`. Drives the
 * "already under the cap → return null" short circuit and the one-way
 * ratchet.
 */
export const SNAP_EPSILON_PX = 1e-6;

/**
 * Compute the translation to apply to the group right now, in world px
 * (apply via `moveGroup`), or `null` when no correction is due.
 *
 * A candidate qualifies exactly when a drop would merge it: simulated-snap
 * distance `d ≤ tolerancePx` AND angular error `|θ| ≤ rotationToleranceDeg`.
 * Among qualifying candidates the smallest `d` wins. The correction reduces
 * `d` to a rotation-driven `cap` that equals `tolerancePx` at the
 * rotation-tolerance edge (no jump on entry) and reaches zero at θ = 0,
 * where the full `snapDelta` is applied.
 */
export function computeSnapProximityPosition(
    state: GameState,
    ctx: ProximityContext,
): Point | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    let bestDistance = Infinity;
    let bestSnapDelta: Point = { x: 0, y: 0 };
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
            bestSnapDelta = m.snapDelta;
            bestRotationDelta = m.rotationDelta;
        }
    }
    if (!Number.isFinite(bestDistance)) return null;

    const cap = ctx.tolerancePx *
        clamp01(Math.abs(bestRotationDelta) / ctx.rotationToleranceDeg);
    const excess = bestDistance - cap;
    if (excess <= SNAP_EPSILON_PX) return null;

    // Move along snapDelta so the remaining measured distance is `cap`.
    // excess > 0 here implies bestDistance > cap ≥ 0, so bestDistance > 0.
    const factor = excess / bestDistance;
    return { x: bestSnapDelta.x * factor, y: bestSnapDelta.y * factor };
}
