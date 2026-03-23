/**
 * Group merging — combines two piece groups into one when a merge is detected.
 *
 * After a group is dropped and merge candidates are found, this module:
 * 1. Snaps the moved group into perfect alignment
 * 2. Combines the two groups into one (recalculating piece offsets)
 * 3. Handles cascading merges (the new larger group may align with additional neighbors)
 */

import type { GameState, PieceGroup, Point } from '../model/types.js';
import { moveGroup } from '../model/helpers.js';
import { detectMerges, type MergeCandidate } from './merge-detection.js';
import { shouldSuppressMerge } from './pile-detection.js';

/** Maximum cascade depth to prevent infinite loops in degenerate cases. */
const MAX_CASCADE_DEPTH = 50;

/**
 * Result of a merge operation.
 */
export interface MergeResult {
    /** The new/surviving group after all merges. */
    group: PieceGroup;
    /** Number of individual merges that happened (including cascades). */
    mergeCount: number;
}

/**
 * Merge two groups into one, snapping rotation to 0°.
 *
 * The target group is the "anchor" — its position stays fixed.
 * The moved group's pieces are absorbed into the target group,
 * with their offsets recalculated relative to the target group's position.
 *
 * When groups merge, the resulting group snaps to 0° rotation.
 * All piece offsets are recalculated to account for the rotation
 * being "baked in" to positions.
 *
 * @param movedGroup - The group that was just dropped (will be absorbed)
 * @param targetGroup - The group to merge into (stays in place)
 * @param snapDelta - Position correction to apply to the moved group before merging
 * @returns The merged group (which is the mutated targetGroup)
 */
export function mergeGroups(
    movedGroup: PieceGroup,
    targetGroup: PieceGroup,
    snapDelta: Point,
): PieceGroup {
    // First, snap the moved group into perfect alignment
    moveGroup(movedGroup, snapDelta);

    const rotation = targetGroup.rotation;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // If the target group is rotated, we need to "un-rotate" all piece offsets
    // before merging, because the merged group will be at rotation 0.
    // World position of a piece = group.position + rotate(offset, rotation)
    // After un-rotation: new_offset = rotate(offset, rotation)
    // new group.position stays the same (it's the anchor point)
    if (rotation !== 0) {
        // Un-rotate target group's piece offsets
        for (const [pieceId, offset] of targetGroup.pieces) {
            targetGroup.pieces.set(pieceId, {
                x: offset.x * cos - offset.y * sin,
                y: offset.x * sin + offset.y * cos,
            });
        }
    }

    // Calculate the position difference between the two groups.
    // Since both groups have the same rotation, we need to un-rotate
    // the moved group's offsets too.
    const dx = movedGroup.position.x - targetGroup.position.x;
    const dy = movedGroup.position.y - targetGroup.position.y;

    // Transfer all pieces from moved group to target group
    for (const [pieceId, offset] of movedGroup.pieces) {
        // Un-rotate the moved group's piece offsets (same rotation as target)
        const unrotatedX = offset.x * cos - offset.y * sin;
        const unrotatedY = offset.x * sin + offset.y * cos;

        targetGroup.pieces.set(pieceId, {
            x: unrotatedX + dx,
            y: unrotatedY + dy,
        });
    }

    // Snap rotation to 0°
    targetGroup.rotation = 0;

    return targetGroup;
}

/**
 * Select the best merge candidate from a list.
 *
 * When multiple edges of a dropped group align with different target groups,
 * we pick the candidate with the smallest snap delta (closest alignment).
 * This gives the most natural "snap" feel.
 */
export function selectBestCandidate(candidates: MergeCandidate[]): MergeCandidate {
    if (candidates.length === 0) {
        throw new Error('No candidates to select from');
    }

    let best = candidates[0];
    let bestDist = Math.abs(best.snapDelta.x) + Math.abs(best.snapDelta.y);

    for (let i = 1; i < candidates.length; i++) {
        const dist =
            Math.abs(candidates[i].snapDelta.x) +
            Math.abs(candidates[i].snapDelta.y);

        if (dist < bestDist) {
            best = candidates[i];
            bestDist = dist;
        }
    }

    return best;
}

/**
 * Remove a group from the game state's groups array.
 */
function removeGroup(state: GameState, groupId: number): void {
    const index = state.groups.findIndex((g) => g.id === groupId);
    if (index !== -1) {
        state.groups.splice(index, 1);
    }
}

/**
 * Process a drop event: detect merges and execute them, including cascades.
 *
 * This is the main entry point called after a group is dropped.
 * It handles the full merge lifecycle:
 * 1. Detect merge candidates for the dropped group
 * 2. If any found, pick the best one and merge
 * 3. Remove the absorbed group from the state
 * 4. Repeat (cascade) — the newly enlarged group might now align with more neighbors
 * 5. Stop when no more merges are found or max cascade depth is reached
 *
 * Mutates the game state in place.
 *
 * @param movedGroupId - The group that was just dropped
 * @param state - The current game state (mutated)
 * @returns MergeResult if any merges happened, or null if no merges
 */
export function processDrop(
    movedGroupId: number,
    state: GameState,
): MergeResult | null {
    // Check if the group is being dropped into a pile of unrelated pieces.
    // If so, suppress merging to avoid accidental snaps while sorting.
    if (shouldSuppressMerge(movedGroupId, state)) {
        return null;
    }

    let currentGroupId = movedGroupId;
    let totalMerges = 0;

    for (let depth = 0; depth < MAX_CASCADE_DEPTH; depth++) {
        const candidates = detectMerges(currentGroupId, state);

        if (candidates.length === 0) {
            break;
        }

        // Group candidates by target group, pick the best per target,
        // then merge one at a time (since merging changes the group structure)
        const best = selectBestCandidate(candidates);

        mergeGroups(best.movedGroup, best.targetGroup, best.snapDelta);
        removeGroup(state, best.movedGroup.id);
        totalMerges++;

        // The merged group is now the target group — continue cascading from it
        currentGroupId = best.targetGroup.id;
    }

    if (totalMerges === 0) {
        return null;
    }

    const mergedGroup = state.groups.find((g) => g.id === currentGroupId);
    if (!mergedGroup) {
        throw new Error(`Merged group ${currentGroupId} not found after merge`);
    }

    return {
        group: mergedGroup,
        mergeCount: totalMerges,
    };
}
