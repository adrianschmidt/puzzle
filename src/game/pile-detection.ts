/**
 * Pile detection — determines whether a dropped group is in a pile
 * of other pieces, and should therefore skip merge detection.
 *
 * Problem: When sorting through a pile of loose pieces, dragging one
 * piece near a pile can accidentally snap it to a matching edge even
 * though the player clearly didn't intend to place it there.
 *
 * Solution: Count how many distinct groups overlap the dropped group's
 * bounding area. If many groups overlap and most are non-matching
 * (no edge mates within merge tolerance), suppress the merge.
 *
 * Exception: Don't suppress when placing a piece into a gap in an
 * assembled section — there, neighboring pieces are expected to be
 * close, but they're typically larger groups (already partially
 * assembled), not a pile of loose singles.
 */

import type { GameState, Piece, PieceGroup } from '../model/types.js';

/**
 * A simple axis-aligned bounding rectangle.
 */
export interface BoundingRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * If this many or more non-matching groups overlap the dropped group,
 * and their count exceeds the matching count by this ratio,
 * suppress the merge.
 */
export const PILE_OVERLAP_THRESHOLD = 3;

/**
 * Padding in pixels added around a group's bounding rect when
 * checking for overlap. This accounts for tabs extending beyond
 * the piece edges and gives some spatial margin.
 */
export const OVERLAP_PADDING_PX = 20;

/**
 * Compute the bounding rectangle of a group in world coordinates.
 *
 * Uses the edge start/end points of each piece to determine the
 * piece-local bounds, then transforms to world space using the
 * group's position and each piece's offset.
 */
export function getGroupBounds(
    group: PieceGroup,
    pieces: Piece[],
): BoundingRect {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const [pieceId, offset] of group.pieces) {
        const piece = pieces.find((p) => p.id === pieceId);
        if (!piece) continue;

        for (const edge of piece.edges) {
            for (const point of [edge.start, edge.end]) {
                const worldX = group.position.x + offset.x + point.x;
                const worldY = group.position.y + offset.y + point.y;

                if (worldX < minX) minX = worldX;
                if (worldX > maxX) maxX = worldX;
                if (worldY < minY) minY = worldY;
                if (worldY > maxY) maxY = worldY;
            }
        }
    }

    return { minX, minY, maxX, maxY };
}

/**
 * Check whether two bounding rectangles overlap.
 */
export function rectsOverlap(a: BoundingRect, b: BoundingRect): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Check whether rect A fully contains rect B.
 */
export function rectFullyContains(a: BoundingRect, b: BoundingRect): boolean {
    return a.minX <= b.minX && a.minY <= b.minY &&
           a.maxX >= b.maxX && a.maxY >= b.maxY;
}

/**
 * Expand a bounding rect by a padding amount in all directions.
 */
export function padRect(rect: BoundingRect, padding: number): BoundingRect {
    return {
        minX: rect.minX - padding,
        minY: rect.minY - padding,
        maxX: rect.maxX + padding,
        maxY: rect.maxY + padding,
    };
}

/**
 * Collect the set of piece IDs that have mate edges pointing into
 * the given group. Returns a Set of piece IDs (in other groups)
 * that are mates of pieces in the given group.
 */
function getMateGroupIds(
    group: PieceGroup,
    pieces: Piece[],
    allGroups: PieceGroup[],
): Set<number> {
    const mateGroupIds = new Set<number>();

    for (const pieceId of group.pieces.keys()) {
        const piece = pieces.find((p) => p.id === pieceId);
        if (!piece) continue;

        for (const edge of piece.edges) {
            if (edge.matePieceId === -1) continue;

            // Find which group the mate piece is in
            const mateGroup = allGroups.find(
                (g) => g.id !== group.id && g.pieces.has(edge.matePieceId),
            );

            if (mateGroup) {
                mateGroupIds.add(mateGroup.id);
            }
        }
    }

    return mateGroupIds;
}

/**
 * Determine whether merge should be suppressed for a dropped group.
 *
 * The heuristic:
 * 1. Compute the bounding rect of the dropped group (with padding).
 * 2. Find all other groups that overlap this rect.
 * 3. Separate overlapping groups into "mates" (have matching edges
 *    with the dropped group) and "non-mates" (unrelated pieces
 *    that just happen to be nearby).
 * 4. If non-mate overlap count >= PILE_OVERLAP_THRESHOLD and
 *    non-mates outnumber mates, it's a pile — suppress merge.
 *
 * This allows intentional placement into a gap in an assembled section:
 * there, the overlapping groups are mostly mates (large assembled
 * sections), so the ratio check passes.
 *
 * @param movedGroupId - The group that was just dropped
 * @param state - Current game state
 * @returns true if merge should be suppressed (it's a pile)
 */
export function shouldSuppressMerge(
    movedGroupId: number,
    state: GameState,
): boolean {
    const movedGroup = state.groups.find((g) => g.id === movedGroupId);
    if (!movedGroup) return false;

    // Don't suppress merges for larger assembled groups — players
    // are more intentional when dragging a big chunk.
    if (movedGroup.pieces.size > 1) return false;

    const movedBounds = padRect(
        getGroupBounds(movedGroup, state.pieces),
        OVERLAP_PADDING_PX,
    );

    // Which groups have matching edges with pieces in the moved group?
    const mateGroupIds = getMateGroupIds(movedGroup, state.pieces, state.groups);

    let mateOverlapCount = 0;
    let nonMateOverlapCount = 0;

    for (const otherGroup of state.groups) {
        if (otherGroup.id === movedGroupId) continue;

        const otherBounds = getGroupBounds(otherGroup, state.pieces);
        if (!rectsOverlap(movedBounds, otherBounds)) continue;

        if (mateGroupIds.has(otherGroup.id)) {
            mateOverlapCount++;
        } else {
            nonMateOverlapCount++;
        }
    }

    // Suppress only when there are enough non-matching groups nearby
    // AND they outnumber the matching groups.
    // This ensures we don't block placement into gaps in assembled
    // sections where matching groups are expected to overlap.
    return nonMateOverlapCount >= PILE_OVERLAP_THRESHOLD &&
           nonMateOverlapCount > mateOverlapCount;
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
        const droppedGroup = state.groups.find(g => g.id === droppedId);
        if (!droppedGroup) continue;

        const droppedBounds = getGroupBounds(droppedGroup, state.pieces);

        // Check all other groups that are smaller than the dropped group
        for (const otherGroup of state.groups) {
            if (otherGroup.id === droppedId) continue;
            if (otherGroup.pieces.size >= droppedGroup.pieces.size) continue;

            const otherBounds = getGroupBounds(otherGroup, state.pieces);

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
