import type { GameState } from '../model/types.js';
import type { ReplacedGameData } from '../analytics/index.js';
import { gameProgress } from './game-progress.js';

export function buildReplacedGameData(
    outgoing: GameState,
    elapsedMs: number | undefined,
): ReplacedGameData {
    const data: ReplacedGameData = {
        replacedProgress: gameProgress(outgoing),
        replacedCompleted: outgoing.completed,
        replacedPieceCount: outgoing.pieces.length,
        replacedCutStyle: outgoing.cutStyle ?? 'classic',
    };
    if (elapsedMs !== undefined) {
        data.replacedElapsedMs = elapsedMs;
    }
    return data;
}
