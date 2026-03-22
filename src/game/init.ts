/**
 * Game initialization logic.
 *
 * Creates a new game state: generates pieces from the grid generator,
 * wraps each in its own single-piece group, and randomizes positions
 * within the viewport so all pieces are visible.
 */

import type { GameState, PieceGroup, Piece, Size } from '../model/types.js';
import { generateGridPuzzle } from '../puzzle/grid-generator.js';

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
}

/**
 * Create a new game state with randomized piece positions.
 *
 * @param imageUrl - URL of the puzzle image
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param viewport - Available viewport size for positioning pieces
 * @param options - Optional configuration (e.g. custom RNG)
 */
export function createNewGame(
    imageUrl: string,
    imageSize: Size,
    viewport: Size,
    options: InitOptions = {},
): GameState {
    const pieces = generateGridPuzzle(DEFAULT_COLS, DEFAULT_ROWS, imageSize);
    const groups = createInitialGroups(pieces, imageSize, viewport, options);

    return {
        pieces,
        groups,
        imageUrl,
        imageSize,
        completed: false,
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
 * @param options - Optional configuration
 */
export function createInitialGroups(
    pieces: Piece[],
    imageSize: Size,
    viewport: Size,
    options: InitOptions = {},
): PieceGroup[] {
    const random = options.random ?? Math.random;
    const cols = DEFAULT_COLS;
    const rows = DEFAULT_ROWS;

    const pieceWidth = imageSize.width / cols;
    const pieceHeight = imageSize.height / rows;

    const positions = randomizePositions(
        pieces.length,
        pieceWidth,
        pieceHeight,
        viewport,
        random,
    );

    return pieces.map((piece, index) => ({
        id: piece.id,
        pieces: new Map([[piece.id, { x: 0, y: 0 }]]),
        position: positions[index],
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
