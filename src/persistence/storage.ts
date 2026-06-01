/**
 * Persistence layer for puzzle game state.
 *
 * Two-key model:
 * - STORAGE_KEY  ('puzzle-game-state')  — static geometry + metadata, written once per puzzle.
 * - PROGRESS_KEY ('puzzle-progress')    — small mutable blob (groups/selection/completed),
 *                                         written on every debounced save.
 *
 * All serialization/deserialization goes through the serialization module.
 */

import { diagnostics } from '../diagnostics.js';
import type { GameState } from '../model/types.js';
import {
    serializeStatic,
    serializeProgress,
    deserializeState,
    recombine,
    readSelection,
    type SerializedStaticState,
    type SerializedProgress,
    type SerializedGameState,
} from './serialization.js';
import { compressForStorage, decompressFromStorage } from './compression.js';

/** localStorage key for the static geometry + metadata blob. */
export const STORAGE_KEY = 'puzzle-game-state';

/** localStorage key for the small mutable progress blob (groups/selection/completed). */
export const PROGRESS_KEY = 'puzzle-progress';

/** Debounce interval for auto-save (milliseconds). */
export const SAVE_DEBOUNCE_MS = 500;

/** Outcome of a save call. */
export type SaveResult = 'ok' | 'ok-compressed' | 'failed';

/**
 * Write a value to a localStorage key with compress-on-overflow.
 *
 * Tries a plain write; on any throw (quota on most browsers) retries once with
 * an lz-string-compressed payload. If both throw, the previous value at `key`
 * is left intact (we never clear it first) and `'failed'` is returned.
 */
function writeWithOverflow(key: string, json: string): SaveResult {
    try {
        localStorage.setItem(key, json);
        return 'ok';
    } catch {
        try {
            localStorage.setItem(key, compressForStorage(json));
            return 'ok-compressed';
        } catch (error) {
            diagnostics.warn(
                `Failed to save "${key}" (quota or other storage error, even after compression):`,
                error,
            );
            return 'failed';
        }
    }
}

/** Persist the static geometry + metadata blob. Written once per puzzle. */
export function saveGeometry(state: GameState): SaveResult {
    return writeWithOverflow(STORAGE_KEY, JSON.stringify(serializeStatic(state)));
}

/** Persist the small mutable progress blob. Written on every debounced save. */
export function saveProgress(state: GameState, selection?: Iterable<number>): SaveResult {
    return writeWithOverflow(PROGRESS_KEY, JSON.stringify(serializeProgress(state, selection)));
}

/**
 * Persist a freshly created puzzle: geometry (once) + initial progress.
 * Used on new game and share-link load. Worst sub-result wins.
 */
export function saveNewPuzzle(state: GameState, selection?: Iterable<number>): SaveResult {
    const g = saveGeometry(state);
    const p = saveProgress(state, selection);
    if (g === 'failed' || p === 'failed') return 'failed';
    if (g === 'ok-compressed' || p === 'ok-compressed') return 'ok-compressed';
    return 'ok';
}

/**
 * Load the saved game and its multi-select selection.
 *
 * New split format: a STATIC blob (geometry + metadata) plus a PROGRESS blob
 * (groups/selection/completed) recombined into a GameState. Falls back to the
 * legacy single-key full blob (groups inline) when no progress key exists.
 * A geometry/progress pair with mismatched seeds, or a v11 static blob with no
 * progress, is treated as "no valid save".
 *
 * Never throws — all errors are caught and logged.
 */
export function loadSavedGame(): { state: GameState; selection: number[] } | undefined {
    try {
        const staticRaw = localStorage.getItem(STORAGE_KEY);
        if (staticRaw === null) {
            return undefined;
        }
        const staticData: SerializedStaticState & SerializedGameState = JSON.parse(
            decompressFromStorage(staticRaw),
        );

        const progressRaw = localStorage.getItem(PROGRESS_KEY);
        if (progressRaw !== null) {
            const progress: SerializedProgress = JSON.parse(decompressFromStorage(progressRaw));
            // The guard only fires when both seeds are present. That is safe:
            // every puzzle created by `createNewGame` is assigned a seed, so both
            // blobs always carry one; the only seedless blobs are pre-v4 legacy
            // saves, which have no progress key and take the single-key path
            // below. Two seedless blobs from different puzzles is unreachable.
            if (
                staticData.seed !== undefined &&
                progress.seed !== undefined &&
                staticData.seed !== progress.seed
            ) {
                // Torn / cross-puzzle pair — don't load a mismatched puzzle.
                diagnostics.warn(
                    'Discarding saved game: geometry/progress seeds do not match (torn or cross-puzzle write).',
                );
                return undefined;
            }
            return { state: recombine(staticData, progress), selection: readSelection(progress) };
        }

        // No progress key: a legacy single-key blob has groups inline.
        if (Array.isArray(staticData.groups) && staticData.groups.length > 0) {
            return { state: deserializeState(staticData), selection: readSelection(staticData) };
        }

        // v11 static blob with no progress = torn write — nothing to restore.
        diagnostics.warn(
            'Discarding saved game: geometry present but no progress (torn write).',
        );
        return undefined;
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
    localStorage.removeItem(PROGRESS_KEY);
}

/**
 * Create a debounced save function.
 *
 * Returns a function that, when called with a GameState,
 * schedules a progress save after SAVE_DEBOUNCE_MS. Repeated calls
 * within the interval reset the timer (only the last state is saved).
 *
 * Also returns a `flush` method to save immediately and
 * a `cancel` method to discard the pending save.
 *
 * The optional `onSaveFailed` callback is invoked when a flushed save cannot
 * be persisted (quota exceeded even after compression), so the caller can
 * warn the user that their progress was not saved.
 */
export function createDebouncedSave(onSaveFailed?: () => void): {
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
            const result = saveProgress(pendingState, pendingSelection ?? []);
            pendingState = null;
            pendingSelection = null;
            if (result === 'failed') {
                onSaveFailed?.();
            }
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
