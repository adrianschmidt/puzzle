import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import {
    getGroup,
    moveGroup,
    normalizeDegrees,
    removeGroup,
    rotatePoint,
    signedAngularDelta,
} from '../model/helpers.js';
import {
    detectMerges,
    pieceCenterLocal,
    SNAP_EPSILON_DEG,
    type MergeCandidate,
} from './merge-detection.js';
import { shouldSuppressMerge } from './pile-detection.js';
import { rotateGroup } from './rotate-group.js';

/** Maximum cascade depth to prevent infinite loops in degenerate cases. */
const MAX_CASCADE_DEPTH = 50;

export interface MergeResult {
    group: PieceGroup;
    /** Number of individual merges that happened (including cascades). */
    mergeCount: number;
}

/**
 * The target group is the "anchor" — its position stays fixed while the
 * moved group's pieces are absorbed into it. The moved group itself is
 * left intact — `processDrop` removes it via `removeGroup` afterwards.
 */
export function mergeGroups(
    state: GameState,
    movedGroup: PieceGroup,
    targetGroup: PieceGroup,
    snapDelta: Point,
    movedPiece: Piece,
): PieceGroup {
    // Snap the moved group's rotation to the target's first, pivoting on
    // the mated piece's center — the same pivot measureEdgeAlignment
    // simulated, so the snapDelta below lands the group exactly.
    //
    // For quarter-turn merges the delta is always 0, so this is a no-op
    // and behavior is unchanged for classic/composable rotation modes.
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
    if (Math.abs(rotDelta) > SNAP_EPSILON_DEG) {
        rotateGroup(
            movedGroup, state.piecesById, rotDelta,
            pieceCenterLocal(movedGroup, movedPiece),
        );
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
    const inverseDeg = normalizeDegrees(-targetGroup.rotation);
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
 * The candidate with the smallest snap delta (closest alignment) wins —
 * it gives the most natural "snap" feel.
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
 * Mutates the game state in place. `tolerance` is in pixels.
 */
export function processDrop(
    movedGroupId: number,
    state: GameState,
    tolerance?: number,
    rotationTolerance?: number,
): MergeResult | null {
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

        // Merge one at a time — merging changes the group structure.
        const best = selectBestCandidate(candidates);

        mergeGroups(state, best.movedGroup, best.targetGroup, best.snapDelta, best.movedPiece);
        removeGroup(state, best.movedGroup.id);
        totalMerges++;

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
