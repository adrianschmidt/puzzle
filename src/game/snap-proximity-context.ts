/**
 * Shared per-gesture context for the snap-proximity features.
 *
 * Both directions of the "close enough to merge" assist — rotation driven by
 * translation (`snap-proximity-rotation.ts`) and translation driven by
 * rotation (`snap-proximity-position.ts`) — operate on the same dragged
 * group against the same border-edge candidates and tolerances. This module
 * owns that shared context so neither feature depends on the other.
 */

import type { GameState, Point } from '../model/types.js';
import { getBorderEdges, tryGetGroup } from '../model/helpers.js';
import type { GroupBorderEdge } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/** Clamp a value to the unit interval [0, 1]. */
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
    /** The dragged group. */
    groupId: number;
    /** Border edges of the dragged group and their mates (fixed during a gesture). */
    candidates: GroupBorderEdge[];
    /** Dragged group's bbox center in un-rotated local space — the rotation pivot. */
    centerLocal: Point;
    /** Active snap distance (D) in world px. */
    tolerancePx: number;
    /** Active rotation tolerance (T) in degrees. */
    rotationToleranceDeg: number;
}

/**
 * Build the per-gesture context, or `null` when the assist does not apply:
 * not in free-rotation mode, unknown group, no cross-group mates, or a
 * degenerate tolerance. Non-finite tolerances (possible from corrupted
 * saved state upstream) are rejected here so `NaN`/`Infinity` can never
 * flow into the assist math and get persisted onto a group.
 */
export function buildProximityContext(
    state: GameState,
    movedGroupId: number,
    tolerances: SnapTolerances,
): ProximityContext | null {
    const { tolerancePx, rotationToleranceDeg } = tolerances;
    if (state.rotationMode !== 'free') return null;
    if (!Number.isFinite(tolerancePx) || tolerancePx <= 0) return null;
    if (!Number.isFinite(rotationToleranceDeg) || rotationToleranceDeg <= 0) return null;

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
