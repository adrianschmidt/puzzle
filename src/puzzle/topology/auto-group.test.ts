import { describe, it, expect } from 'vitest';
import { autoGroupSmallPieces } from './auto-group.js';
import type { AutoGroupContext } from './auto-group.js';

describe('autoGroupSmallPieces', () => {
    it('returns a single group per piece when no piece is below threshold', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 100 }, { id: 2, area: 100 }],
            [[0, 1], [1, 2]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        expect(groups).toHaveLength(3);
        for (const g of groups) {
            expect(g.pieceIds).toHaveLength(1);
        }
    });

    it('groups a small piece with its largest neighbour', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 5 }, { id: 2, area: 200 }],
            [[0, 1], [1, 2]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        expect(groups).toHaveLength(2);
        const grouped = groups.find(g => g.pieceIds.includes(1))!;
        expect(grouped.pieceIds).toContain(2);   // joined with the larger neighbour
        expect(grouped.pieceIds).not.toContain(0);
    });

    it('tie-breaks by lowest piece id when neighbours are equal', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 5 }, { id: 2, area: 100 }],
            [[0, 1], [1, 2]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        const grouped = groups.find(g => g.pieceIds.includes(1))!;
        expect(grouped.pieceIds).toContain(0);   // lowest id wins
        expect(grouped.pieceIds).not.toContain(2);
    });

    it('cascades: two adjacent tiny pieces collapse into one neighbour', () => {
        const ctx = makeCtx(
            [{ id: 0, area: 100 }, { id: 1, area: 5 }, { id: 2, area: 5 }, { id: 3, area: 100 }],
            [[0, 1], [1, 2], [2, 3]],
        );
        const groups = autoGroupSmallPieces(ctx, 50);
        expect(groups).toHaveLength(2);
    });
});

function makeCtx(
    pieces: { id: number; area: number }[],
    edges: [number, number][],
): AutoGroupContext {
    const areas = new Map(pieces.map(p => [p.id, p.area]));
    const neighbours = new Map<number, Set<number>>();
    for (const p of pieces) neighbours.set(p.id, new Set());
    for (const [a, b] of edges) {
        neighbours.get(a)!.add(b);
        neighbours.get(b)!.add(a);
    }
    return {
        pieceIds: pieces.map(p => p.id),
        areas,
        neighbours,
    };
}
