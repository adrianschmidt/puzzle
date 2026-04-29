/**
 * Helper functions for the puzzle data model.
 *
 * These operate on the generic graph-based model
 * and know nothing about grids or specific puzzle shapes.
 */

import type { Edge, Piece, PieceGroup, Point } from './types.js';

/**
 * Look up the pieces array by id.
 * Throws if the piece is not found.
 */
function findPiece(pieces: Piece[], pieceId: number): Piece {
    const piece = pieces.find((p) => p.id === pieceId);

    if (!piece) {
        throw new Error(`Piece ${pieceId} not found`);
    }

    return piece;
}

/**
 * Find the mate edge for a given piece's edge.
 *
 * Returns the mate piece and its corresponding edge,
 * or `undefined` if the edge is a border edge (no mate).
 */
export function getMateEdge(
    _piece: Piece,
    edge: Edge,
    pieces: Piece[],
): { piece: Piece; edge: Edge } | undefined {
    if (edge.matePieceId === -1 || edge.mateEdgeId === -1) {
        return undefined;
    }

    const matePiece = findPiece(pieces, edge.matePieceId);
    const mateEdge = matePiece.edges.find((e) => e.id === edge.mateEdgeId);

    if (!mateEdge) {
        throw new Error(
            `Mate edge ${edge.mateEdgeId} not found on piece ${matePiece.id}`,
        );
    }

    return { piece: matePiece, edge: mateEdge };
}

/**
 * Find the group that contains a given piece.
 * Throws if the piece is not in any group.
 */
export function findGroupForPiece(
    pieceId: number,
    groups: PieceGroup[],
): PieceGroup {
    const group = groups.find((g) => g.pieces.has(pieceId));

    if (!group) {
        throw new Error(`Piece ${pieceId} is not in any group`);
    }

    return group;
}

/**
 * Move a group by a delta, mutating its position in place.
 */
export function moveGroup(
    group: PieceGroup,
    delta: Point,
): void {
    group.position = {
        x: group.position.x + delta.x,
        y: group.position.y + delta.y,
    };
}

/**
 * Rotate a point by `quarterTurns` 90°-clockwise steps around the origin.
 *
 * Used for converting between a group's un-rotated local space and
 * its rotated world projection. `quarterTurns` must be 0, 1, 2, or 3.
 */
export function rotatePoint(point: Point, quarterTurns: 0 | 1 | 2 | 3): Point {
    switch (quarterTurns) {
        case 0: return { x: point.x, y: point.y };
        case 1: return { x: -point.y, y: point.x };
        case 2: return { x: -point.x, y: -point.y };
        case 3: return { x: point.y, y: -point.x };
    }
}

/**
 * Normalise a signed/unbounded quarter-turn count into the range 0..3.
 */
export function normaliseQuarterTurns(q: number): 0 | 1 | 2 | 3 {
    return (((q % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

/**
 * Project a point from a group's un-rotated local space into world space.
 *
 * Applies `group.rotation` around the group's own origin, then translates
 * by `group.position`. The input is assumed to already be in the group's
 * piece-offset frame (so for points expressed relative to a specific piece,
 * use `getWorldPosition` instead, which adds the piece offset first).
 */
export function localToWorld(local: Point, group: PieceGroup): Point {
    const rotated = rotatePoint(local, group.rotation);

    return {
        x: group.position.x + rotated.x,
        y: group.position.y + rotated.y,
    };
}

/**
 * Compute the world position of a point on a piece.
 *
 * Piece offsets and edge endpoints live in the group's un-rotated local
 * space. The point is shifted by the piece's offset within the group, then
 * projected to world space via `localToWorld`.
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

    return localToWorld(
        { x: offset.x + point.x, y: offset.y + point.y },
        group,
    );
}

/**
 * Get all border edges of a group — edges whose mates
 * are in a different group.
 *
 * These are the candidates for merge detection after a drop.
 * Each result includes the piece and edge within the group,
 * plus the mate piece and edge in the other group.
 */
export function getBorderEdges(
    group: PieceGroup,
    pieces: Piece[],
    allGroups: PieceGroup[],
): Array<{
    piece: Piece;
    edge: Edge;
    matePiece: Piece;
    mateEdge: Edge;
    mateGroup: PieceGroup;
}> {
    const results: Array<{
        piece: Piece;
        edge: Edge;
        matePiece: Piece;
        mateEdge: Edge;
        mateGroup: PieceGroup;
    }> = [];

    for (const pieceId of group.pieces.keys()) {
        const piece = findPiece(pieces, pieceId);

        for (const edge of piece.edges) {
            const mate = getMateEdge(piece, edge, pieces);

            if (!mate) {
                continue; // border edge of the puzzle itself
            }

            // Is the mate in a different group?
            const mateGroup = findGroupForPiece(mate.piece.id, allGroups);

            if (mateGroup.id !== group.id) {
                results.push({
                    piece,
                    edge,
                    matePiece: mate.piece,
                    mateEdge: mate.edge,
                    mateGroup,
                });
            }
        }
    }

    return results;
}
