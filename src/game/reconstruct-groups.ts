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

import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import { buildGroupIndexes } from '../model/helpers.js';

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

            // mateId is in `want`, and every id in `want` was validated
            // against `byId` at function entry, so this lookup can't miss.
            const mate = byId.get(mateId)!;
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

export interface ProgressInput {
    m: number[][];
    mr?: number[];
    sr?: number[];
}

export function applyProgress(state: GameState, progress: ProgressInput): boolean {
    // Validate every merge first so we can abort without mutating state.
    const reconstructed: Array<Map<number, Point>> = [];
    const absorbedIds = new Set<number>();
    for (const ids of progress.m) {
        if (ids.length < 2) return false;
        const offsets = computeMergedOffsets(state.pieces, ids);
        if (!offsets) return false;
        for (const id of ids) absorbedIds.add(id);
        reconstructed.push(offsets);
    }

    let idCursor = Math.max(0, ...state.groups.map((g) => g.id)) + 1;

    // Remove solo groups that are being absorbed into merges.
    state.groups = state.groups.filter((g) => {
        if (g.pieces.size !== 1) return true;
        const [only] = g.pieces.keys();
        return !absorbedIds.has(only);
    });

    // Push each reconstructed merged group.
    reconstructed.forEach((offsets, idx) => {
        // Wire format is quarter-turn integer (v: 1); convert to degrees.
        const rotation = (progress.mr?.[idx] ?? 0) * 90;
        const group: PieceGroup = {
            id: idCursor++,
            pieces: offsets,
            position: { x: 0, y: 0 }, // gatherAndZoomToFit re-lays-out after this.
            rotation,
        };
        state.groups.push(group);
    });

    // Rebuild indexes wholesale — easiest after a filter+push reshuffle.
    const indexes = buildGroupIndexes(state.groups);
    state.groupsById = indexes.groupsById;
    state.pieceToGroup = indexes.pieceToGroup;

    // Apply solo rotations.
    if (progress.sr && progress.sr.length >= 2) {
        for (let i = 0; i + 1 < progress.sr.length; i += 2) {
            const pid = progress.sr[i];
            // Wire format is quarter-turn integer (v: 1); convert to degrees.
            const rot = (progress.sr[i + 1] ?? 0) * 90;
            const g = state.pieceToGroup.get(pid);
            if (g && g.pieces.size === 1) g.rotation = rot;
        }
    }

    return true;
}
