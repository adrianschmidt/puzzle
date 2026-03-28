/**
 * Composable puzzle generator.
 *
 * Uses the topology-driven architecture:
 *   1. Generate border + internal cut lines as Curves
 *   2. Optionally merge tabs into internal cuts
 *   3. Build DCEL → find faces → extract PieceDefinitions
 *   4. Compose final Piece[] via the composition layer
 *
 * See issue #127 for the composable design,
 * and #166 for the topology-driven approach.
 */

import type { Piece, Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';
import { generateTopologyPuzzle } from './topology/generator.js';

/**
 * Configuration for the composable generator.
 * All parameters are optional — sensible defaults are used.
 */
export interface ComposableConfig {
    /** Horizontal cut wave amplitude (0–0.5, fraction of piece height). Default: 0.15 */
    horizontalAmplitude?: number;
    /** Horizontal cut wave frequency in Hz (0–10). Default: 1.5 */
    horizontalFrequency?: number;
    /** Vertical cut wave amplitude (0–0.5, fraction of piece width). Default: 0.15 */
    verticalAmplitude?: number;
    /** Vertical cut wave frequency in Hz (0–10). Default: 1.5 */
    verticalFrequency?: number;
    /** When true, skip tab generation — all shared edges are flat lines. Default: false */
    disableTabs?: boolean;
}

/**
 * Generate a puzzle using the topology-driven composable architecture.
 */
export function generateComposablePuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: ComposableConfig,
): Piece[] {
    const random = createSeededRandom(seed);

    return generateTopologyPuzzle(cols, rows, imageSize, random, {
        horizontalAmplitude: config?.horizontalAmplitude,
        horizontalFrequency: config?.horizontalFrequency,
        verticalAmplitude: config?.verticalAmplitude,
        verticalFrequency: config?.verticalFrequency,
        disableTabs: config?.disableTabs,
    });
}
