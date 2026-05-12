/**
 * Regression tests for the "fused piece" bug at small image sizes.
 *
 * Both seeds previously produced fewer than the expected 192 pieces
 * because the pre-DCEL tab merge introduced floating-point drift
 * between cut split points, causing bezier-js to miss crossings
 * during topology construction.
 *
 * After the topology refactor, intersections are computed once on
 * the input cuts and never re-derived, so these seeds produce 192
 * pieces.
 *
 * The fold-back-island test below exercises the adaptive
 * minPieceArea threshold, which absorbs the tiny extra faces that
 * appear when a tab's bump folds back through its own parent edge
 * at high amplitude / frequency.
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';
import { adaptiveMinAreaThreshold } from './adaptive-threshold.js';
import type { Edge } from '../../model/types.js';

describe('composable: fused-piece regression', () => {
    // 16×12 sine + classic-tab runs at ~3.5s locally but can exceed
    // vitest's 5s default on slower CI runners after the per-edge
    // bump-only self-intersection check landed (apply-tabs.ts). The
    // follow-up PR drops that check; while #356 is still under review,
    // give these two tests a generous timeout.
    const TIMEOUT_MS = 15000;

    it('seed=124741785 (low amp / high freq) produces 192 pieces at 1080x720', () => {
        const { pieces } = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 124741785,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.13, hf: 7.1, va: 0.08, vf: 6.9 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(192);
    }, TIMEOUT_MS);

    it('seed=3215341677 (high amp) produces 192 pieces at 1080x720', () => {
        const { pieces } = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 3215341677,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.45, hf: 8, va: 0.45, vf: 6 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(192);
    }, TIMEOUT_MS);
});

describe('composable: adaptive auto-grouping absorbs tab fold-back islands', () => {
    // Configurations that empirically produce tab-bump fold-back islands.
    // With the per-edge fold-back rejection removed, the topology emits
    // extra small faces; the adaptive threshold absorbs them via the
    // auto-group pass.
    const REPROS = [
        {
            name: '16×12 high-amplitude (synthetic)',
            cols: 16,
            rows: 12,
            seed: 1,
            config: {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.6, hf: 10, va: 0.6, vf: 10 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        },
        {
            name: '6×4 high-frequency (user-reported repro)',
            cols: 6,
            rows: 4,
            seed: 1426023491,
            config: {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.5, hf: 10, va: 0.5, vf: 10 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        },
    ] as const;

    for (const repro of REPROS) {
        describe(repro.name, () => {
            it('produces more pieces than starting groups, every group above adaptive cutoff', () => {
                const { pieces, autoGroups } = generateComposablePuzzle(
                    repro.cols, repro.rows, { width: 1080, height: 720 },
                    repro.seed, repro.config,
                );

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
            });

            it('disabling the adaptive threshold leaves fold-back islands as solo groups', () => {
                const { pieces, autoGroups } = generateComposablePuzzle(
                    repro.cols, repro.rows, { width: 1080, height: 720 },
                    repro.seed,
                    { ...repro.config, minPieceAreaGapRatio: Infinity },
                );
                // With adaptive thresholding off, only the absolute floor
                // (4 px²) applies; fold-back islands ride above that and
                // stand alone.
                expect(autoGroups.length).toBe(pieces.length);
            });
        });
    }
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
