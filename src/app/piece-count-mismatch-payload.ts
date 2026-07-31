/**
 * Build the analytics payload attached to `piece-count-mismatch`.
 *
 * Derives from `buildReproParams` rather than reading `GameState` directly, so
 * the event and the info modal's "Reproduction parameters" block cannot drift
 * apart — a row in Umami is meant to paste straight into `__reproPuzzle`.
 * The one deliberate divergence is `imageUrl`, which is dropped; see
 * `PieceCountMismatchData` for why.
 */

import type { GameState } from '../model/types.js';
import type { PieceCountMismatchData } from '../analytics/index.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { buildReproParams } from '../sharing/index.js';

/**
 * Umami keeps 4 decimal places on numbers. Rounding here rather than letting
 * the tracker do it keeps the value we assert in tests identical to the value
 * that lands in the database.
 */
function toUmamiPrecision(value: number): number {
    return Math.round(value * 10000) / 10000;
}

export function buildPieceCountMismatchData(
    state: GameState,
    mismatch: PieceCountMismatch,
    source: 'fresh' | 'shared' | 'repro',
): PieceCountMismatchData {
    const repro = buildReproParams(state);

    // Exactly one of these is present on any given puzzle; `??` picks it
    // without needing to switch on cutStyle, which would be a fifth
    // hand-maintained per-style touch point (#492).
    const styleConfig =
        repro.classicConfig ??
        repro.wavyConfig ??
        repro.trianglesConfig ??
        repro.fractalConfig ??
        repro.composableConfig;

    // The `?? -1` fallbacks below are unreachable for a generated puzzle —
    // createNewGame always sets seed, gridSize and imageSize — but ReproParams
    // types every field optional because it is also hand-typed from a
    // screenshot. -1 rather than dropping the event: a diagnostic that
    // silently declines to report is worse than one carrying an obviously
    // impossible value, which is visible in the data as a bug in THIS code.
    const data: PieceCountMismatchData = {
        cutStyle: repro.cutStyle ?? 'classic',
        baseCut: mismatch.baseCutId,
        expected: mismatch.expected,
        actual: mismatch.actual,
        seed: repro.seed ?? -1,
        cols: repro.gridSize?.cols ?? -1,
        rows: repro.gridSize?.rows ?? -1,
        imageWidth: toUmamiPrecision(repro.imageSize?.width ?? -1),
        imageHeight: toUmamiPrecision(repro.imageSize?.height ?? -1),
        rotationMode: repro.rotationMode ?? 'none',
        source,
    };

    if (styleConfig !== undefined) {
        data.styleConfig = JSON.stringify(styleConfig);
    }

    return data;
}
