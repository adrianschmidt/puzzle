/**
 * Composable puzzle generator (entry point).
 *
 * Thin wrapper that creates a seeded PRNG and forwards an opaque
 * `ComposableConfig` to the topology pipeline. The topology layer
 * (see `topology/generator.ts`) does the real work:
 *
 *   1. Look up the BaseCutGenerator by id and call it to produce
 *      input cuts.
 *   2. Build the topology graph in a single intersection pass.
 *   3. Apply the TabGenerator per shared internal edge with
 *      framework-owned collision rejection.
 *   4. Convert faces → PieceDefinitions → final Piece[] via
 *      composePuzzle (with disableTabs:true since tabs are already
 *      in the edge geometry).
 *
 * See issue #127 for the composable design,
 * and #166 for the topology-driven approach.
 */

import type { Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';
import { generateTopologyPuzzle } from './topology/generator.js';
import type { TopologyPuzzle } from './topology/generator.js';

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
    /**
     * Absolute floor (px², bbox area) for a piece to stand alone;
     * smaller pieces are auto-grouped with a neighbour. Defaults to
     * {@link DEFAULT_MIN_PIECE_AREA}, an empirical value that absorbs
     * bezier-js sub-pixel-area numerical noise without consuming
     * legitimate small pieces.
     *
     * On top of this floor an adaptive threshold (see
     * {@link minPieceAreaGapRatio}) bumps the effective cutoff when
     * the bbox-area distribution is bimodal — that's what catches
     * tab-fold-back islands at extreme amplitude/frequency settings.
     */
    minPieceArea?: number;
    /**
     * Multiplicative gap that defines "junk-vs-real" in the bbox-area
     * distribution for adaptive auto-grouping. When the sorted piece
     * bbox areas have a consecutive ratio at or above this value, the
     * geometric mean of the two straddling areas becomes the effective
     * threshold (on top of {@link minPieceArea}). Defaults to
     * {@link DEFAULT_MIN_PIECE_AREA_GAP_RATIO}. Use `Infinity` to
     * disable the adaptive threshold (only the absolute floor
     * applies).
     */
    minPieceAreaGapRatio?: number;
}

/**
 * Default {@link ComposableConfig.minPieceArea}. A 2×2 px square: small
 * enough to leave any user-visible piece intact, large enough to clean
 * up sub-pixel sliver faces produced by curve-intersection rounding.
 */
export const DEFAULT_MIN_PIECE_AREA = 4;

/**
 * Default {@link ComposableConfig.minPieceAreaGapRatio}. Re-exported
 * from the topology layer where the heuristic lives.
 */
export { DEFAULT_MIN_PIECE_AREA_GAP_RATIO } from './topology/adaptive-threshold.js';

/**
 * Generate a puzzle using the topology-driven composable architecture.
 *
 * Thin pass-through to {@link generateTopologyPuzzle} — the only work
 * done here is creating the seeded PRNG and renaming the four config
 * fields onto the topology generator's `*Id` field names. Returns
 * `{ pieces, autoGroups }` so the gameplay layer can present tiny
 * residual faces as starting groups.
 */
export function generateComposablePuzzle(
    cols: number,
    rows: number,
    imageSize: Size,
    seed: number,
    config?: ComposableConfig,
): TopologyPuzzle {
    const random = createSeededRandom(seed);
    return generateTopologyPuzzle(cols, rows, imageSize, random, {
        baseCutGeneratorId: config?.baseCutGenerator ?? 'sine',
        baseCutConfig: config?.baseCutConfig,
        tabGeneratorId: config?.tabGenerator ?? 'classic',
        tabConfig: config?.tabConfig,
        minPieceArea: config?.minPieceArea ?? DEFAULT_MIN_PIECE_AREA,
        minPieceAreaGapRatio: config?.minPieceAreaGapRatio,
    });
}
