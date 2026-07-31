/**
 * The middle hop of a piece-count mismatch's journey (#512).
 *
 * `generator.test.ts` pins that the topology layer detects a mismatch, and
 * `init.test.ts` pins that `createNewGame` hands it to `onPieceCountMismatch`.
 * Between them sits `CutStyleStrategy.generatePieces`, and nothing structural
 * forces a strategy to pass the field along: the four styles that reach the
 * topology pipeline get it for free only because they `return
 * generateComposablePuzzle(...)` directly. A future strategy that destructured
 * the topology result and rebuilt `{ pieces }` — exactly what `fractal` and
 * legacy Classic legitimately do — would drop the diagnostic with every other
 * test in the repo still green.
 *
 * The generator is mocked rather than driven to a real mismatch: forcing one
 * through a shipped style would need an extreme cut config none of them
 * expose, and what is under test here is the forwarding, not the detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// A `vi.spyOn` on the export cannot intercept the call `cut-style-strategies`
// makes internally under Vite's ESM; the passthrough factory can. Only
// `generateComposablePuzzle` is replaced, so `DEFAULT_MIN_PIECE_AREA` and the
// rest of the module stay real for anything else in this graph.
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
 * Every cut style, classified: the context it is generated under in
 * production, plus whether that context reaches `generateComposablePuzzle`.
 *
 * A `Record<CutStyle, …>` rather than a hand-written list of the four that
 * qualify, because the risk this file's doc names is a NEW style — and a list
 * of existing entries only pins an EDIT to one of them. A sixth style fails
 * to compile here until someone states which side of the line it falls on,
 * and anything classified as topology-backed is then covered by the
 * `it.each` below. Same forcing function `CUT_STYLE_OPTIONS` gives rotation
 * and traced tabs.
 *
 * The context and the classification are separate fields on purpose. A single
 * slot holding either a context or a `'not-topology'` marker couples the two:
 * mislabeling a topology-backed style would ALSO deprive it of the context
 * that reaches its topology path, so classic marked that way would run on
 * `{}`, take the legacy `generateProceduralPuzzle` branch, and satisfy the
 * negative case below while quietly dropping out of the forwarding `it.each`
 * — both arms green, classic's forwarding silently uncovered. Carrying both
 * halves runs every style under its real context and lets only the flag pick
 * the arm, so a mislabel fails instead of relaxing coverage.
 *
 * Classic needs a `traceSetVersion`: without one it takes the legacy
 * `generateProceduralPuzzle` branch, which produces no topology result to
 * forward in the first place.
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
        // Cleared explicitly: this repo sets no `clearMocks`/`restoreMocks` in
        // `vite.config.ts`, so call records otherwise accumulate across cases
        // — and the `topology: false` assertion below reads them.
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
            // `STYLE_PATHS` forces a new style to be *classified*; without
            // this, nothing checks the classification is TRUE.
            // `topology: false` is the cheapest label to write when you don't
            // yet know, and it excludes the style from the `it.each` above —
            // so a topology-backed style mislabeled here would walk straight
            // past the forwarding check this file exists to enforce. Run
            // under the style's OWN context, so mislabeling one cannot also
            // deprive it of the context that reaches its topology path. A
            // small grid: fractal really generates, and this is not a perf
            // test.
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
