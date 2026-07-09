/**
 * Pivot-preserving group rotation by an arbitrary degrees delta.
 *
 * Rotation is stored on `PieceGroup.rotation` as float degrees, normalized
 * to `[0, 360)`. Piece offsets stay in un-rotated local space; rotation is
 * applied at render time and via `getWorldPosition`. When we change a
 * group's rotation, we adjust its `position` so the group's visual bbox
 * center stays anchored in world space.
 */

import type { Piece, PieceGroup, Point } from '../model/types.js';
import { normalizeDegrees, rotatePoint } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/**
 * Rotate a group by `deltaDegrees` clockwise (negative for counter-clockwise),
 * keeping the group's visual bbox center fixed in world space.
 *
 * Pass `precomputedCenterLocal` (the group's bbox center in un-rotated
 * local space) to skip the O(pieces) bounds traversal when the caller
 * already holds it — e.g. per-frame rotation during a drag. It must match
 * the group's current composition.
 *
 * Mutates `group.rotation` and `group.position`. Returns the same group.
 */
export function rotateGroup(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    deltaDegrees: number,
    precomputedCenterLocal?: Point,
): PieceGroup {
    const oldRotation = group.rotation;
    const newRotation = normalizeDegrees(oldRotation + deltaDegrees);

    let centerLocal = precomputedCenterLocal;
    if (!centerLocal) {
        const bounds = getGroupLocalBounds(group, piecesById);
        centerLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
    }

    // Preserve world-space center: position' + R_new(C) = position + R_old(C)
    const rotatedOld = rotatePoint(centerLocal, oldRotation);
    const rotatedNew = rotatePoint(centerLocal, newRotation);
    group.position = {
        x: group.position.x + rotatedOld.x - rotatedNew.x,
        y: group.position.y + rotatedOld.y - rotatedNew.y,
    };
    group.rotation = newRotation;

    return group;
}
