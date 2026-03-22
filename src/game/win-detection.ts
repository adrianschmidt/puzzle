/**
 * Win detection — checks whether the puzzle has been completed.
 *
 * The puzzle is complete when all pieces belong to a single group.
 * This is checked after every merge operation.
 */

import type { GameState } from '../model/types.js';

/**
 * Check if the puzzle is complete.
 *
 * The puzzle is solved when there is exactly one group
 * and it contains all pieces. We verify both conditions
 * as a defensive check.
 *
 * @param state - The current game state
 * @returns true if all pieces are in a single group
 */
export function checkWin(state: GameState): boolean {
    if (state.groups.length !== 1) {
        return false;
    }

    return state.groups[0].pieces.size === state.pieces.length;
}

/**
 * Process win detection after a merge.
 *
 * Checks if the puzzle is complete and, if so, marks the
 * game state as completed.
 *
 * @param state - The current game state (mutated if win detected)
 * @returns true if the puzzle was just completed
 */
export function checkAndMarkWin(state: GameState): boolean {
    if (state.completed) {
        return false; // Already marked as completed
    }

    if (checkWin(state)) {
        state.completed = true;

        return true;
    }

    return false;
}
