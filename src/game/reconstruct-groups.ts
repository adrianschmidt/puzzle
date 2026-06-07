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

    // Remove any starting group whose pieces are about to be replaced by a
    // reconstructed merged group. Pre-Plan-3 only solo groups could be
    // absorbed; post-Plan-3, multi-piece auto-groups can be absorbed too —
    // `extractProgress` emits every group with size>=2 into `pr.m`, so the
    // receiver sees auto-groups in `m` and would otherwise end up with both
    // the starting auto-group and the reconstructed merge containing the
    // same pieces (last-write-wins on `pieceToGroup` then corrupts state).
    //
    // Partial absorption is unreachable here: starting groups partition all
    // pieces, and any user merge that touches an auto-grouped piece on the
    // sender already contains the entire auto-group, so its `m` entry lists
    // every piece in the absorbed starting group. `computeMergedOffsets`
    // also rejects disconnected piece sets, providing a second safety net.
    state.groups = state.groups.filter((g) => {
        for (const pid of g.pieces.keys()) {
            if (absorbedIds.has(pid)) return false;
        }
        return true;
    });

    // When rotationMode is 'free', mr/sr carry integer degrees 0..359 directly.
    // When rotationMode is 'quarter-turn', they carry 0..3 quarter-turn counts
    // that must be multiplied by 90 to get degrees (existing wire format).
    const isFree = state.rotationMode === 'free';

    // Push each reconstructed merged group.
    reconstructed.forEach((offsets, idx) => {
        const wireValue = progress.mr?.[idx] ?? 0;
        // Wire format is quarter-turn integer (v: 1); convert to degrees.
        // For free mode the wire value is already in degrees — normalize
        // into [0, 360) to mirror the encoder side and clamp any
        // out-of-range values from a hand-crafted link.
        const rotation = isFree ? normalizeDegrees(wireValue) : wireValue * 90;
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
            const wireValue = progress.sr[i + 1] ?? 0;
            // Wire format is quarter-turn integer (v: 1); convert to degrees.
            // Free-mode wire values get normalized to [0, 360) to mirror
            // the encoder.
            const rot = isFree ? normalizeDegrees(wireValue) : wireValue * 90;
            const g = state.pieceToGroup.get(pid);
            if (g && g.pieces.size === 1) g.rotation = rot;
        }
    }

    return true;
}
