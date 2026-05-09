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
 *
 * Identifies the BaseCutGenerator and TabGenerator plug-ins by id and
 * forwards their per-generator config opaquely. All fields are optional:
 *   - omitting `baseCutGenerator` defaults to `'sine'`
 *   - omitting `tabGenerator` defaults to `'classic'` (use `'none'` to skip tabs)
 *
 * The two `*Config` records are passed straight through to the registered
 * generator, which is solely responsible for validating its own keys.
 */
export interface ComposableConfig {
    /** BaseCutGenerator id (e.g. 'sine'). Default: 'sine'. */
    baseCutGenerator?: string;
    /** Generator-specific config, opaque to this module. */
    baseCutConfig?: Record<string, unknown>;
    /** TabGenerator id (e.g. 'classic'). Default: 'classic'. Use 'none' to skip tabs. */
    tabGenerator?: string;
    /** Generator-specific tab config. */
    tabConfig?: Record<string, unknown>;
}

/**
 * Generate a puzzle using the topology-driven composable architecture.
 *
 * Thin pass-through to {@link generateTopologyPuzzle} — the only work
 * done here is creating the seeded PRNG and renaming the four config
 * fields onto the topology generator's `*Id` field names.
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
        baseCutGeneratorId: config?.baseCutGenerator ?? 'sine',
        baseCutConfig: config?.baseCutConfig,
        tabGeneratorId: config?.tabGenerator ?? 'classic',
        tabConfig: config?.tabConfig,
    });
}
