/**
 * Problem: when sorting through a pile of loose pieces, dragging one
 * piece near a pile can accidentally snap it to a matching edge even
 * though the player clearly didn't intend to place it there — so merges
 * are suppressed when many non-matching groups overlap the drop.
 *
 * Exception: don't suppress when placing a piece into a gap in an
 * assembled section — there, neighboring pieces are expected to be
 * close, but they're typically larger groups, not a pile of loose
 * singles.
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

export function rectsOverlap(a: BoundingRect, b: BoundingRect): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY;
}

export function padRect(rect: BoundingRect, padding: number): BoundingRect {
    return {
        minX: rect.minX - padding,
        minY: rect.minY - padding,
        maxX: rect.maxX + padding,
        maxY: rect.maxY + padding,
    };
}

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

    // The outnumber requirement keeps placement into gaps in assembled
    // sections working, where matching groups are expected to overlap.
    return nonMateOverlapCount >= PILE_OVERLAP_THRESHOLD &&
           nonMateOverlapCount > mateOverlapCount;
}
