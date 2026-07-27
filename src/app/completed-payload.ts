/**
 * Build the analytics payload attached to `puzzle-completed`, merging cached
 * new-game data with fields derived from the current game state.
 */

import type { GameState } from '../model/types.js';
import type { NewGameData, PuzzleCompletedData } from '../analytics/index.js';
import { classifyImageSource } from './classify-image-source.js';
import { traceSetVersionOf } from './trace-set-version.js';

/**
 * Build the analytics payload for a puzzle completion.
 *
 * Always derives geometry/style fields from gameState (so resumed
 * games still get a useful event), then merges in any cached
 * NewGameData fields the user wouldn't be able to recover otherwise
 * (source, imageCategory, vibrant, etc.).
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

    // For Classic this also separates sine-generated puzzles from legacy ones
    // on the completion event — the metric that says whether the new cut works.
    const traceSetVersion = traceSetVersionOf(state);
    if (traceSetVersion !== undefined) {
        derived.traceSetVersion = traceSetVersion;
    }

    if (cached) {
        return { ...derived, ...cached };
    }

    return derived;
}
