/**
 * Merge detection — determines whether edges of a dropped group
 * align closely enough with their mates to trigger a merge.
 *
 * The core mechanic: pieces merge when their matching edges are
 * placed within tolerance of perfect alignment, regardless of
 * where they are on the table.
 */

import type { Edge, GameState, Piece, PieceGroup, Point } from '../model/types.js';
import {
    getBorderEdges,
    getWorldPosition,
    localToWorld,
    normalizeDegrees,
    rotatePoint,
    signedAngularDelta,
    tryGetGroup,
} from '../model/helpers.js';
import { getGroupLocalBounds } from './group-bounds.js';

/**
 * Tolerance in pixels for edge alignment.
 * If the actual distance between matching edge endpoints is within
 * this threshold, the pieces are considered aligned and will merge.
 */
export const MERGE_TOLERANCE_PX = 18;

/**
 * Default angular tolerance (degrees) for free-mode merge alignment.
 * Equals the Strict preset; Normal and Forgiving presets in
 * `merge-tolerance.ts` override this via the `rotationTolerance`
 * parameter on `detectMerges`/`checkEdgeAlignment`.
 */
export const MERGE_ROTATION_TOLERANCE_DEG = 10;

/**
 * Float-comparison epsilon (degrees) for "is this rotation delta effectively
 * zero?" checks — used by callers that want to short-circuit no-op rotation
 * snaps when group rotations match within float jitter.
 */
export const SNAP_EPSILON_DEG = 1e-9;

/**
 * A detected merge candidate: two groups whose edges are close enough.
 */
export interface MergeCandidate {
    /** The group that was just dropped. */
    movedGroup: PieceGroup;
    /** The other group whose piece is close enough to merge. */
    targetGroup: PieceGroup;
    /** The piece in the moved group whose edge matched. */
    movedPiece: Piece;
    /** The edge on the moved piece that matched. */
    movedEdge: Edge;
    /** The mate piece in the target group. */
    targetPiece: Piece;
    /** The mate edge on the target piece. */
    targetEdge: Edge;
    /**
     * The positional correction needed to snap the moved group
     * into perfect alignment with the target group for this edge pair.
     */
    snapDelta: Point;
}

/**
 * Per-snap, per-group cached quantities for `getWorldPositionAfterRotationSnap`.
 * Independent of which point on which piece we're projecting, so we build
 * it once per `checkEdgeAlignment` call and reuse it for both endpoints.
 *
 * `null` means the rotation delta is below `SNAP_EPSILON_DEG` and callers
 * can take the no-snap fast path.
 */
interface RotationSnapContext {
    /** Bbox center in un-rotated local space — the rotation pivot. */
    centerLocal: Point;
    /** World-space pivot, fixed during the snap. */
    worldCenter: Point;
    /** Group rotation after applying the snap delta, normalized to [0, 360). */
    newRotation: number;
}

function buildRotationSnapContext(
    group: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    extraDeg: number,
): RotationSnapContext | null {
    if (Math.abs(extraDeg) < SNAP_EPSILON_DEG) return null;
    const bounds = getGroupLocalBounds(group, piecesById);
    const centerLocal = {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };
    return {
        centerLocal,
        worldCenter: localToWorld(centerLocal, group),
        newRotation: normalizeDegrees(group.rotation + extraDeg),
    };
}

/**
 * World position of a piece-local point AS IF the group had been rotated
 * by `extraDeg` around its bbox center — the way `rotateGroup` performs a
 * rotation snap. For a null `snapCtx` (caller saw `extraDeg ≈ 0`) this
 * collapses to the existing `getWorldPosition` path, so quarter-turn-mode
 * merges are unaffected.
 */
function getWorldPositionAfterRotationSnap(
    pieceLocal: Point,
    pieceId: number,
    group: PieceGroup,
    snapCtx: RotationSnapContext | null,
): Point {
    if (snapCtx === null) {
        return getWorldPosition(pieceLocal, pieceId, group);
    }

    const offset = group.pieces.get(pieceId);
    if (!offset) throw new Error(`Piece ${pieceId} not in group ${group.id}`);
    const localInGroup = { x: offset.x + pieceLocal.x, y: offset.y + pieceLocal.y };

    const offsetFromCenter = {
        x: localInGroup.x - snapCtx.centerLocal.x,
        y: localInGroup.y - snapCtx.centerLocal.y,
    };
    const rotated = rotatePoint(offsetFromCenter, snapCtx.newRotation);
    return {
        x: snapCtx.worldCenter.x + rotated.x,
        y: snapCtx.worldCenter.y + rotated.y,
    };
}

/**
 * Compute the distance between two points.
 */
function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check alignment between two matching edges.
 *
 * For a pair of mate edges, "correct alignment" means:
 * - Edge A's start aligns with Edge B's end (edges run in opposite directions)
 * - Edge A's end aligns with Edge B's start
 *
 * We check both endpoint pairs and use the average distance.
 * If within tolerance, returns the snap delta to achieve perfect alignment.
 */
export function checkEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    tolerance: number = MERGE_TOLERANCE_PX,
    rotationTolerance: number = MERGE_ROTATION_TOLERANCE_DEG,
): { aligned: boolean; snapDelta: Point } {
    // Two groups can only mate when their rotations are close enough.
    // Exact equality is no longer required: in free-rotation mode the
    // tolerance window lets the player land near the correct orientation
    // and still trigger a merge. In quarter-turn mode the delta is always
    // 0, so the tolerance is a no-op and behavior is unchanged.
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);
    if (Math.abs(rotDelta) > rotationTolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }

    // Simulate the rotation snap before measuring position alignment.
    // This ensures the snap delta accounts for both the rotation correction
    // and the position correction in one step. Build the snap context once
    // and reuse it for both endpoints so we don't re-traverse the moved
    // group's bbox for every call.
    const snapCtx = buildRotationSnapContext(movedGroup, piecesById, rotDelta);
    const movedStart = getWorldPositionAfterRotationSnap(
        movedEdge.start, movedPiece.id, movedGroup, snapCtx,
    );
    const movedEnd = getWorldPositionAfterRotationSnap(
        movedEdge.end, movedPiece.id, movedGroup, snapCtx,
    );

    // World positions of the target edge endpoints
    // Mate edges run in opposite directions: start↔end are swapped
    const targetStart = getWorldPosition(targetEdge.start, targetPiece.id, targetGroup);
    const targetEnd = getWorldPosition(targetEdge.end, targetPiece.id, targetGroup);

    // Check alignment: movedStart should align with targetEnd,
    // and movedEnd should align with targetStart
    const dist1 = distance(movedStart, targetEnd);
    const dist2 = distance(movedEnd, targetStart);

    const avgDist = (dist1 + dist2) / 2;

    if (avgDist > tolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }

    // Compute snap delta: how much to move the moved group
    // to achieve perfect alignment.
    // We use the start↔end pair for the correction.
    const snapDelta: Point = {
        x: targetEnd.x - movedStart.x,
        y: targetEnd.y - movedStart.y,
    };

    return { aligned: true, snapDelta };
}

/**
 * Detect all merge candidates for a dropped group.
 *
 * Checks every border edge of the moved group against its mate.
 * Returns all edge pairs that are within merge tolerance.
 *
 * Note: returns ALL candidates, not just the closest. The caller
 * (group merging, task 4.2) decides how to handle multiple merges
 * (cascading).
 */
export function detectMerges(
    movedGroupId: number,
    state: GameState,
    tolerance: number = MERGE_TOLERANCE_PX,
    rotationTolerance: number = MERGE_ROTATION_TOLERANCE_DEG,
): MergeCandidate[] {
    const movedGroup = tryGetGroup(state, movedGroupId);
    if (!movedGroup) {
        return [];
    }

    const borderEdges = getBorderEdges(movedGroup, state);
    const candidates: MergeCandidate[] = [];

    for (const border of borderEdges) {
        const result = checkEdgeAlignment(
            border.piece,
            border.edge,
            movedGroup,
            border.matePiece,
            border.mateEdge,
            border.mateGroup,
            state.piecesById,
            tolerance,
            rotationTolerance,
        );

        if (result.aligned) {
            candidates.push({
                movedGroup,
                targetGroup: border.mateGroup,
                movedPiece: border.piece,
                movedEdge: border.edge,
                targetPiece: border.matePiece,
                targetEdge: border.mateEdge,
                snapDelta: result.snapDelta,
            });
        }
    }

    return candidates;
}
