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
 */

import { describe, it, expect } from 'vitest';
import { generateComposablePuzzle } from '../composable-generator.js';

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
