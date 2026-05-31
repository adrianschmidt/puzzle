/**
 * Persistence layer for puzzle game state.
 *
 * Saves and loads GameState to/from localStorage with debounced writes.
 * All serialization/deserialization goes through the serialization module.
 */

import { diagnostics } from '../diagnostics.js';
import type { GameState } from '../model/types.js';
import {
    serializeState,
    deserializeState,
    readSelection,
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
 * and writes it as JSON. The optional multi-select `selection` (group ids)
 * is stored alongside it so it survives a reload.
 */
export function saveState(state: GameState, selection?: Iterable<number>): void {
    const serialized = serializeState(state, selection);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
}

/**
 * Load the saved game together with its persisted multi-select selection.
 *
 * Both come from a single parse of the one `STORAGE_KEY` blob — the
 * selection is stored *inside* the serialized state, so reading them
 * together preserves the "one key, one parse" model. The selection ids are
 * sanitized but not checked against the live groups — the caller prunes ids
 * that no longer exist.
 *
 * Returns `undefined` if:
 * - No saved state exists
 * - The saved data is corrupted or unparseable
 * - The state version is unsupported
 *
 * Never throws — all errors are caught and logged.
 */
export function loadSavedGame(): { state: GameState; selection: number[] } | undefined {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (raw === null) {
            return undefined;
        }

        const parsed: SerializedGameState = JSON.parse(raw);

        return { state: deserializeState(parsed), selection: readSelection(parsed) };
    } catch (error) {
        diagnostics.warn('Failed to restore saved game state:', error);

        return undefined;
    }
}

/**
 * Load just the saved GameState, discarding any persisted selection.
 *
 * Thin wrapper over {@link loadSavedGame} for the existence check and any
 * caller that does not need the selection.
 */
export function loadState(): GameState | undefined {
    return loadSavedGame()?.state;
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
    save: (state: GameState, selection?: Iterable<number>) => void;
    flush: () => void;
    cancel: () => void;
} {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingState: GameState | null = null;
    // Snapshot of the selection captured with the pending state. `null` means
    // "no pending save"; an empty array means "save with an empty selection".
    let pendingSelection: number[] | null = null;

    function flushPending(): void {
        if (pendingState !== null) {
            saveState(pendingState, pendingSelection ?? []);
            pendingState = null;
            pendingSelection = null;
        }
    }

    function save(state: GameState, selection?: Iterable<number>): void {
        pendingState = state;
        pendingSelection = selection === undefined ? [] : [...selection];

        if (timer !== null) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            flushPending();
            timer = null;
        }, SAVE_DEBOUNCE_MS);
    }

    function flush(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        flushPending();
    }

    function cancel(): void {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }

        pendingState = null;
        pendingSelection = null;
    }

    return { save, flush, cancel };
}
