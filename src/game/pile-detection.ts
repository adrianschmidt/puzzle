/**
 * Suppress accidental merges when dragging a loose piece through a pile: if
 * many non-matching groups overlap the drop, skip the merge. Exception:
 * placing into a gap in an assembled section, where matching neighbors are
 * expected to be close (and are larger groups, not loose singles).
 */

import type { GameState, PieceGroup } from '../model/types.js';
import { tryGetGroup } from '../model/helpers.js';
import { getGroupBounds, type BoundingRect } from './group-bounds.js';

/** Min non-matching overlapping groups (also must exceed matching count) to suppress. */
export const PILE_OVERLAP_THRESHOLD = 3;

/** Padding (px) around a group's bounds for overlap checks; compensates for tabs. */
export const OVERLAP_PADDING_PX = 20;

/** World-space AABB from corner endpoints only (no tabs; padding compensates). */
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

    // Don't suppress for larger groups: dragging a big chunk is intentional.
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

    // Outnumber requirement keeps gap-placement in assembled sections working.
    return nonMateOverlapCount >= PILE_OVERLAP_THRESHOLD &&
           nonMateOverlapCount > mateOverlapCount;
}
