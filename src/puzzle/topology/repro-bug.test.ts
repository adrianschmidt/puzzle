/**
 * Regression tests for the "fused piece" bug — a puzzle with fewer than
 * cols × rows pieces because a missed cut crossing let buildDCEL merge faces.
 *
 * Two distinct root causes produced the same symptom: the first two seeds — a
 * pre-DCEL tab-merge floating-point drift, fixed by the topology refactor; and
 * the third (#498) — bezier-js `reduce()` dropping a post-extremum sliver, fixed
 * in curve.ts. Each also asserts `pieceCountMismatch` is undefined, so a
 * regression proves the detector catches it (detector firing itself is covered
 * in generator.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';
import { preloadTracedTabGenerator } from './traced-tab-loader.js';

describe('composable: fused-piece regression', () => {
    // 16×12 sine + classic-tab is ~3.5s locally but can exceed vitest's 5s
    // default on slower CI runners, so give these a generous timeout.
    const TIMEOUT_MS = 15000;

    it('seed=124741785 (low amp / high freq) produces 192 pieces at 1080x720', () => {
        const { pieces, pieceCountMismatch } = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 124741785,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.13, hf: 7.1, va: 0.08, vf: 6.9 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(192);
        expect(pieceCountMismatch).toBeUndefined();
    }, TIMEOUT_MS);

    it('seed=3215341677 (high amp) produces 192 pieces at 1080x720', () => {
        const { pieces, pieceCountMismatch } = generateComposablePuzzle(
            16, 12, { width: 1080, height: 720 }, 3215341677,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: { ha: 0.45, hf: 8, va: 0.45, vf: 6 },
                tabGenerator: 'classic',
                tabConfig: {},
            },
        );
        expect(pieces).toHaveLength(192);
        expect(pieceCountMismatch).toBeUndefined();
    }, TIMEOUT_MS);

    // #498, distinct root cause from the two above and the first reachable from
    // a *shipping* config: these are the exact parameters Classic builds for a
    // 12×16 grid, so this seed is what a player gets. Image size is part of the
    // trigger (the same seed is correct at 720×1080, 1080×1620, 1080×720).
    //
    // Mirrors `classicStrategy.generatePieces` in src/game/cut-style-strategies.ts,
    // hand-copied because src/puzzle can't import src/game; a retune there turns
    // cut-style-strategies.classic-traced.test.ts red as the cue to update this.
    //
    // Traced tabs resolve through the real `preloadTracedTabGenerator` lazy path,
    // so this covers the `tracedTabGeneratorStub` forwarding the app depends on;
    // a direct `registerTabGenerator(tracedTabGenerator)` would bypass it.
    //
    // `traceSetVersion` is pinned to 1, not CURRENT_TRACE_SET_VERSION: the trigger
    // is specific to trace set 1's geometry, and a version bump that dissolved it
    // would leave this passing for the wrong reason instead of failing.
    it('seed=1534700170 produces 192 Classic pieces at 1080x1440', async () => {
        await preloadTracedTabGenerator();

        const cols = 12, rows = 16;
        const size = { width: 1080, height: 1440 };
        const { pieces, pieceCountMismatch } = generateComposablePuzzle(
            cols, rows, size, 1534700170,
            {
                baseCutGenerator: 'sine',
                baseCutConfig: {
                    cols, rows,
                    ha: 0.11, hf: cols / 3,
                    va: 0.11, vf: rows / 3,
                },
                tabGenerator: 'traced',
                tabConfig: { traceSetVersion: 1 },
                minPieceArea: (size.width * size.height) / (cols * rows) / 4,
                borderless: false,
            },
        );
        expect(pieces).toHaveLength(192);
        expect(pieceCountMismatch).toBeUndefined();
    }, TIMEOUT_MS);
});
