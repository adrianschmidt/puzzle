/**
 * Rebuild merged-group layouts from piece-ID lists (used when loading
 * a shared puzzle that includes progress).
 *
 * Given a list of piece IDs that should be merged, walk the edge graph
 * BFS-style to compute each piece's offset relative to the group anchor
 * (piece 0 in the list). The mate-edge math mirrors the live merge flow:
 * mated edges run in opposite directions, so `edge.start` on this piece
 * meets `mateEdge.end` on the neighbour.
 */

import type { Piece, Point } from '../model/types.js';

export function computeMergedOffsets(
    pieces: Piece[],
    pieceIds: number[],
): Map<number, Point> | null {
    if (pieceIds.length === 0) return null;

    const byId = new Map<number, Piece>();
    for (const p of pieces) byId.set(p.id, p);

    const want = new Set(pieceIds);
    for (const id of pieceIds) {
        if (!byId.has(id)) return null;
    }

    const offsets = new Map<number, Point>();
    const queue: number[] = [];
    const anchorId = pieceIds[0];
    offsets.set(anchorId, { x: 0, y: 0 });
    queue.push(anchorId);

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const current = byId.get(currentId)!;
        const currentOffset = offsets.get(currentId)!;

        for (const edge of current.edges) {
            const mateId = edge.matePieceId;
            if (mateId < 0) continue;
            if (!want.has(mateId)) continue;
            if (offsets.has(mateId)) continue;

            const mate = byId.get(mateId);
            if (!mate) return null;
            const mateEdge = mate.edges.find((e) => e.id === edge.mateEdgeId);
            if (!mateEdge) return null;

            // Align edge.start (on current) with mateEdge.end (on mate):
            //     currentOffset + edge.start === mateOffset + mateEdge.end
            const mateOffset: Point = {
                x: currentOffset.x + edge.start.x - mateEdge.end.x,
                y: currentOffset.y + edge.start.y - mateEdge.end.y,
            };
            offsets.set(mateId, mateOffset);
            queue.push(mateId);
        }
    }

    if (offsets.size !== want.size) return null;
    return offsets;
}
