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
 * Generate a puzzle using the composable architecture.
 *
 * Currently uses straight grid cuts and the classic tab template.
 * Future versions will accept configuration for different grid styles,
 * tab templates, and composition parameters.
 *
 * @param cols - Number of columns
 * @param rows - Number of rows
 * @param imageSize - Pixel dimensions of the puzzle image
 * @param seed - PRNG seed for reproducible cuts
 * @returns Array of pieces with full edge connectivity and SVG paths
 */
export function generateComposablePuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
): Piece[] {
    const random = createSeededRandom(seed);

    // Layer 1: Grid cuts (wavy internal cuts, straight borders)
    const grid = generateWavyGrid(cols, rows, imageSize, random);

    // Layer 2: Tab template
    const template = classicTabTemplate;

    // Layer 3: Composition
    return composePuzzle(grid, template, random);
}
