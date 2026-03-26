/**
 * Composable puzzle generator.
 *
 * Uses the composable architecture with separate layers for:
 *   1. Grid cuts (row/column definitions → abstract PieceDefinitions)
 *   2. Tab shapes (standalone templates in normalized space)
 *   3. Composition (placing tabs on edges using tangent/normal frame)
 *
 * See issue #127 for the design, #154 for the abstract edge approach,
 * and docs/composable-reference/ for the tab-clamping reference.
 */

import type { Piece, Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';
import { generateWavyGrid, gridToPieceDefinitions } from './composable/grid-cuts.js';
import { classicTabTemplate } from './composable/tab-shapes.js';
import { composePuzzle } from './composable/compose.js';

/**
 * Configuration for the composable generator.
 * All parameters are optional — sensible defaults are used.
 */
export interface ComposableConfig {
    /** Horizontal cut wave amplitude (0–0.5, fraction of piece height). Default: 0 */
    horizontalAmplitude?: number;
    /** Horizontal cut wave frequency in Hz (0–10). Default: 0 */
    horizontalFrequency?: number;
    /** Vertical cut wave amplitude (0–0.5, fraction of piece width). Default: 0 */
    verticalAmplitude?: number;
    /** Vertical cut wave frequency in Hz (0–10). Default: 0 */
    verticalFrequency?: number;
}

/**
 * Generate a puzzle using the composable architecture.
 */
export function generateComposablePuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: ComposableConfig,
): Piece[] {
    const random = createSeededRandom(seed);

    // Layer 1: Grid cuts → abstract piece definitions
    const grid = generateWavyGrid(cols, rows, imageSize, random, {
        horizontalAmplitude: config?.horizontalAmplitude,
        horizontalFrequency: config?.horizontalFrequency,
        verticalAmplitude: config?.verticalAmplitude,
        verticalFrequency: config?.verticalFrequency,
    });
    const pieceDefs = gridToPieceDefinitions(grid);

    // Layer 2: Tab template
    const template = classicTabTemplate;

    // Layer 3: Composition (works with abstract edges, no grid knowledge)
    return composePuzzle(pieceDefs, template, random);
}
