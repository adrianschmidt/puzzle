/**
 * Game initialization logic.
 *
 * Creates a new game state: generates pieces using the configured cut
 * style's generator, wraps each in its own single-piece group, and
 * randomizes positions within the viewport so all pieces are visible.
 */

import type { GameState, PieceGroup, Piece, Size, GridSize } from '../model/types.js';
import { generateProceduralPuzzle } from '../puzzle/procedural-generator.js';
import { generateFractalPuzzle, scaleFractalGrid } from '../puzzle/fractal-generator.js';
import type { FractalConfig } from '../puzzle/fractal-generator.js';
import { generateComposablePuzzle } from '../puzzle/composable-generator.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import { generateSeed } from '../puzzle/seeded-random.js';
import type { CutStyle } from './cut-styles.js';

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

    // For fractal puzzles, scale the tile grid to produce approximately
    // the target piece count. The gridSize cols×rows for classic puzzles
    // equals the piece count, but fractal pieces span multiple tiles.
    const fractalGrid = cutStyle === 'fractal'
        ? scaleFractalGrid(
            gridSize.cols * gridSize.rows,
            imageSize.width / imageSize.height,
            options.fractalConfig?.borderless ?? false,
        )
        : undefined;

    // Fractal arcs must scale uniformly to stay circular. We inscribe a
    // rectangle of the grid's aspect ratio inside the image; the renderer
    // covers this puzzle rectangle with the image via SVG `slice`, cropping
    // what sticks out. For non-fractal cuts the puzzle fills the image as
    // before.
    const puzzleSize = cutStyle === 'fractal' && fractalGrid
        ? inscribeToGridAspect(
            imageSize,
            options.fractalConfig?.borderless ?? false
                ? fractalGrid.cols / fractalGrid.rows
                : (fractalGrid.cols - 1) / (fractalGrid.rows - 1),
        )
        : imageSize;

    let pieces: Piece[];
    if (cutStyle === 'fractal') {
        pieces = generateFractalPuzzle(fractalGrid!.cols, fractalGrid!.rows, puzzleSize, seed, options.fractalConfig);
    } else if (cutStyle === 'composable') {
        pieces = generateComposablePuzzle(gridSize.cols, gridSize.rows, puzzleSize, seed, options.composableConfig);
    } else {
        pieces = generateProceduralPuzzle(gridSize.cols, gridSize.rows, puzzleSize, seed);
    }

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
        composableConfig: cutStyle === 'composable' ? options.composableConfig : undefined,
        fractalConfig: cutStyle === 'fractal' ? options.fractalConfig : undefined,
    };
}

/**
 * Return the largest rectangle of `gridAspect` that fits inside `imageSize`,
 * centred. Used for fractal puzzles so the tile grid scales uniformly
 * (arcs stay circular) and the image is cropped to cover the puzzle rect.
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
