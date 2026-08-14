/**
 * Pure topological utility — piece ids, areas, adjacency only (no
 * geometry/PRNG/`Piece` types).
 *
 * **Determinism is load-bearing** (share-link reproducibility): this
 * doesn't consume the PRNG, but its order and tie-breaking must stay stable:
 *   - pieces processed in (area asc, id asc) order
 *   - largest neighbour group wins; ties -> lowest root id
 *   - piece ids within a group sorted ascending
 *
 * Leaves the topology untouched; the gameplay layer presents the small
 * pieces as a glued unit rather than folding faces into the DCEL.
 */

export interface AutoGroupContext {
    /** Any order; the algorithm sorts internally. */
    pieceIds: number[];
    /** pieceId → polygon area (px²). */
    areas: Map<number, number>;
    /** pieceId → set of adjacent piece ids (symmetric). */
    neighbours: Map<number, Set<number>>;
}

/**
 * `id` is the group's smallest piece id (the union-find root); `pieceIds`
 * is sorted ascending for stable output/layout. Narrower than `PieceGroup`
 * (model/types) — positioning is the caller's concern.
 */
export interface AutoGroup {
    id: number;
    pieceIds: number[];
}

export function autoGroupSmallPieces(
    ctx: AutoGroupContext,
    minArea: number,
): AutoGroup[] {
    const parent = new Map<number, number>();
    const groupArea = new Map<number, number>();
    for (const id of ctx.pieceIds) {
        parent.set(id, id);
        groupArea.set(id, ctx.areas.get(id)!);
    }

    function find(x: number): number {
        let r = x;
        while (parent.get(r)! !== r) r = parent.get(r)!;
        return r;
    }
    function union(a: number, b: number): void {
        const ra = find(a), rb = find(b);
        if (ra === rb) return;
        // Smaller id always wins so the resulting root is predictable.
        const winner = Math.min(ra, rb);
        const loser = ra === winner ? rb : ra;
        parent.set(loser, winner);
        groupArea.set(winner, groupArea.get(winner)! + groupArea.get(loser)!);
    }

    // Smallest-first so cascades resolve in one pass: a tiny piece sees
    // its neighbour's already-merged group by the time we reach it.
    const sorted = [...ctx.pieceIds].sort((a, b) => {
        const da = ctx.areas.get(a)! - ctx.areas.get(b)!;
        return da !== 0 ? da : a - b;
    });

    for (const id of sorted) {
        const root = find(id);
        if (groupArea.get(root)! >= minArea) continue;
        let bestRoot = -1, bestArea = -1;
        for (const nid of ctx.neighbours.get(id) ?? []) {
            const nroot = find(nid);
            if (nroot === root) continue;
            const a = groupArea.get(nroot)!;
            if (a > bestArea || (a === bestArea && nroot < bestRoot)) {
                bestArea = a;
                bestRoot = nroot;
            }
        }
        if (bestRoot < 0) continue;
        union(root, bestRoot);
    }

    const byRoot = new Map<number, number[]>();
    for (const id of ctx.pieceIds) {
        const r = find(id);
        if (!byRoot.has(r)) byRoot.set(r, []);
        byRoot.get(r)!.push(id);
    }
    return [...byRoot.entries()].map(([rootId, pieceIds]) => ({
        id: rootId,
        pieceIds: pieceIds.sort((a, b) => a - b),
    }));
}
