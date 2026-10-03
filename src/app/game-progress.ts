import type { GameState } from '../model/types.js';

export function gameProgress(state: GameState): number {
    const pieces = state.pieces.length;
    const progress = pieces > 1 ? 1 - (state.groups.length - 1) / (pieces - 1) : 1;
    return Math.round(progress * 1000) / 1000;
}
