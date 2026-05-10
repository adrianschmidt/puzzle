/**
 * Per-cut-style generation strategy.
 *
 * Each `CutStyle` owns the four things that used to live as branching
 * inside `init.ts`:
 *
 *   1. `scaleGrid`          — turn the user-facing grid (piece count) into
 *                             the grid handed to the generator. Fractal
 *                             scales the tile grid; other styles pass it
 *                             through.
 *   2. `inscribePuzzleSize` — fit the puzzle rectangle inside the image so
 *                             the generation grid scales uniformly. Fractal
 *                             needs this so arcs stay circular; other
 *                             styles use the image as-is.
 *   3. `generatePieces`     — call the right generator with the right config.
 *   4. `configKey`          — which `GameState` field the generator's config
 *                             round-trips to (or `undefined` for styles
 *                             without a config).
 *
 * Adding a new cut style means adding a new strategy entry here, not editing
 * `init.ts`.
 */

import type { GridSize, Piece, Size } from '../model/types.js';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import {
    generateFractalPuzzle,
    scaleFractalGrid,
} from '../puzzle/fractal/index.js';
import type { FractalConfig } from '../puzzle/fractal/index.js';
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { AutoGroup } from '../puzzle/topology/auto-group.js';
import type { CutStyle } from './cut-styles.js';

/**
 * Per-call configuration passed through to whichever strategy is active.
 * Each style ignores the keys it doesn't use.
 */
export interface StrategyContext {
    fractalConfig?: FractalConfig;
    composableConfig?: ComposableConfig;
}

/**
 * What a strategy returns from `generatePieces`.
 *
 * `autoGroups` is set by styles whose generator emits starting groups
 * (currently only composable, when `minPieceArea` is configured). When
 * absent or empty, `init.ts` falls back to one-piece-per-group.
 */
export interface StrategyPuzzle {
    pieces: Piece[];
    autoGroups?: AutoGroup[];
}

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
    /** Generate the pieces (and optional starting groups) for this style. */
    generatePieces(
        grid: GridSize,
        puzzleSize: Size,
        seed: number,
        ctx: StrategyContext,
    ): StrategyPuzzle;
    /**
     * Where the generator's config should be stored on `GameState`. Omit
     * for styles that don't take a config (e.g. classic).
     */
    configKey?: 'fractalConfig' | 'composableConfig';
}

const classicStrategy: CutStyleStrategy = {
    scaleGrid: (grid) => grid,
    inscribePuzzleSize: (imageSize) => imageSize,
    generatePieces: (grid, puzzleSize, seed) => ({
        pieces: generateProceduralPuzzle(grid.cols, grid.rows, puzzleSize, seed),
    }),
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
            ctx.composableConfig,
        ),
    configKey: 'composableConfig',
};

const fractalStrategy: CutStyleStrategy = {
    scaleGrid: (userGrid, imageSize, ctx) =>
        scaleFractalGrid(
            userGrid.cols * userGrid.rows,
            imageSize.width / imageSize.height,
            ctx.fractalConfig?.borderless ?? false,
        ),
    inscribePuzzleSize: (imageSize, generationGrid, ctx) => {
        // Borderless mode uses the full grid; bordered mode loses one tile
        // on each side to the curved outer edge.
        const gridAspect = ctx.fractalConfig?.borderless
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

const STRATEGIES: Record<CutStyle, CutStyleStrategy> = {
    classic: classicStrategy,
    composable: composableStrategy,
    fractal: fractalStrategy,
};

/** Look up the strategy for a cut style. */
export function getCutStyleStrategy(cutStyle: CutStyle): CutStyleStrategy {
    return STRATEGIES[cutStyle];
}

/**
 * Return the largest rectangle of `gridAspect` that fits inside `imageSize`,
 * centred. Used so the tile grid scales uniformly (arcs stay circular) and
 * the image is cropped to cover the puzzle rect.
 */
function inscribeToGridAspect(imageSize: Size, gridAspect: number): Size {
    const imageAspect = imageSize.width / imageSize.height;
    if (gridAspect >= imageAspect) {
        // Grid wider than image — match image width, shrink height.
        return { width: imageSize.width, height: imageSize.width / gridAspect };
    }

    // Grid taller than image — match image height, shrink width.
    return { width: imageSize.height * gridAspect, height: imageSize.height };
}
