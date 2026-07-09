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
    precomputedCenterLocal?: Point,
): RotationSnapContext | null {
    if (Math.abs(extraDeg) < SNAP_EPSILON_DEG) return null;
    let centerLocal = precomputedCenterLocal;
    if (!centerLocal) {
        const bounds = getGroupLocalBounds(group, piecesById);
        centerLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
    }
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
 * any tolerance. Pass `movedCenterLocal` (the moved group's bbox center
 * in un-rotated local space) to skip the per-call bounds traversal when
 * calling repeatedly for the same group — e.g. once per candidate per
 * animation frame during a drag.
 */
export function measureEdgeAlignment(
    movedPiece: Piece,
    movedEdge: Edge,
    movedGroup: PieceGroup,
    targetPiece: Piece,
    targetEdge: Edge,
    targetGroup: PieceGroup,
    piecesById: ReadonlyMap<number, Readonly<Piece>>,
    movedCenterLocal?: Point,
): EdgeAlignmentMeasurement {
    const rotDelta = signedAngularDelta(targetGroup.rotation, movedGroup.rotation);

    const snapCtx = buildRotationSnapContext(
        movedGroup, piecesById, rotDelta, movedCenterLocal,
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
    const m = measureEdgeAlignment(
        movedPiece, movedEdge, movedGroup,
        targetPiece, targetEdge, targetGroup,
        piecesById,
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
