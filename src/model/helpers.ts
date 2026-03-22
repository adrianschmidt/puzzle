/**
 * Helper functions for the puzzle data model.
 *
 * These operate on the generic graph-based model
 * and know nothing about grids or specific puzzle shapes.
 */

import type { Edge, Piece, PieceGroup } from './types.js';

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
