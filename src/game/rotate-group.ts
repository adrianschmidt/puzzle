/**
 * Pivot-preserving group rotation by a degrees delta. Rotation is stored on
 * `PieceGroup.rotation` as float degrees in `[0, 360)`; piece offsets stay in
 * un-rotated local space and rotation is applied at render / `getWorldPosition`.
 */

import type { Piece, PieceGroup, Point } from '../model/types.js';
import { normalizeDegrees, rotatePoint } from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/**
 * Rotate a group by `deltaDegrees` clockwise (negative = CCW), keeping
 * `pivotLocal` (in un-rotated group-local space) fixed in world space. Omitted,
 * it defaults to the group's bbox center. Mutates `group.rotation` and
 * `group.position`; returns the same group.
 */
export function rotateGroup(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    deltaDegrees: number,
    pivotLocal?: Point,
): PieceGroup {
    const oldRotation = group.rotation;
    const newRotation = normalizeDegrees(oldRotation + deltaDegrees);

    let pivot = pivotLocal;
    if (!pivot) {
        const bounds = getGroupLocalBounds(group, piecesById);
        pivot = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
    }

    // Preserve the pivot's world position: position' + R_new(P) = position + R_old(P)
    const rotatedOld = rotatePoint(pivot, oldRotation);
    const rotatedNew = rotatePoint(pivot, newRotation);
    group.position = {
        x: group.position.x + rotatedOld.x - rotatedNew.x,
        y: group.position.y + rotatedOld.y - rotatedNew.y,
    };
    group.rotation = newRotation;

    return group;
}
