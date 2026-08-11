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
 * Corrections only ever shrink the measured distance toward the cap — never
 * move the group away from the mate — and at θ = 0 the cap is 0, so the
 * full merge correction lands there.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group would
 * snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import {
    clamp01,
    selectStickyWinner,
    type ProximityContext,
} from './snap-proximity-context.js';

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
 * The winner is sticky per gesture (`selectStickyWinner`): with each
 * candidate measured about its own piece's pivot, a manual rotation shifts
 * the non-pivot candidates' distances, so a per-call smallest-`d` pick
 * could flip the slide target mid-rotate. The correction reduces the
 * winner's `d` to a rotation-driven `cap` that equals `tolerancePx` at the
 * rotation-tolerance edge (no jump on entry) and reaches zero at θ = 0,
 * where the full `snapDelta` is applied.
 */
export function computeSnapProximityPosition(
    state: GameState,
    ctx: ProximityContext,
): Point | null {
    const group = tryGetGroup(state, ctx.groupId);
    if (!group) return null;

    const winner = selectStickyWinner(group, ctx);
    if (winner === null) return null;
    const { distance, rotationDelta, snapDelta } = winner.measurement;

    const cap = ctx.tolerancePx *
        clamp01(Math.abs(rotationDelta) / ctx.rotationToleranceDeg);
    const excess = distance - cap;
    if (excess <= SNAP_EPSILON_PX) return null;

    // Move along snapDelta so the remaining measured distance is `cap`.
    // excess > 0 here implies distance > cap ≥ 0, so distance > 0.
    const factor = excess / distance;
    return { x: snapDelta.x * factor, y: snapDelta.y * factor };
}
