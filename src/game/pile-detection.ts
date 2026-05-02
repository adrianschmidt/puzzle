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

import type { GameState, PieceGroup } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { getGroupBounds, type BoundingRect } from './group-bounds.js';

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
 * World-space AABB using just edge corner endpoints (no tab geometry).
 * Pile detection has always used corner-only bounds — the
 * `OVERLAP_PADDING_PX` constant exists to compensate for tabs.
 */
function pileBounds(group: PieceGroup, state: GameState): BoundingRect {
    return getGroupBounds(group, state.piecesById, {
        space: 'world',
        includePathGeometry: false,
    });
}

/**
 * Check whether two bounding rectangles overlap.
 */
export function rectsOverlap(a: BoundingRect, b: BoundingRect): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY;
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
    state: GameState,
): Set<number> {
    const mateGroupIds = new Set<number>();

    for (const pieceId of group.pieces.keys()) {
        const piece = state.piecesById.get(pieceId);
        if (!piece) continue;

        for (const edge of piece.edges) {
            if (edge.matePieceId === -1) continue;

            const mateGroup = state.pieceToGroup.get(edge.matePieceId);
            if (mateGroup && mateGroup.id !== group.id) {
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
    const movedGroup = tryGetGroup(state, movedGroupId);
    if (!movedGroup) return false;

    // Don't suppress merges for larger assembled groups — players
    // are more intentional when dragging a big chunk.
    if (movedGroup.pieces.size > 1) return false;

    const movedBounds = padRect(
        pileBounds(movedGroup, state),
        OVERLAP_PADDING_PX,
    );

    // Which groups have matching edges with pieces in the moved group?
    const mateGroupIds = getMateGroupIds(movedGroup, state);

    let mateOverlapCount = 0;
    let nonMateOverlapCount = 0;

    for (const otherGroup of state.groups) {
        if (otherGroup.id === movedGroupId) continue;

        const otherBounds = pileBounds(otherGroup, state);
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
