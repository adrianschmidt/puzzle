/**
 * Progressive translation feedback while rotating — the mirror of
 * `snap-proximity-rotation.ts`. When a group is already within snap distance of
 * a mate, rotating toward correct orientation slides it toward the snapped
 * placement: positional error is capped by a ramp equal to the snap distance at
 * the rotation-tolerance edge (no jump on entry) and 0 at θ = 0 (full merge
 * correction).
 *
 * One-way by construction — the group's position is the ratchet's memory, so
 * corrections only shrink distance toward the cap, never push away. The merge
 * condition is unchanged; this only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import {
    clamp01,
    selectStickyWinner,
    type ProximityContext,
} from './snap-proximity-context.js';

/** Epsilon (world px) for treating a translation as zero; positional analog of `SNAP_EPSILON_DEG`. */
export const SNAP_EPSILON_PX = 1e-6;

/**
 * Translation to apply now (world px, via `moveGroup`), or `null` when no
 * correction is due. A candidate qualifies when a drop would merge it
 * (`d ≤ tolerancePx` AND `|θ| ≤ rotationToleranceDeg`); the winner is sticky
 * (`selectStickyWinner`) so a manual rotation can't flip the slide target. The
 * correction reduces `d` to a `cap` that equals `tolerancePx` at the rotation-
 * tolerance edge and 0 at θ = 0 (full `snapDelta`).
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

    // Move along snapDelta so remaining distance is `cap`. excess > 0 implies
    // distance > cap ≥ 0, so distance > 0 (safe divide).
    const factor = excess / distance;
    return { x: snapDelta.x * factor, y: snapDelta.y * factor };
}
