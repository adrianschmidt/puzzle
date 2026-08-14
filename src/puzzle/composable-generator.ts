/**
 * Creates a seeded PRNG and forwards the opaque `ComposableConfig` to the
 * topology pipeline (`topology/generator.ts`), which does the real work.
 */

import type { Size } from '../model/types.js';
import { createSeededRandom } from './seeded-random.js';
import { generateTopologyPuzzle } from './topology/generator.js';
import type { TopologyPuzzle } from './topology/generator.js';
import type { TabDebugSession } from './topology/tab-debug.js';

/**
 * Both `*Config` records pass straight through to the registered generator,
 * which validates its own keys.
 */
export interface ComposableConfig {
    /** BaseCutGenerator id. Default: 'sine'. */
    baseCutGenerator?: string;
    baseCutConfig?: Record<string, unknown>;
    /** TabGenerator id. Default: 'classic'. Use 'none' to skip tabs. */
    tabGenerator?: string;
    tabConfig?: Record<string, unknown>;
    /**
     * Minimum area (px²) for a piece to stand alone; smaller pieces auto-group
     * with a neighbour. Empirical default ({@link DEFAULT_MIN_PIECE_AREA})
     * absorbs bezier-js sub-pixel-area noise without eating real small pieces.
     */
    minPieceArea?: number;
    /**
     * Borderless mode (see {@link TopologyGeneratorConfig.borderless}).
     * Honoured only by base cut generators that support it (sine).
     */
    borderless?: boolean;
    /**
     * Dev-time tab-debug session, plumbed through to
     * {@link TopologyGeneratorConfig.tabDebug}. Undefined in production.
     */
    tabDebug?: TabDebugSession;
}

/**
 * Default {@link ComposableConfig.minPieceArea}: a 2×2 px square — big enough
 * to clear sub-pixel sliver faces from curve-intersection rounding, small
 * enough to keep any visible piece.
 */
export const DEFAULT_MIN_PIECE_AREA = 4;

/**
 * Returns `{ pieces, autoGroups }`; autoGroups lets gameplay present tiny
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
        tabDebug: config?.tabDebug,
        borderless: config?.borderless,
    });
}
