/**
 * Persistence layer for puzzle game state.
 *
 * Saves and loads GameState to/from localStorage with debounced writes.
 * All serialization/deserialization goes through the serialization module.
 */

import type { GameState } from '../model/types.js';
import {
    serializeState,
    deserializeState,
    type SerializedGameState,
} from './serialization.js';

/** localStorage key for the saved game state. */
export const STORAGE_KEY = 'puzzle-game-state';

/** Debounce interval for auto-save (milliseconds). */
export const SAVE_DEBOUNCE_MS = 500;

/**
 * Save a GameState to localStorage.
 *
 * Serializes the state (converting Maps to entries arrays)
 * and writes it as JSON.
 */
export function saveState(state: GameState): void {
    const serialized = serializeState(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
}

/**
 * Load a saved GameState from localStorage.
 *
 * Returns the restored GameState, or `undefined` if:
 * - No saved state exists
 * - The saved data is corrupted or unparseable
 * - The state version is unsupported
 *
 * Never throws — all errors are caught and logged.
 */
export function loadState(): GameState | undefined {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (raw === null) {
            return undefined;
        }

        const parsed: SerializedGameState = JSON.parse(raw);

        return deserializeState(parsed);
    } catch (error) {
        console.warn('Failed to restore saved game state:', error);

        return undefined;
    }
}

/**
 * Clear any saved game state from localStorage.
 */
export function clearSavedState(): void {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Create a debounced save function.
 *
 * Returns a function that, when called with a GameState,
 * schedules a save after SAVE_DEBOUNCE_MS. Repeated calls
 * within the interval reset the timer (only the last state
 * is saved).
 *
 * Also returns a `flush` method to save immediately and
 * a `cancel` method to discard the pending save.
 */
export function createDebouncedSave(): {
    save: (state: GameState) => void;
    flush: () => void;
    cancel: () => void;
} {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingState: GameState | null = null;

    function save(state: GameState): void {
        pendingState = state;

        if (timer !== null) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            if (pendingState !== null) {
                saveState(pendingState);
                pendingState = null;
            }

            timer = null;
        }, SAVE_DEBOUNCE_MS);
    }

    function flush(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        if (pendingState !== null) {
            saveState(pendingState);
            pendingState = null;
        }
    }

    function cancel(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        pendingState = null;
    }

    return { save, flush, cancel };
}
