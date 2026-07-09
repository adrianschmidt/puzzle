/**
 * Snap proximity rotation — progressive rotation feedback while dragging.
 *
 * When free rotation is enabled and a dragged group is close enough to a
 * matching neighbor that dropping it would merge (within both the snap
 * distance and the rotation tolerance), the group progressively rotates
 * toward the snapped orientation as the remaining distance shrinks.
 *
 * The rotation is one-way by construction: the allowed angular error is
 * capped at `rotationTolerance * (distance / tolerance)`. Moving closer
 * tightens the cap (rotation is applied and persists); moving away only
 * loosens it, which never rotates the group back. Pivot-preserving
 * rotation (`rotateGroup`) keeps the group's bbox center fixed, so the
 * measured distance is invariant under the rotation this module applies —
 * the ramp is driven purely by how close the player drags the group.
 *
 * Not an assist: the merge condition is unchanged — a qualifying group
 * would snap on drop regardless. This only surfaces the earned snap early.
 */

import type { GameState, Point } from '../model/types.js';
import { getBorderEdges, tryGetGroup } from '../model/helpers.js';
import type { GroupBorderEdge } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

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
    tolerancePx: number,
    rotationToleranceDeg: number,
): ProximityContext | null {
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
