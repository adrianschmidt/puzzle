/**
 * Borderless post-pass — strip the outer ring of pieces.
 *
 * On an oversized grid (the sine generator's borderless mode adds one piece
 * on each side), every piece that has a border edge (`matePieceId === -1`)
 * is exactly the 1-deep outer ring. This removes that ring, then re-marks
 * the now-exposed edges of the surviving pieces as border edges. The
 * survivors' baked `shape` and each edge's `path` are left untouched, so an
 * exposed edge keeps the inward tab it used to share with a removed ring
 * piece — that is the whole point of borderless mode.
 *
 * Pure and deterministic — it consumes no randomness — so it can run after
 * the generator without perturbing the seeded PRNG stream.
 */

import type { Piece } from '../../model/types.js';
import type { AutoGroup } from './auto-group.js';

export interface StripResult {
    pieces: Piece[];
    autoGroups: AutoGroup[];
}

/** A piece is on the border ring iff any of its edges has no mate. */
function hasBorderEdge(piece: Piece): boolean {
    return piece.edges.some((e) => e.matePieceId === -1);
}

/**
 * Remove the outer ring and re-mark exposed survivor edges as borders.
 *
 * @param pieces - the full (oversized) piece set
 * @param autoGroups - starting groups from the auto-group pass; references
 *   to removed pieces are pruned and groups that fall below two members are
 *   dropped (a one-piece group is just a solo piece)
 */
export function stripBorderRing(
    pieces: Piece[],
    autoGroups: AutoGroup[],
): StripResult {
    const removedIds = new Set<number>();
    for (const piece of pieces) {
        if (hasBorderEdge(piece)) removedIds.add(piece.id);
    }

    const survivors: Piece[] = [];
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
