/**
 * Composable puzzle generator.
 *
 * Uses the composable architecture with separate layers for:
 *   1. Grid cuts (row/column definitions)
 *   2. Tab shapes (standalone templates)
 *   3. Composition (placing tabs on edges)
 *
 * See issue #127 for the design and sub-issues #128–#133 for
 * research decisions.
 */

import type { Piece, Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';
import { generateWavyGrid } from './composable/grid-cuts.js';
import { classicTabTemplate } from './composable/tab-shapes.js';
import { composePuzzle } from './composable/compose.js';

/**
 * Configuration for the composable generator.
 * All parameters are optional — sensible defaults are used.
 */
export interface ComposableConfig {
    /** Grid waviness amplitude (0 = straight, 0.3 = very wavy). Default: 0.12 */
    waveAmplitude?: number;
    /** Control points per grid segment (1 = gentle, 4 = wiggly). Default: 2 */
    waveControlPoints?: number;
}

/**
 * Generate a puzzle using the composable architecture.
 *
 * @param cols - Number of columns
 * @param rows - Number of rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible cuts
 * @param config - Optional composable configuration
 * @returns Array of pieces with full edge connectivity and SVG paths
 */
export function generateComposablePuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: ComposableConfig,
): Piece[] {
    const random = createSeededRandom(seed);

    // Layer 1: Grid cuts (wavy internal cuts, straight borders)
    const grid = generateWavyGrid(cols, rows, imageSize, random, {
        amplitude: config?.waveAmplitude,
        controlPointsPerSegment: config?.waveControlPoints,
    });

    // Layer 2: Tab template
    const template = classicTabTemplate;

    // Layer 3: Composition
    return composePuzzle(grid, template, random);
}
