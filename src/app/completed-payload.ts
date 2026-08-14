import type { GameState } from '../model/types.js';
import type { NewGameData, PuzzleCompletedData } from '../analytics/index.js';
import { classifyImageSource } from './classify-image-source.js';
import { traceSetVersionOf } from './trace-set-version.js';

/**
 * Derives geometry/style from gameState (so resumed games still get a useful
 * event), then merges in any cached NewGameData fields state can't recover
 * (source, imageCategory, vibrant).
 */
export function buildPuzzleCompletedData(
    state: GameState,
    cached: NewGameData | null,
): PuzzleCompletedData {
    const derived: PuzzleCompletedData = {
        cutStyle: state.cutStyle ?? 'classic',
        rotationMode: state.rotationMode ?? 'none',
        cols: state.gridSize.cols,
        rows: state.gridSize.rows,
        pieceCount: state.pieces.length,
        imageSource: classifyImageSource(state.imageUrl),
    };

    // For Classic, separates sine-generated puzzles from legacy ones on the
    // completion event — the metric for whether the new cut works.
    const traceSetVersion = traceSetVersionOf(state);
    if (traceSetVersion !== undefined) {
        derived.traceSetVersion = traceSetVersion;
    }

    if (cached) {
        return { ...derived, ...cached };
    }

    return derived;
}
