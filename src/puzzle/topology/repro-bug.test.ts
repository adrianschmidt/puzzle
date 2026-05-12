/**
 * Regression tests for the "fused piece" bug at small image sizes.
 *
 * Both seeds previously produced fewer than the expected 192 pieces
 * because the pre-DCEL tab merge introduced floating-point drift
 * between cut split points, causing bezier-js to miss crossings
 * during topology construction.
 *
 * After the topology refactor, intersections are computed once on
 * the input cuts and never re-derived, so these seeds produce at
 * least 192 pieces. The two-pass pipeline ("tabs as cuts") may add
 * a handful of extra fold-back island faces when a tab bump dips
 * back through its parent edge; the auto-group pass absorbs the
 * tiniest of those, but mid-sized islands stay as their own pieces
 * (the user-visible behaviour we want — they're real pieces glued
 * along an edge, not corner-to-corner visual artefacts).
 *
 * The fold-back-island test below exercises the adaptive
 * minPieceArea threshold for the 6×4 user-reported repro, where
 * the distribution is clearly bimodal (most pieces are huge, the
 * fold-back islands are tiny).
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';
import { adaptiveMinAreaThreshold } from './adaptive-threshold.js';
import type { Edge } from '../../model/types.js';

// 16×12 sine + classic-tab pipeline runs well under vitest's 5s default
// locally, but slower CI runners occasionally exceed it. Give the heavy
// composable pipeline tests a generous timeout.
const HEAVY_PIPELINE_TIMEOUT_MS = 15000;

describe('composable: fused-piece regression', () => {
    it('seed=124741785 (low amp / high freq) produces ≥192 pieces at 1080x720', () => {
        const { pieces, autoGroups } = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 124741785,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.13, hf: 7.1, va: 0.08, vf: 6.9 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        // Low-amplitude config: tabs may fold back once or twice but
        // the auto-group pass absorbs those tiny islands, so the final
        // starting-group count matches the grid exactly.
        expect(pieces.length).toBeGreaterThanOrEqual(192);
        expect(autoGroups).toHaveLength(192);
    }, HEAVY_PIPELINE_TIMEOUT_MS);

    it('seed=3215341677 (high amp) produces ≥192 pieces at 1080x720', () => {
        const { pieces, autoGroups } = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 3215341677,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.45, hf: 8, va: 0.45, vf: 6 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        // High-amplitude config: more tabs fold back, producing real
        // island faces. Auto-grouping leaves the substantially-sized
        // ones as their own starting groups, so we have at least 192
        // pieces and 192 starting groups (one per grid cell), often
        // more.
        expect(pieces.length).toBeGreaterThanOrEqual(192);
        expect(autoGroups.length).toBeGreaterThanOrEqual(192);
    }, HEAVY_PIPELINE_TIMEOUT_MS);
});

describe('composable: tabs-as-cuts produces real fold-back island faces', () => {
    // Configurations that empirically produce tab-bump fold-back
    // islands. With the two-pass DCEL pipeline these self-crossings
    // materialise as real faces; auto-grouping absorbs the tiniest
    // ones via the adaptive threshold, larger ones stand alone as
    // genuine pieces glued along an edge.
    describe('6×4 high-frequency (user-reported repro: clearly bimodal distribution)', () => {
        const cols = 6, rows = 4, seed = 1426023491;
        const config = {
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.5, hf: 10, va: 0.5, vf: 10 },
            tabGenerator: 'classic',
            tabConfig: {},
        } as const;

        it('produces more pieces than starting groups, every group above adaptive cutoff', () => {
            const { pieces, autoGroups } = generateComposablePuzzle(
                cols, rows, { width: 1080, height: 720 }, seed, config,
            );

            // The 6×4 grid has 24 cells, but high-frequency sine + tab
            // fold-backs add many small islands → more pieces than cells.
            expect(pieces.length).toBeGreaterThan(cols * rows);

            // Topology keeps fold-back islands as their own faces…
            expect(autoGroups.length).toBeLessThan(pieces.length);

            // …but every starting group has substantial total area —
            // no group consists of a lone fold-back island below cutoff.
            const bboxByPiece = new Map<number, number>();
            for (const p of pieces) bboxByPiece.set(p.id, edgesBboxArea(p.edges));
            const adaptive = adaptiveMinAreaThreshold([...bboxByPiece.values()]);
            expect(adaptive).not.toBeNull();

            for (const g of autoGroups) {
                const totalArea = g.pieceIds.reduce(
                    (sum, id) => sum + (bboxByPiece.get(id) ?? 0),
                    0,
                );
                expect(totalArea).toBeGreaterThanOrEqual(adaptive!);
            }
        }, HEAVY_PIPELINE_TIMEOUT_MS);

        it('disabling the adaptive threshold leaves fold-back islands as solo groups', () => {
            const { pieces, autoGroups } = generateComposablePuzzle(
                cols, rows, { width: 1080, height: 720 }, seed,
                { ...config, minPieceAreaGapRatio: Infinity },
            );
            // With adaptive thresholding off, only the absolute floor
            // (4 px²) applies; fold-back islands ride above that and
            // stand alone.
            expect(autoGroups.length).toBe(pieces.length);
        }, HEAVY_PIPELINE_TIMEOUT_MS);
    });

    describe('16×12 high-amplitude (synthetic: fold-backs produce many mid-sized islands)', () => {
        const cols = 16, rows = 12, seed = 1;
        const config = {
            baseCutGenerator: 'sine',
            baseCutConfig: { ha: 0.6, hf: 10, va: 0.6, vf: 10 },
            tabGenerator: 'classic',
            tabConfig: {},
        } as const;

        it('produces more pieces than the grid cell count (extra fold-back island faces)', () => {
            const { pieces } = generateComposablePuzzle(
                cols, rows, { width: 1080, height: 720 }, seed, config,
            );
            // Two-pass DCEL catches tab self-crossings as real faces,
            // so the synthetic high-amplitude config yields strictly
            // more pieces than the 192 cells of a clean 16×12 grid.
            expect(pieces.length).toBeGreaterThan(cols * rows);
        }, HEAVY_PIPELINE_TIMEOUT_MS);

        it('every starting group passes the absolute area floor', () => {
            const { pieces, autoGroups } = generateComposablePuzzle(
                cols, rows, { width: 1080, height: 720 }, seed, config,
            );
            // The synthetic config produces fold-back islands across
            // a wide range of sizes — the distribution isn't strongly
            // bimodal, so the adaptive threshold may return null. In
            // that case the only guarantee is that every group's
            // total area clears the absolute floor (4 px²). Sub-floor
            // sliver faces get glued into their neighbours; islands
            // above the floor stand alone, which is exactly the
            // intended user-visible behaviour — real island pieces
            // along an edge, not corner-to-corner visual artefacts.
            const ABSOLUTE_FLOOR = 4; // generator's compiled-in floor
            const bboxByPiece = new Map<number, number>();
            for (const p of pieces) bboxByPiece.set(p.id, edgesBboxArea(p.edges));
            for (const g of autoGroups) {
                const totalArea = g.pieceIds.reduce(
                    (sum, id) => sum + (bboxByPiece.get(id) ?? 0),
                    0,
                );
                expect(totalArea).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR);
            }
        }, HEAVY_PIPELINE_TIMEOUT_MS);
    });
});

function edgesBboxArea(edges: Edge[]): number {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of edges) {
        const points = e.curvePoints ?? [e.start, e.end];
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
    }
    if (minX === Infinity) return 0;
    return (maxX - minX) * (maxY - minY);
}
