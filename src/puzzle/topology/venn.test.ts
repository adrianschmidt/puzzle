/**
 * Integration test for the two-circle Venn case.
 *
 * Two circles strictly inside a frame, intersecting each other,
 * should produce exactly four pieces:
 *   - the frame piece (rectangular outer boundary, with a hole
 *     where the circle component sits — emitted as a second
 *     loop on the flat `edges` list)
 *   - two crescents
 *   - one lens
 *
 * Loop count on a piece is detected by counting chain breaks in
 * its flat `edges` list.
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
        // The frame's outer boundary is 4 border edges (unmated). The
        // inner-boundary edges should each have a mate pointing at one
        // of the crescent pieces (the lens has no edges shared with
        // the frame). Verify at least one inner-boundary edge is mated.
        const matedFrameEdges = frame.edges.filter(
            e => e.matePieceId !== -1 && e.mateEdgeId !== -1,
        );
        expect(matedFrameEdges.length).toBeGreaterThan(0);
    });

    it('does not auto-group pieces — all four pieces are independent starting groups', () => {
        // Regression: when the area heuristic used endpoint-only shoelace,
        // curve-bounded faces (crescents, lens) computed as ~0 area and
        // tripped the default minPieceArea threshold, incorrectly
        // auto-grouping a crescent with the frame at puzzle start. The
        // current generator uses each piece's bounding-box area (which
        // is robust against curved boundaries) and an adaptive threshold
        // that only kicks in when the size distribution is bimodal — the
        // four Venn pieces have similarly-sized bboxes, so they pass.
        // See generator.ts:computeBboxArea and adaptive-threshold.ts.
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
