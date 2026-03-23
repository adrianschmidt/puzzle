/**
 * Merge detection — determines whether edges of a dropped group
 * align closely enough with their mates to trigger a merge.
 *
 * The core mechanic: pieces merge when their matching edges are
 * placed within tolerance of perfect alignment, regardless of
 * where they are on the table.
 */

import type { Edge, GameState, Piece, PieceGroup, Point } from '../model/types.js';
import { getBorderEdges } from '../model/helpers.js';

/**
 * Tolerance in pixels for edge alignment.
 * If the actual distance between matching edge endpoints is within
 * this threshold, the pieces are considered aligned and will merge.
 */
export const MERGE_TOLERANCE_PX = 18;

/**
 * Tolerance in degrees for rotation alignment.
 * Both groups must have the same rotation (within this tolerance)
 * for their edges to be considered aligned.
 */
export const ROTATION_TOLERANCE_DEG = 5;

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
 * Rotate a point around the origin by a given angle in degrees.
 */
function rotatePoint(point: Point, angleDeg: number): Point {
    if (angleDeg === 0) return point;

    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    return {
        x: point.x * cos - point.y * sin,
        y: point.x * sin + point.y * cos,
    };
}

/**
 * Compute the world position of a point on a piece, accounting for group rotation.
 *
 * The local coordinates (piece offset + point) are rotated around the group's
 * anchor (origin) by the group's rotation angle, then translated by the group position.
 */
export function getWorldPosition(
    point: Point,
    pieceId: number,
    group: PieceGroup,
): Point {
    const offset = group.pieces.get(pieceId);
    if (!offset) {
        throw new Error(`Piece ${pieceId} not found in group ${group.id}`);
    }

    // Local position relative to group anchor
    const local: Point = {
        x: offset.x + point.x,
        y: offset.y + point.y,
    };

    // Apply group rotation around the anchor
    const rotated = rotatePoint(local, group.rotation);

    return {
        x: group.position.x + rotated.x,
        y: group.position.y + rotated.y,
    };
}

/**
 * Normalize an angle to the range [0, 360).
 */
export function normalizeAngle(angle: number): number {
    return ((angle % 360) + 360) % 360;
}

/**
 * Check if two rotation angles are within tolerance of each other.
 */
export function rotationsMatch(
    rotA: number,
    rotB: number,
    tolerance: number = ROTATION_TOLERANCE_DEG,
): boolean {
    const diff = normalizeAngle(rotA - rotB);
    return diff <= tolerance || diff >= 360 - tolerance;
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
 * - Both groups have the same rotation (within ROTATION_TOLERANCE_DEG)
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
    tolerance: number = MERGE_TOLERANCE_PX,
): { aligned: boolean; snapDelta: Point } {
    // Rotation must match for edges to align
    if (!rotationsMatch(movedGroup.rotation, targetGroup.rotation)) {
        return { aligned: false, snapDelta: { x: 0, y: 0 } };
    }
    // World positions of the moved edge endpoints
    const movedStart = getWorldPosition(movedEdge.start, movedPiece.id, movedGroup);
    const movedEnd = getWorldPosition(movedEdge.end, movedPiece.id, movedGroup);

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
): MergeCandidate[] {
    const movedGroup = state.groups.find((g) => g.id === movedGroupId);
    if (!movedGroup) {
        return [];
    }

    const borderEdges = getBorderEdges(movedGroup, state.pieces, state.groups);
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
