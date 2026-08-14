/**
 * The frame piece's hole (where the circle component sits) is emitted
 * as a second loop on the flat `edges` list.
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';
import type { Edge } from '../../model/types.js';

const CONFIG = {
    baseCutGenerator: 'venn',
    baseCutConfig: {
        leftCenter: { x: 240, y: 200 },
        leftRadius: 120,
        rightCenter: { x: 360, y: 200 },
        rightRadius: 120,
    },
    tabGenerator: 'none',
    tabConfig: {},
};

function countLoops(edges: Edge[]): number {
    if (edges.length === 0) return 0;
    let loops = 1;
    for (let i = 1; i < edges.length; i++) {
        const prev = edges[i - 1];
        const cur = edges[i];
        if (Math.abs(prev.end.x - cur.start.x) > 0.5
            || Math.abs(prev.end.y - cur.start.y) > 0.5) {
            loops++;
        }
    }
    return loops;
}

describe('composable: two-circle Venn', () => {
    it('produces 4 pieces — frame, two crescents, lens', () => {
        const { pieces } = generateComposablePuzzle(
            1, 1, { width: 600, height: 400 }, 42, CONFIG,
        );
        expect(pieces).toHaveLength(4);
    });

    it('exactly one piece has two loops (the frame, with the circle component as a hole)', () => {
        const { pieces } = generateComposablePuzzle(
            1, 1, { width: 600, height: 400 }, 42, CONFIG,
        );
        const multiLoop = pieces.filter(p => countLoops(p.edges) > 1);
        expect(multiLoop).toHaveLength(1);
        expect(countLoops(multiLoop[0].edges)).toBe(2);
    });

    it('the frame piece is interactively merge-able with its inner-boundary mates', () => {
        const { pieces } = generateComposablePuzzle(
            1, 1, { width: 600, height: 400 }, 42, CONFIG,
        );
        const frame = pieces.find(p => countLoops(p.edges) > 1)!;
        // "At least one": the frame's outer boundary is unmated border, the lens
        // shares no edges with the frame — only crescents mate the inner boundary.
        const matedFrameEdges = frame.edges.filter(
            e => e.matePieceId !== -1 && e.mateEdgeId !== -1,
        );
        expect(matedFrameEdges.length).toBeGreaterThan(0);
    });

    it('does not auto-group pieces — all four pieces are independent starting groups', () => {
        // Regression: endpoints-only shoelace computed curve-bounded faces
        // (crescents, lens) as ~0 area, tripping minPieceArea and auto-grouping a
        // crescent with the frame at start. Sampling `curvePoints` fixes it. See
        // generator.ts:computeOuterLoopArea.
        const { pieces, autoGroups } = generateComposablePuzzle(
            1, 1, { width: 600, height: 400 }, 42, CONFIG,
        );
        expect(pieces).toHaveLength(4);
        expect(autoGroups).toHaveLength(4);
        for (const g of autoGroups) {
            expect(g.pieceIds).toHaveLength(1);
        }
    });
});
