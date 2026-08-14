/**
 * Progressive rotation feedback while dragging. When a dragged group is close
 * enough to a mate that dropping would merge (within both snap distance and
 * rotation tolerance), it rotates toward the snapped orientation as the distance
 * shrinks.
 *
 * One-way by construction: the allowed angular error is capped by a ramp equal
 * to `rotationTolerance` at the zone edge and 0 within
 * `ROTATION_COMPLETE_AT_FRACTION` of the snap distance; moving closer tightens
 * the cap (applied and persists), moving away only loosens it (never rotates
 * back). The rotation pivots on the latched candidate piece's center — the same
 * pivot the measurement simulates — so that candidate's distance is invariant
 * under the applied rotation. The winner is sticky, so pivot and target
 * orientation can't flip mid-drag. The merge condition is unchanged; this only
 * surfaces the earned snap early.
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

// Re-exported for back-compat; canonical home is snap-proximity-context.ts.
export { buildProximityContext, clamp01 };
export type { ProximityContext, SnapTolerances };

/**
 * Rotation reaches exact orientation once within this fraction of the snap
 * distance (cap = full rotation tolerance at the zone edge, 0 here). Keep in
 * [0, 1); 0 reproduces the original "exact only at d = 0". Exported so tests
 * can anchor to it.
 */
export const ROTATION_COMPLETE_AT_FRACTION = 0.2;

export interface SnapProximityRotationResult {
    /** Signed degrees to apply now via `rotateGroup`. */
    deltaDeg: number;
    /** Rotation pivot in un-rotated group-local space: the winning candidate piece's center. */
    pivotLocal: Point;
}

/**
 * Rotation to apply now — `deltaDeg` around `pivotLocal` via `rotateGroup` — or
 * `null` when no correction is due. A candidate qualifies when a drop would
 * merge it (`d ≤ tolerancePx` AND `|θ| ≤ rotationToleranceDeg`); the latched
 * candidate is used while it qualifies, else the smallest-`d` one re-latches.
 * The correction reduces `|θ|` to a `cap` equal to `rotationToleranceDeg` at the
 * zone edge and 0 within `ROTATION_COMPLETE_AT_FRACTION` of the snap distance.
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
