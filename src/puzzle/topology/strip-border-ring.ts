/**
 * On an oversized grid (the sine generator's borderless mode adds one piece
 * on each side), every piece that has a border edge (`matePieceId === -1`)
 * is exactly the 1-deep outer ring. The survivors' baked `shape` and each
 * edge's `path` are left untouched, so an exposed edge keeps the inward tab
 * it used to share with a removed ring piece — that is the whole point of
 * borderless mode.
 *
 * Consumes no randomness, so it can run after the generator without
 * perturbing the seeded PRNG stream.
 */

import type { GeneratedPiece } from '../../model/types.js';
import type { AutoGroup } from './auto-group.js';

export interface StripResult {
    pieces: GeneratedPiece[];
    autoGroups: AutoGroup[];
}

function hasBorderEdge(piece: GeneratedPiece): boolean {
    return piece.edges.some((e) => e.matePieceId === -1);
}

/**
 * @param pieces - the full (oversized) piece set
 * @param autoGroups - groups that fall below two members after pruning are
 *   dropped (a one-piece group is just a solo piece)
 */
export function stripBorderRing(
    pieces: GeneratedPiece[],
    autoGroups: AutoGroup[],
): StripResult {
    const removedIds = new Set<number>();
    for (const piece of pieces) {
        if (hasBorderEdge(piece)) removedIds.add(piece.id);
    }

    const survivors: GeneratedPiece[] = [];
    for (const piece of pieces) {
        if (removedIds.has(piece.id)) continue;
        const edges = piece.edges.map((e) =>
            removedIds.has(e.matePieceId)
                ? { ...e, mateEdgeId: -1, matePieceId: -1 }
                : e,
        );
        survivors.push({ ...piece, edges });
    }

    const reconciled: AutoGroup[] = [];
    for (const group of autoGroups) {
        const pieceIds = group.pieceIds.filter((id) => !removedIds.has(id));
        if (pieceIds.length >= 2) reconciled.push({ ...group, pieceIds });
    }

    return { pieces: survivors, autoGroups: reconciled };
}
