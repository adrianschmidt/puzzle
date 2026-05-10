/**
 * Deterministic auto-grouping for small pieces.
 *
 * Pieces below `minArea` are merged with a neighbour via union-find,
 * producing a list of "starting groups" that the caller turns into
 * actual `PieceGroup`s with positions and offsets. This module is a
 * pure topological utility: it knows nothing about geometry, the PRNG,
 * or `Piece`/`Edge` types — just piece ids, areas, and adjacency.
 *
 * **Determinism is load-bearing.** Share-link reproducibility depends
 * on the topology generator producing the same output for the same
 * inputs. This function does not consume the PRNG, but its iteration
 * order and tie-breaking must be stable:
 *
 *   - pieces are processed in (area asc, id asc) order
 *   - among candidate neighbours, the largest group wins; on ties the
 *     lowest root id wins
 *   - within each group, piece ids are sorted ascending
 *
 * Replaces the legacy `mergeSmallFaces` rescue logic, which mutated
 * the DCEL in-place. Auto-grouping leaves the topology untouched and
 * lets the gameplay layer present the small pieces as a glued unit.
 */

/**
 * Inputs to the auto-grouping pass. The caller is responsible for
 * computing piece areas and the adjacency graph from the DCEL.
 */
export interface AutoGroupContext {
    /** All piece ids, in any order (the algorithm sorts internally). */
    pieceIds: number[];
    /** pieceId → polygon area (px²). */
    areas: Map<number, number>;
    /** pieceId → set of adjacent piece ids (symmetric). */
    neighbours: Map<number, Set<number>>;
}

/**
 * A starting group of pieces emitted by `autoGroupSmallPieces`.
 *
 * The group `id` is the smallest piece id in the group (the
 * union-find root, by construction). `pieceIds` is sorted ascending
 * so test output and downstream layout are stable.
 *
 * This intermediate type is intentionally narrower than
 * `PieceGroup` from `model/types`: positioning (offsets, world
 * position, rotation) is the caller's concern.
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

    // Process pieces smallest-first so cascades resolve in a single
    // pass: a tiny piece next to another tiny piece will see the
    // already-merged group of its neighbour by the time we get to it.
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
