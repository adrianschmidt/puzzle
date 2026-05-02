/**
 * Z-order management for the post-drop pipeline.
 *
 * After a drop, a large group can fully cover a smaller one, hiding it
 * behind itself in stacking order. This module raises any such covered
 * groups so smaller pieces are never lost beneath larger ones.
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

/**
 * Check whether rect A fully contains rect B.
 */
export function rectFullyContains(a: BoundingRect, b: BoundingRect): boolean {
    return a.minX <= b.minX && a.minY <= b.minY &&
           a.maxX >= b.maxX && a.maxY >= b.maxY;
}

/**
 * Reorder groups after a drop to prevent smaller groups from being
 * hidden behind larger ones.
 *
 * For each dropped group, checks if it fully covers any smaller groups.
 * If so, raises those covered groups above the dropped group so smaller
 * pieces are never hidden behind larger ones.
 *
 * @param droppedGroupIds - IDs of the groups that were just dropped
 * @param state - Current game state
 * @param bringGroupToFront - Function to bring a group to front (z-order)
 */
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

        // Check all other groups that are smaller than the dropped group
        for (const otherGroup of state.groups) {
            if (otherGroup.id === droppedId) continue;
            if (otherGroup.pieces.size >= droppedGroup.pieces.size) continue;

            const otherBounds = zOrderBounds(otherGroup, state.piecesById);

            // If the dropped group fully covers this smaller group, mark it for raising
            if (rectFullyContains(droppedBounds, otherBounds)) {
                // Avoid duplicates - a group might be covered by multiple dropped groups
                if (!groupsToRaise.some(g => g.groupId === otherGroup.id)) {
                    groupsToRaise.push({
                        groupId: otherGroup.id,
                        size: otherGroup.pieces.size,
                    });
                }
            }
        }
    }

    // Sort by size descending (largest raised first, smallest ends up on top)
    groupsToRaise.sort((a, b) => b.size - a.size);

    // Bring each covered group to front
    for (const { groupId } of groupsToRaise) {
        bringGroupToFront(groupId);
    }
}
