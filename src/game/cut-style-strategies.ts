/**
 * Adding a new cut style means adding a new strategy entry here, not
 * editing `init.ts`.
 */

import type { GeneratedPiece, GridSize, Size } from '../model/types.js';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import {
    generateFractalPuzzle,
    scaleFractalGrid,
} from '../puzzle/fractal/index.js';
import type { FractalConfig } from '../puzzle/fractal/index.js';
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import type { TabDebugSession, TabDebugReport } from '../puzzle/topology/tab-debug.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import type { CutStyle } from './cut-styles.js';
import {
    estimateTriangleFaceCount,
    MAX_ROWS as MAX_TRIANGLE_ROWS,
} from '../puzzle/topology/triangular-cut-generator.js';
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';

/**
 * Per-call configuration passed through to whichever strategy is active.
 * Each style ignores the keys it doesn't use.
 */
export interface StrategyContext {
    fractalConfig?: FractalConfig;
    composableConfig?: ComposableConfig;
    wavyConfig?: { borderless?: boolean; traceSetVersion?: number };
    trianglesConfig?: { traceSetVersion?: number };
    classicConfig?: { traceSetVersion?: number };
    /**
     * Dev-time tab-debug session (set by `init.ts` from the `tabDebug=1` flag).
     * Threaded to the topology generator by strategies whose pipeline supports
     * it; fractal and legacy classic ignore it.
     */
    tabDebug?: TabDebugSession;
}

/**
 * `autoGroups` is set by styles whose generator emits starting groups (only
 * composable, when `minPieceArea` is set); when absent/empty, `init.ts` falls
 * back to one-piece-per-group.
 */
export interface StrategyPuzzle {
    pieces: GeneratedPiece[];
    autoGroups?: AutoGroup[];
    /** Tab-debug report produced when `ctx.tabDebug` was set. */
    tabDebugReport?: TabDebugReport;
    /**
     * Set when the generator declared an expected piece count and produced a
     * different one. Styles returning `generateComposablePuzzle(...)` directly
     * get it for free — the topology result already carries it.
     */
    pieceCountMismatch?: PieceCountMismatch;
}

export type StyleConfigKey =
    | 'fractalConfig'
    | 'composableConfig'
    | 'wavyConfig'
    | 'trianglesConfig'
    | 'classicConfig';

export interface CutStyleStrategy {
    /**
     * Map the user-facing grid (piece count for classic/composable, target
     * piece count for fractal) onto the grid handed to the generator.
     */
    scaleGrid(userGrid: GridSize, imageSize: Size, ctx: StrategyContext): GridSize;
    /**
     * Map the source image size onto the puzzle rectangle the generator
     * fills. Returning the input means the puzzle covers the full image.
     */
    inscribePuzzleSize(
        imageSize: Size,
        generationGrid: GridSize,
        ctx: StrategyContext,
    ): Size;
    generatePieces(
        grid: GridSize,
        puzzleSize: Size,
        seed: number,
        ctx: StrategyContext,
    ): StrategyPuzzle;
    /**
     * The `GameState`/`InitOptions` field holding this style's generator config.
     * Required, so a new style must declare it to compile; `init.ts` gates on it
     * to store only the matching block.
     */
    configKey: StyleConfigKey;
}

const classicStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) => {
        const traceSetVersion = ctx.classicConfig?.traceSetVersion;
        if (traceSetVersion === undefined) {
            // Legacy Classic: every pre-upgrade share link/save. The PRNG
            // call count/order of generateProceduralPuzzle is a wire contract
            // — do not touch it. See project_share_link_prng_contract.
            return {
                pieces: generateProceduralPuzzle(grid.cols, grid.rows, puzzleSize, seed),
            };
        }
        // Sine-based Classic: a gentle Wavy. Params are fixed here, not on the
        // wire, so Classic links carry no attacker-controllable sine config.
        // `puzzle/topology/repro-bug.test.ts` hand-copies this config (it can't
        // import from `src/game`); keep them in step. Value changes turn its
        // `objectContaining` pins in `cut-style-strategies.classic-traced.test.ts`
        // red, but an *added* key slips past — update the copy by hand.
        const avgPieceArea =
            (puzzleSize.width * puzzleSize.height) / (grid.cols * grid.rows);
        return generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
            baseCutGenerator: 'sine',
            baseCutConfig: {
                cols: grid.cols,
                rows: grid.rows,
                ha: 0.11,
                hf: grid.cols / 3,
                va: 0.11,
                vf: grid.rows / 3,
            },
            tabGenerator: 'traced',
            tabConfig: { traceSetVersion },
            minPieceArea: avgPieceArea / 4,
            borderless: false,
            tabDebug: ctx.tabDebug,
        });
    },
    configKey: 'classicConfig',
};

const composableStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) =>
        generateComposablePuzzle(
            grid.cols,
            grid.rows,
            puzzleSize,
            seed,
            ctx.tabDebug
                ? { ...ctx.composableConfig, tabDebug: ctx.tabDebug }
                : ctx.composableConfig,
        ),
    configKey: 'composableConfig',
};

const fractalStrategy: CutStyleStrategy = {
    // `=== true` (not truthiness) here and in `generateFractalPuzzle`: for a
    // crafted non-boolean borderless (hand-typed `__reproPuzzle`, pre-tightening
    // save) this generates the BORDERED puzzle the share encoder writes as
    // `ff: { bl: false }`; truthiness would generate borderless and re-share it
    // as bordered. Other styles get `generator.ts`'s strict check; fractal has
    // its own pipeline.
    scaleGrid: (userGrid, imageSize, ctx) =>
        scaleFractalGrid(
            userGrid.cols * userGrid.rows,
            imageSize.width / imageSize.height,
            ctx.fractalConfig?.borderless === true,
        ),
    inscribePuzzleSize: (imageSize, generationGrid, ctx) => {
        // Borderless mode uses the full grid; bordered mode loses one tile
        // on each side to the curved outer edge.
        const gridAspect = ctx.fractalConfig?.borderless === true
            ? generationGrid.cols / generationGrid.rows
            : (generationGrid.cols - 1) / (generationGrid.rows - 1);

        return inscribeToGridAspect(imageSize, gridAspect);
    },
    generatePieces: (grid, puzzleSize, seed, ctx) => ({
        pieces: generateFractalPuzzle(
            grid.cols,
            grid.rows,
            puzzleSize,
            seed,
            ctx.fractalConfig,
        ),
    }),
    configKey: 'fractalConfig',
};

const wavyStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) => {
        // avgPieceArea is computed from the requested grid on purpose. Borderless
        // oversizes the grid internally (extra cols/rows get stripped), so real
        // pieces run a bit smaller; minPieceArea (= /4) still stays well below
        // legitimate piece area in both modes, catching only sub-pixel slivers,
        // never false auto-grouping.
        const avgPieceArea =
            (puzzleSize.width * puzzleSize.height) /
            (grid.cols * grid.rows);
        const traceSetVersion = ctx.wavyConfig?.traceSetVersion;
        const traced = traceSetVersion !== undefined;
        return generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
            baseCutGenerator: 'sine',
            baseCutConfig: {
                cols: grid.cols,
                rows: grid.rows,
                ha: 0.5,
                hf: grid.cols / 2,
                va: 0.5,
                vf: grid.rows / 2,
            },
            tabGenerator: traced ? 'traced' : 'classic',
            tabConfig: traced ? { traceSetVersion } : {},
            minPieceArea: avgPieceArea / 4,
            borderless: ctx.wavyConfig?.borderless ?? false,
            tabDebug: ctx.tabDebug,
        });
    },
    configKey: 'wavyConfig',
};

/**
 * Pick the triangle row count whose estimated piece count lands closest to the
 * target for this image's shape (the lattice derives columns from the frame
 * aspect, so portraits need more rows than landscapes). Bounded by MAX_ROWS, so
 * extreme portraits undershoot — the size buttons' ~N labels absorb it.
 *
 * Released Triangles share-link contract: the receiver re-runs this from the
 * encoded image size, so any change to formula, loop bound, or tie-break
 * reproduces different puzzles from existing links. Ties (strict `<`) resolve
 * to the smaller row count.
 */
export function selectTriangleRows(targetPieceCount: number, imageSize: Size): number {
    let best = 1;
    let bestDelta = Infinity;
    for (let rows = 1; rows <= MAX_TRIANGLE_ROWS; rows++) {
        const delta = Math.abs(estimateTriangleFaceCount(rows, imageSize) - targetPieceCount);
        if (delta < bestDelta) {
            best = rows;
            bestDelta = delta;
        }
    }
    return best;
}

const trianglesStrategy: CutStyleStrategy = {
    // The generator ignores `cols` (derives columns from aspect); pass the
    // user grid's cols through to keep the generation grid well-formed.
    scaleGrid: (userGrid, imageSize) => ({
        cols: userGrid.cols,
        rows: selectTriangleRows(userGrid.cols * userGrid.rows, imageSize),
    }),
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed, ctx) =>
        // Fixed production preset: max irregularity, flowing edges, hand-traced
        // tabs. No explicit minPieceArea — deliberately avoiding wavy's
        // avgPieceArea/4 threshold (the lattice's snapped columns leave clean
        // border half-triangles, not slivers); the composable generator's 4px²
        // floor still applies. traceSetVersion falls back to current only for
        // crafted links that lost their config block; real games/links carry it.
        generateComposablePuzzle(grid.cols, grid.rows, puzzleSize, seed, {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: 0.5, smooth: true },
            tabGenerator: 'traced',
            tabConfig: {
                traceSetVersion:
                    ctx.trianglesConfig?.traceSetVersion ?? CURRENT_TRACE_SET_VERSION,
            },
            tabDebug: ctx.tabDebug,
        }),
    configKey: 'trianglesConfig',
};

const STRATEGIES: Record<CutStyle, CutStyleStrategy> = {
    classic: classicStrategy,
    composable: composableStrategy,
    fractal: fractalStrategy,
    wavy: wavyStrategy,
    triangles: trianglesStrategy,
};

export function getCutStyleStrategy(cutStyle: CutStyle): CutStyleStrategy {
    return STRATEGIES[cutStyle];
}

/**
 * The config field a style stores on `GameState`, or `undefined` for an
 * unrecognized id. `hasOwnProperty` membership, not a raw index: `STRATEGIES`
 * has no index signature, so an unknown or inherited key (`'constructor'`) would
 * otherwise read as a defined strategy (same guard as `isCutStyle`).
 */
export function configKeyForCutStyle(cutStyle: string | undefined): StyleConfigKey | undefined {
    if (typeof cutStyle === 'string' && Object.prototype.hasOwnProperty.call(STRATEGIES, cutStyle)) {
        return STRATEGIES[cutStyle as CutStyle].configKey;
    }
    return undefined;
}

/**
 * Largest rectangle of `gridAspect` fitting inside `imageSize`. Keeps the tile
 * grid scaling uniform (arcs stay circular) with the image cropped to cover.
 */
function inscribeToGridAspect(imageSize: Size, gridAspect: number): Size {
    const imageAspect = imageSize.width / imageSize.height;
    if (gridAspect >= imageAspect) {
        return { width: imageSize.width, height: imageSize.width / gridAspect };
    }

    return { width: imageSize.height * gridAspect, height: imageSize.height };
}
