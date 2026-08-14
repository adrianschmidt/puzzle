/**
 * The middle hop of a piece-count mismatch's journey (#512): `generator.test.ts`
 * pins detection, `init.test.ts` pins `createNewGame` → `onPieceCountMismatch`.
 * Nothing structural forces `generatePieces` to forward the field — the styles
 * that reach the topology pipeline get it only by returning
 * `generateComposablePuzzle(...)` directly; a future style that rebuilt
 * `{ pieces }` (as `fractal`/legacy Classic do) would drop it with every other
 * test still green.
 *
 * The generator is mocked, not driven to a real mismatch: forcing one needs an
 * extreme cut config no shipped style exposes, and forwarding is what's tested.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// A `vi.spyOn` on the export can't intercept the call `cut-style-strategies`
// makes internally under Vite's ESM; the passthrough factory can. Only
// `generateComposablePuzzle` is replaced; the rest of the module stays real.
vi.mock('../puzzle/composable-generator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../puzzle/composable-generator.js')>();
    return { ...actual, generateComposablePuzzle: vi.fn() };
});

import { getCutStyleStrategy, type StrategyContext } from './cut-style-strategies.js';
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import type { CutStyle } from './cut-styles.js';
import type { TopologyPuzzle } from '../puzzle/topology/generator.js';

const MISMATCH = { expected: 192, actual: 189, baseCutId: 'sine' };
const FRAME = { width: 1080, height: 720 };

/**
 * Every cut style, classified: its production context plus whether that context
 * reaches `generateComposablePuzzle`.
 *
 * A `Record<CutStyle, …>` (not a list of the qualifying four) so a NEW style
 * fails to compile until classified — a list would only pin an EDIT to an
 * existing entry. Context and classification are separate fields on purpose:
 * folding them into one slot would let a mislabeled topology-backed style also
 * lose the context that reaches its topology path, so it would pass the
 * negative case while silently dropping out of the forwarding `it.each`.
 *
 * Classic needs a `traceSetVersion`, else it takes the legacy
 * `generateProceduralPuzzle` branch, which produces no topology result.
 */
const STYLE_PATHS: Record<CutStyle, { ctx: StrategyContext; topology: boolean }> = {
    classic: { ctx: { classicConfig: { traceSetVersion: 1 } }, topology: true },
    wavy: { ctx: {}, topology: true },
    triangles: { ctx: { trianglesConfig: { traceSetVersion: 1 } }, topology: true },
    composable: { ctx: { composableConfig: { baseCutGenerator: 'sine' } }, topology: true },
    // Its own generator; the composable pipeline is never involved.
    fractal: { ctx: {}, topology: false },
};

const stylesWhere = (topology: boolean): [CutStyle, StrategyContext][] =>
    Object.entries(STYLE_PATHS)
        .filter(([, path]) => path.topology === topology)
        .map(([cutStyle, path]) => [cutStyle as CutStyle, path.ctx]);

const TOPOLOGY_STYLES = stylesWhere(true);
const NON_TOPOLOGY_STYLES = stylesWhere(false);

describe('cut-style strategies forward a piece-count mismatch', () => {
    beforeEach(() => {
        // Cleared explicitly: no `clearMocks`/`restoreMocks` in `vite.config.ts`,
        // so call records otherwise accumulate — the `topology: false` assertion
        // below reads them.
        vi.mocked(generateComposablePuzzle).mockClear();
        vi.mocked(generateComposablePuzzle).mockReturnValue({
            pieces: [],
            pieceCountMismatch: MISMATCH,
        } as unknown as TopologyPuzzle);
    });

    it.each(TOPOLOGY_STYLES)('%s', (cutStyle, ctx) => {
        const strategy = getCutStyleStrategy(cutStyle);
        const grid = strategy.scaleGrid({ cols: 16, rows: 12 }, FRAME, ctx);
        const puzzleSize = strategy.inscribePuzzleSize(FRAME, grid, ctx);

        const result = strategy.generatePieces(grid, puzzleSize, 42, ctx);

        expect(result.pieceCountMismatch).toEqual(MISMATCH);
    });

    it.each(NON_TOPOLOGY_STYLES)(
        '%s is genuinely off the composable pipeline, as classified',
        (cutStyle, ctx) => {
            // `STYLE_PATHS` forces classification; this checks the label is
            // actually TRUE, since `topology: false` excludes a style from the
            // `it.each` above — a mislabeled topology-backed style would skip the
            // forwarding check. Run under the style's OWN context so a mislabel
            // can't also deprive it of its topology path. Small grid: fractal
            // really generates, and this isn't a perf test.
            const strategy = getCutStyleStrategy(cutStyle);
            const grid = strategy.scaleGrid({ cols: 3, rows: 2 }, FRAME, ctx);
            const puzzleSize = strategy.inscribePuzzleSize(FRAME, grid, ctx);

            const result = strategy.generatePieces(grid, puzzleSize, 42, ctx);

            expect(generateComposablePuzzle).not.toHaveBeenCalled();
            expect(result.pieceCountMismatch).toBeUndefined();
        },
    );

    it('reports nothing when the generator declares no mismatch', () => {
        vi.mocked(generateComposablePuzzle)
            .mockReturnValue({ pieces: [] } as unknown as TopologyPuzzle);
        const strategy = getCutStyleStrategy('wavy');

        expect(
            strategy.generatePieces({ cols: 4, rows: 3 }, FRAME, 42, {}).pieceCountMismatch,
        ).toBeUndefined();
    });
});
