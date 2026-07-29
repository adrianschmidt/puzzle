/**
 * Regression tests for the "fused piece" bug — a generated puzzle
 * containing fewer than `cols × rows` pieces because a cut crossing
 * was missed, so `buildDCEL` merged the faces around it.
 *
 * Two independent causes have produced this same symptom:
 *
 * 1. The first two seeds below: the pre-DCEL tab merge introduced
 *    floating-point drift between cut split points. Fixed by the
 *    topology refactor, which computes intersections once on the
 *    input cuts and never re-derives them.
 *
 * 2. The third seed (#498): bezier-js's `reduce()` silently dropped a
 *    post-extremum sliver, putting the crossing out of reach of
 *    `intersects()`. Fixed in `curve.ts` by completing the reduction
 *    before intersecting.
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';
import { preloadTracedTabGenerator } from './traced-tab-loader.js';

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

    // #498. Distinct root cause from the two above (see the file header),
    // and the first one reachable from a *shipping* configuration: these
    // are the exact parameters the Classic cut style builds for a 12×16
    // grid, so the seed below is what a player would actually get. The
    // image size is part of the trigger — the same seed is correct at
    // 720×1080, 1080×1620 and 1080×720.
    //
    // Mirrors `classicStrategy.generatePieces` in
    // `src/game/cut-style-strategies.ts`, hand-copied because nothing in
    // `src/puzzle` imports from `src/game`. A retune there turns
    // `cut-style-strategies.classic-traced.test.ts` red before it can
    // reach this copy, which is the cue to update it.
    //
    // Traced tabs resolve through `preloadTracedTabGenerator`, the real
    // lazy-load path: the registry keeps dispatching via
    // `tracedTabGeneratorStub` afterwards, so this covers the forwarding
    // the app depends on — a direct
    // `registerTabGenerator(tracedTabGenerator)` would bypass it.
    //
    // `traceSetVersion` is pinned to 1 rather than tracking
    // `CURRENT_TRACE_SET_VERSION` on purpose: the trigger is specific to
    // the tab geometry trace set 1 produces, and a version bump that
    // happened to dissolve it would leave this passing for the wrong
    // reason instead of failing.
    it('seed=1534700170 produces 192 Classic pieces at 1080x1440', async () => {
        await preloadTracedTabGenerator();

        const cols = 12, rows = 16;
        const size = { width: 1080, height: 1440 };
        const { pieces } = generateComposablePuzzle(
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
    }, TIMEOUT_MS);
});
