/**
 * Pivot-preserving group rotation by an arbitrary degrees delta.
 *
 * Rotation is stored on `PieceGroup.rotation` as float degrees, normalised
 * to `[0, 360)`. Piece offsets stay in un-rotated local space; rotation is
 * applied at render time and via `getWorldPosition`. When we change a
 * group's rotation, we adjust its `position` so the group's visual bbox
 * centre stays anchored in world space.
 */

import type { Piece, PieceGroup } from '../model/types.js';
import { normaliseDegrees, rotatePoint } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/**
 * Rotate a group by `deltaDegrees` clockwise (negative for counter-clockwise),
 * keeping the group's visual bbox centre fixed in world space.
 *
 * Mutates `group.rotation` and `group.position`. Returns the same group.
 */
export function rotateGroup(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    deltaDegrees: number,
): PieceGroup {
    const oldRotation = group.rotation;
    const newRotation = normaliseDegrees(oldRotation + deltaDegrees);

    const bounds = getGroupLocalBounds(group, piecesById);
    const centreLocal = {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };

    // Preserve world-space centre: position' + R_new(C) = position + R_old(C)
    const rotatedOld = rotatePoint(centreLocal, oldRotation);
    const rotatedNew = rotatePoint(centreLocal, newRotation);
    group.position = {
        x: group.position.x + rotatedOld.x - rotatedNew.x,
        y: group.position.y + rotatedOld.y - rotatedNew.y,
    };
    group.rotation = newRotation;

    return group;
}
