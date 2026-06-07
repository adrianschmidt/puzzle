/**
 * Group merging — combines two piece groups into one when a merge is detected.
 *
 * After a group is dropped and merge candidates are found, this module:
 * 1. Snaps the moved group into perfect alignment
 * 2. Combines the two groups into one (recalculating piece offsets)
 * 3. Handles cascading merges (the new larger group may align with additional neighbors)
 */

import type { GameState, PieceGroup, Point } from '../model/types.js';
import {
    getGroup,
    moveGroup,
    normaliseDegrees,
    removeGroup,
    rotatePoint,
    signedAngularDelta,
} from '../model/helpers.js';
import { detectMerges, SNAP_EPSILON_DEG, type MergeCandidate } from './merge-detection.js';
import { shouldSuppressMerge } from './pile-detection.js';
import { rotateGroup } from './rotate-group.js';

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
 * Merge two groups into one.
 *
 * The target group is the "anchor" — its position stays fixed.
 * The moved group's pieces are absorbed into the target group,
 * with their offsets recalculated relative to the target group's position.
 *
 * Updates `state.pieceToGroup` to point absorbed pieces at the target.
 * The moved group itself is left intact — `processDrop` removes it via
 * `removeGroup` afterwards.
 *
 * @param state - The game state (pieceToGroup index is mutated)
 * @param movedGroup - The group that was just dropped (will be absorbed)
 * @param targetGroup - The group to merge into (stays in place)
 * @param snapDelta - Position correction to apply to the moved group before merging
 * @returns The merged group (which is the mutated targetGroup)
 */
export function mergeGroups(
    state: GameState,
    movedGroup: PieceGroup,
    targetGroup: PieceGroup,
    snapDelta: Point,
): PieceGroup {
    // Snap the moved group's rotation to the target's first. The pivot is
    // the moved group's bbox center (rotateGroup's invariant) — the
    // snapDelta returned by merge-detection was computed assuming this
    // snap would happen first.
    //
    // For quarter-turn merges the delta is always 0, so this is a no-op
    // and behavior is unchanged for classic/composable rotation modes.
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
    if (Math.abs(rotDelta) > SNAP_EPSILON_DEG) {
        rotateGroup(movedGroup, state.piecesById, rotDelta);
    }

    // Then snap position into perfect alignment. Both groups now share the
    // same rotation, so the local-frame piece-offset rebasing below is correct.
    moveGroup(movedGroup, snapDelta);

    // The raw position diff is in world space; inverse-rotate it so the
    // offsets we add to each piece are in the target group's un-rotated local space.
    const rawDiff: Point = {
        x: movedGroup.position.x - targetGroup.position.x,
        y: movedGroup.position.y - targetGroup.position.y,
    };
    const inverseDeg = normaliseDegrees(-targetGroup.rotation);
    const localDelta = rotatePoint(rawDiff, inverseDeg);

    for (const [pieceId, offset] of movedGroup.pieces) {
        targetGroup.pieces.set(pieceId, {
            x: offset.x + localDelta.x,
            y: offset.y + localDelta.y,
        });
        state.pieceToGroup.set(pieceId, targetGroup);
    }

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
 * @param tolerance - Optional custom merge tolerance in pixels
 * @returns MergeResult if any merges happened, or null if no merges
 */
export function processDrop(
    movedGroupId: number,
    state: GameState,
    tolerance?: number,
    rotationTolerance?: number,
): MergeResult | null {
    // Check if the group is being dropped into a pile of unrelated pieces.
    // If so, suppress merging to avoid accidental snaps while sorting.
    if (shouldSuppressMerge(movedGroupId, state)) {
        return null;
    }

    let currentGroupId = movedGroupId;
    let totalMerges = 0;

    for (let depth = 0; depth < MAX_CASCADE_DEPTH; depth++) {
        const candidates = detectMerges(currentGroupId, state, tolerance, rotationTolerance);

        if (candidates.length === 0) {
            break;
        }

        // Group candidates by target group, pick the best per target,
        // then merge one at a time (since merging changes the group structure)
        const best = selectBestCandidate(candidates);

        mergeGroups(state, best.movedGroup, best.targetGroup, best.snapDelta);
        removeGroup(state, best.movedGroup.id);
        totalMerges++;

        // The merged group is now the target group — continue cascading from it
        currentGroupId = best.targetGroup.id;
    }

    if (totalMerges === 0) {
        return null;
    }

    return {
        group: getGroup(state, currentGroupId),
        mergeCount: totalMerges,
    };
}
