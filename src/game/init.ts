/**
 * Game initialization logic.
 *
 * Creates a new game state: generates pieces using the configured cut
 * style's generator, wraps each in its own single-piece group, and
 * randomizes positions within the viewport so all pieces are visible.
 */

import type { GameState, PieceGroup, Piece, Size, GridSize } from '../model/types.js';
import type { FractalConfig } from '../puzzle/fractal-generator.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import { generateSeed } from '../puzzle/seeded-random.js';
import type { CutStyle } from './cut-styles.js';
import { getCutStyleStrategy } from './cut-style-strategies.js';

/** Default grid dimensions for the MVP puzzle. */
export const DEFAULT_COLS = 8;
export const DEFAULT_ROWS = 6;

/** Margin from the viewport edge to keep pieces visible. */
export const VIEWPORT_MARGIN = 20;

/**
 * Options for random position generation.
 * Extracted for testability (allows injecting a seeded RNG).
 */
export interface InitOptions {
    /** Random number generator: returns a value in [0, 1). Default: Math.random */
    random?: () => number;
    /** PRNG seed for procedural cut generation. If omitted, a random seed is generated. */
    seed?: number;
    /** Cut style to use. Defaults to 'classic'. */
    cutStyle?: CutStyle;
    /** Configuration for the composable generator (only used when cutStyle is 'composable'). */
    composableConfig?: ComposableConfig;
    /** Configuration for the fractal generator (only used when cutStyle is 'fractal'). */
    fractalConfig?: FractalConfig;
    /**
     * Rotation mode for this puzzle. Defaults to `'none'`.
     *
     * When set to `'quarter-turn'`, each initial single-piece group gets a
     * random rotation in {0,1,2,3} so the player must solve orientation
     * as well as position.
     */
    rotationMode?: 'none' | 'quarter-turn';
}

/**
 * Create a new game state with randomized piece positions.
 *
 * @param imageUrl - URL of the puzzle image
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param viewport - Available viewport size for positioning pieces
 * @param gridSize - Grid dimensions (cols × rows). Defaults to 8×6.
 * @param options - Optional configuration (e.g. custom RNG)
 */
export function createNewGame(
    imageUrl: string,
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
): GameState {
    const seed = options.seed ?? generateSeed();
    const cutStyle = options.cutStyle ?? 'classic';
    const rotationMode = options.rotationMode ?? 'none';

    const strategy = getCutStyleStrategy(cutStyle);
    const ctx = {
        fractalConfig: options.fractalConfig,
        composableConfig: options.composableConfig,
    };

    const generationGrid = strategy.scaleGrid(gridSize, imageSize, ctx);
    const puzzleSize = strategy.inscribePuzzleSize(imageSize, generationGrid, ctx);
    const pieces = strategy.generatePieces(generationGrid, puzzleSize, seed, ctx);

    const groups = createInitialGroups(pieces, puzzleSize, viewport, gridSize, options);

    return {
        pieces,
        groups,
        imageUrl,
        imageSize: puzzleSize,
        gridSize,
        completed: false,
        seed,
        cutStyle,
        rotationMode,
        composableConfig: strategy.configKey === 'composableConfig' ? options.composableConfig : undefined,
        fractalConfig: strategy.configKey === 'fractalConfig' ? options.fractalConfig : undefined,
    };
}

/**
 * Create one single-piece group per piece with randomized positions.
 *
 * Positions are distributed within the usable area of the viewport,
 * accounting for piece dimensions so pieces stay fully visible.
 *
 * @param pieces - All puzzle pieces
 * @param imageSize - Puzzle image dimensions (to compute piece cell size)
 * @param viewport - Available viewport dimensions
 * @param gridSize - Grid dimensions (cols × rows)
 * @param options - Optional configuration
 */
export function createInitialGroups(
    pieces: Piece[],
    imageSize: Size,
    viewport: Size,
    gridSize: GridSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    options: InitOptions = {},
): PieceGroup[] {
    const random = options.random ?? Math.random;
    const cols = gridSize.cols;
    const rows = gridSize.rows;

    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    const positions = randomizePositions(
        pieces.length,
        pieceWidth,
        pieceHeight,
        viewport,
        random,
    );

    const pickInitialRotation: () => 0 | 1 | 2 | 3 =
        options.rotationMode === 'quarter-turn'
            ? () => Math.floor(random() * 4) as 0 | 1 | 2 | 3
            : () => 0;

    return pieces.map((piece, index) => ({
        id: piece.id,
        pieces: new Map([[piece.id, { x: 0, y: 0 }]]),
        position: positions[index],
        rotation: pickInitialRotation(),
    }));
}

/**
 * Generate random positions for n pieces within the viewport.
 *
 * Each position ensures the piece stays fully visible:
 * - x: from VIEWPORT_MARGIN to (viewport.width - pieceWidth - VIEWPORT_MARGIN)
 * - y: from VIEWPORT_MARGIN to (viewport.height - pieceHeight - VIEWPORT_MARGIN)
 *
 * If the viewport is too small to fit pieces with margin,
 * positions are clamped to at least 0.
 */
export function randomizePositions(
    count: number,
    pieceWidth: number,
    pieceHeight: number,
    viewport: Size,
    random: () => number,
): Array<{ x: number; y: number }> {
    const minX = VIEWPORT_MARGIN;
    const minY = VIEWPORT_MARGIN;
    const maxX = Math.max(minX, viewport.width - pieceWidth - VIEWPORT_MARGIN);
    const maxY = Math.max(minY, viewport.height - pieceHeight - VIEWPORT_MARGIN);

    return Array.from({ length: count }, () => ({
        x: minX + random() * (maxX - minX),
        y: minY + random() * (maxY - minY),
    }));
}
