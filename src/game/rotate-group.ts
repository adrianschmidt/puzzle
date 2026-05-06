/**
 * Pivot-preserving group rotation.
 *
 * Rotation is stored as quarter-turns on `PieceGroup`. Piece offsets stay in
 * un-rotated local space; rotation is applied at render time and via
 * `getWorldPosition`. When we change a group's rotation, we adjust its
 * `position` so the group's visual bbox centre stays anchored in world space.
 */

import type { Piece, PieceGroup } from '../model/types.js';
import { normaliseQuarterTurns, rotatePoint } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

export type RotationDirection = 'cw' | 'ccw';

/**
 * Rotate a group by 90° clockwise or counter-clockwise, keeping the group's
 * visual bbox centre fixed in world space.
 *
 * Mutates `group.rotation` and `group.position`. Returns the same group.
 */
export function rotateGroup(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    direction: RotationDirection,
): PieceGroup {
    const delta = direction === 'cw' ? 1 : -1;
    const oldRotation = group.rotation;
    const newRotation = normaliseQuarterTurns(oldRotation + delta);

    const bounds = getGroupLocalBounds(group, piecesById);
    const centreLocal = {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };

    // TODO(rotation-as-degrees): the * 90 factors will go away in Task 4
    // when rotateGroup is migrated to operate in degrees natively.
    // Preserve world-space centre: position' + R_new(C) = position + R_old(C)
    const rotatedOld = rotatePoint(centreLocal, oldRotation * 90);
    const rotatedNew = rotatePoint(centreLocal, newRotation * 90);
    group.position = {
        x: group.position.x + rotatedOld.x - rotatedNew.x,
        y: group.position.y + rotatedOld.y - rotatedNew.y,
    };
    group.rotation = newRotation;

    return group;
}
