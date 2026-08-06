/**
 * After a drop, a large group can fully cover a smaller one, hiding it
 * in stacking order. Covered groups are raised so smaller pieces are
 * never lost beneath larger ones.
 */

import type { GameState, Piece, PieceGroup } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { getGroupBounds, type BoundingRect } from './group-bounds.js';

/**
 * World-space AABB using just edge corner endpoints (no tab geometry).
 * Corner-only bounds are a fast, conservative approximation — good
 * enough for "is this small group fully covered by that big group".
 */
function zOrderBounds(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Piece>,
): BoundingRect {
    return getGroupBounds(group, piecesById, {
        space: 'world',
        includePathGeometry: false,
    });
}

export function rectFullyContains(a: BoundingRect, b: BoundingRect): boolean {
    return a.minX <= b.minX && a.minY <= b.minY &&
           a.maxX >= b.maxX && a.maxY >= b.maxY;
}

export function reorderGroupsAfterDrop(
    droppedGroupIds: number[],
    state: GameState,
    bringGroupToFront: (groupId: number) => void,
): void {
    const groupsToRaise: { groupId: number; size: number }[] = [];

    for (const droppedId of droppedGroupIds) {
        const droppedGroup = tryGetGroup(state, droppedId);
        if (!droppedGroup) continue;

        const droppedBounds = zOrderBounds(droppedGroup, state.piecesById);

        for (const otherGroup of state.groups) {
            if (otherGroup.id === droppedId) continue;
            if (otherGroup.pieces.size >= droppedGroup.pieces.size) continue;

            const otherBounds = zOrderBounds(otherGroup, state.piecesById);

            if (rectFullyContains(droppedBounds, otherBounds)) {
                if (!groupsToRaise.some(g => g.groupId === otherGroup.id)) {
                    groupsToRaise.push({
                        groupId: otherGroup.id,
                        size: otherGroup.pieces.size,
                    });
                }
            }
        }
    }

    // Largest raised first, so the smallest ends up on top.
    groupsToRaise.sort((a, b) => b.size - a.size);

    for (const { groupId } of groupsToRaise) {
        bringGroupToFront(groupId);
    }
}
