/**
 * Pieces merge when their matching edges are placed within tolerance of
 * perfect alignment, regardless of where they are on the table.
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

/** Tolerance in pixels for edge alignment. */
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

export interface MergeCandidate {
    movedGroup: PieceGroup;
    targetGroup: PieceGroup;
    movedPiece: Piece;
    movedEdge: Edge;
    targetPiece: Piece;
    targetEdge: Edge;
    /**
     * The positional correction needed to snap the moved group
     * into perfect alignment with the target group for this edge pair.
     */
    snapDelta: Point;
}

export function pieceCenterLocal(group: PieceGroup, piece: Piece): Point {
    const offset = group.pieces.get(piece.id);
    if (!offset) throw new Error(`Piece ${piece.id} not in group ${group.id}`);
    return {
        x: offset.x + (piece.bounds.minX + piece.bounds.maxX) / 2,
        y: offset.y + (piece.bounds.minY + piece.bounds.maxY) / 2,
    };
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
    /** Rotation pivot in un-rotated group-local space — the moved candidate piece's center. */
    pivotLocal: Point;
    /** World-space pivot, fixed during the snap. */
    worldPivot: Point;
    /** Group rotation after applying the snap delta, normalized to [0, 360). */
    newRotation: number;
}

function buildRotationSnapContext(
    group: PieceGroup,
    extraDeg: number,
    pivotLocal: Point,
): RotationSnapContext {
    return {
        pivotLocal,
        worldPivot: localToWorld(pivotLocal, group),
        newRotation: normalizeDegrees(group.rotation + extraDeg),
    };
}

/**
 * World position of a piece-local point AS IF the group had been rotated
 * by `extraDeg` around the given pivot — the way `rotateGroup` performs a
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

    const offsetFromPivot = {
        x: localInGroup.x - snapCtx.pivotLocal.x,
        y: localInGroup.y - snapCtx.pivotLocal.y,
    };
    const rotated = rotatePoint(offsetFromPivot, snapCtx.newRotation);
    return {
        x: snapCtx.worldPivot.x + rotated.x,
        y: snapCtx.worldPivot.y + rotated.y,
    };
}

function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Raw alignment measurement for a pair of mate edges — the single source
 * of truth shared by merge detection (thresholding on drop) and snap
 * proximity rotation (progressive rotation during drag).
 *
 * `distance` is measured AFTER simulating the rotation snap the merge
 * would perform, so it reflects how far the moved group is from its
 * snapped placement, not from its current-orientation overlap.
 */
export interface EdgeAlignmentMeasurement {
    /** Signed degrees the moved group must rotate to match the target (wrap-aware). */
    rotationDelta: number;
    /** Average distance between mate endpoints after the simulated rotation snap. */
    distance: number;
    /** Positional correction to perfect alignment (after the rotation snap). */
    snapDelta: Point;
}

/**
 * Measure how well a moved edge aligns with its mate, without applying
 * any tolerance.
 *
 * The simulated snap pivots on the MOVED PIECE's center, not the group's
 * bbox center, so a flush edge measures flush no matter how large the
 * group is (issue #530). `mergeGroups` must apply the real snap around
 * the same pivot or `snapDelta` lands the group elsewhere.
 */
export function measureEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
): EdgeAlignmentMeasurement {
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);

    const snapCtx = Math.abs(rotDelta) < SNAP_EPSILON_DEG
        ? null
        : buildRotationSnapContext(
            movedGroup, rotDelta, pieceCenterLocal(movedGroup, movedPiece),
        );
    const movedStart = getWorldPositionAfterRotationSnap(
        movedEdge.start, movedPiece.id, movedGroup, snapCtx,
    );
    const movedEnd = getWorldPositionAfterRotationSnap(
        movedEdge.end, movedPiece.id, movedGroup, snapCtx,
    );

    // Mate edges run in opposite directions: start↔end are swapped.
    const targetStart = getWorldPosition(targetEdge.start, targetPiece.id, targetGroup);
    const targetEnd = getWorldPosition(targetEdge.end, targetPiece.id, targetGroup);

    const dist1 = distance(movedStart, targetEnd);
    const dist2 = distance(movedEnd, targetStart);

    return {
        rotationDelta: rotDelta,
        distance: (dist1 + dist2) / 2,
        snapDelta: {
            x: targetEnd.x - movedStart.x,
            y: targetEnd.y - movedStart.y,
        },
    };
}

export function checkEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
    tolerance: number = MERGE_TOLERANCE_PX,
    rotationTolerance: number = MERGE_ROTATION_TOLERANCE_DEG,
): { aligned: boolean; snapDelta: Point } {
    const m = measureEdgeAlignment(
        movedPiece, movedEdge, movedGroup,
        targetPiece, targetEdge, targetGroup,
    );

    // Two groups can only mate when their rotations are close enough.
    // Exact equality is no longer required: in free-rotation mode the
    // tolerance window lets the player land near the correct orientation
    // and still trigger a merge. In quarter-turn mode the delta is always
    // 0, so the tolerance is a no-op and behavior is unchanged.
    if (Math.abs(m.rotationDelta) > rotationTolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }
    if (m.distance > tolerance) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }
    return { aligned: true, snapDelta: m.snapDelta };
}

/**
 * Returns ALL candidates, not just the closest — the caller decides how
 * to handle multiple merges (cascading).
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
