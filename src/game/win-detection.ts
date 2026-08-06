import type { GameState } from '../model/types.js';

export function checkWin(state: GameState): boolean {
    if (state.groups.length !== 1) {
        return false;
    }

    return state.groups[0].pieces.size === state.pieces.length;
}

export function checkAndMarkWin(state: GameState): boolean {
    if (state.completed) {
        return false;
    }

    if (checkWin(state)) {
        state.completed = true;

        return true;
    }

    return false;
}
