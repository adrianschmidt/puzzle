/**
 * Offsets are relative to the group anchor (piece 0). Mated edges run in
 * opposite directions, so `edge.start` meets the neighbor's `mateEdge.end`.
 */

import type { GameState, Piece, PieceGroup, Point } from '../model/types.js';
import { buildGroupIndexes, normalizeDegrees } from '../model/helpers.js';

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

            // Safe: every `want` id was validated against `byId` at entry.
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

    // Remove any starting group whose pieces are absorbed by a reconstructed
    // merge; otherwise both the starting auto-group and the merge would hold
    // the same pieces and last-write-wins on `pieceToGroup` corrupts state.
    // Partial absorption is unreachable: a merge touching an auto-grouped piece
    // already lists the whole auto-group, and `computeMergedOffsets` rejects
    // disconnected sets.
    state.groups = state.groups.filter((g) => {
        for (const pid of g.pieces.keys()) {
            if (absorbedIds.has(pid)) return false;
        }
        return true;
    });

    // Wire format: 'free' carries degrees 0..359 directly; 'quarter-turn'
    // carries 0..3 counts that ×90 give degrees.
    const isFree = state.rotationMode === 'free';

    reconstructed.forEach((offsets, idx) => {
        const wireValue = progress.mr?.[idx] ?? 0;
        // Free values are normalized to [0, 360) to mirror the encoder and
        // clamp out-of-range values from a hand-crafted link.
        const rotation = isFree ? normalizeDegrees(wireValue) : wireValue * 90;
        const group: PieceGroup = {
            id: idCursor++,
            pieces: offsets,
            position: { x: 0, y: 0 }, // gatherAndZoomToFit re-lays-out after this.
            rotation,
        };
        state.groups.push(group);
    });

    const indexes = buildGroupIndexes(state.groups);
    state.groupsById = indexes.groupsById;
    state.pieceToGroup = indexes.pieceToGroup;

    if (progress.sr && progress.sr.length >= 2) {
        for (let i = 0; i + 1 < progress.sr.length; i += 2) {
            const pid = progress.sr[i];
            const wireValue = progress.sr[i + 1] ?? 0;
            // Free values normalized to [0, 360) to mirror the encoder.
            const rot = isFree ? normalizeDegrees(wireValue) : wireValue * 90;
            const g = state.pieceToGroup.get(pid);
            if (g && g.pieces.size === 1) g.rotation = rot;
        }
    }

    return true;
}
