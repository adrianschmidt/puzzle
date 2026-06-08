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

/**
 * Outcome of a save call.
 *
 * - `'ok'` / `'ok-compressed'` — written (compressed on quota overflow).
 * - `'failed'`  — could not be written (quota even after compression).
 * - `'skipped'` — intentionally not written; see {@link saveProgress}.
 */
export type SaveResult = 'ok' | 'ok-compressed' | 'failed' | 'skipped';

/**
 * Raw, undecoded copy of the save blobs as they sat in localStorage.
 *
 * Captured when a save is found to be unreadable so the UI can offer it for
 * download before startup overwrites the keys with a fresh puzzle. `null`
 * for a key that was absent. Values are verbatim — possibly compressed,
 * possibly corrupt — which is exactly what a recovery/bug-report copy wants.
 */
export interface CorruptSaveData {
    geometry: string | null;
    progress: string | null;
}

/**
 * Why a present save could not be restored. Low-cardinality, suitable as an
 * analytics dimension.
 *
 * - `parse-error`   — JSON/decompress/deserialize threw (corruption or an
 *                     unsupported version).
 * - `seed-mismatch` — geometry and progress blobs are from different puzzles.
 * - `torn-write`    — geometry present but no usable progress (interrupted save).
 */
export type UnreadableReason = 'parse-error' | 'seed-mismatch' | 'torn-write';

/**
 * Outcome of a load call.
 *
 * - `ok`         — a playable state was restored.
 * - `empty`      — no save is present (the geometry key is absent).
 * - `unreadable` — a save was present but could not be turned into a playable
 *                  state. Carries `reason` (for telemetry) and the verbatim raw
 *                  blobs so the caller can offer them for download before they
 *                  are overwritten, rather than silently destroying the data.
 */
export type LoadOutcome =
    | { status: 'ok'; state: GameState; selection: number[] }
    | { status: 'empty' }
    | { status: 'unreadable'; reason: UnreadableReason; raw: CorruptSaveData };

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

// Cache of the stored geometry's seed, keyed on the verbatim raw geometry
// string. A debounced progress save runs often; decoding the (potentially
// multi-MB) geometry blob on every call just to read its seed would be
// wasteful. Correctness comes from reading the real value on every call — we
// only re-run decompress+parse when the raw bytes differ from the last decode.
// A cross-tab geometry write (or a new puzzle in this tab) changes the bytes
// and invalidates the cache lazily on the next read.
let cachedGeometryRaw: string | null = null;
let cachedGeometrySeed: number | undefined;

/**
 * Seed of the geometry currently in localStorage, or `undefined` if there is no
 * geometry, it cannot be decoded, or it carries no seed. Never throws.
 */
function currentGeometrySeed(): number | undefined {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
        cachedGeometryRaw = null;
        cachedGeometrySeed = undefined;
        return undefined;
    }
    if (raw !== cachedGeometryRaw) {
        cachedGeometryRaw = raw;
        try {
            const parsed = JSON.parse(decompressFromStorage(raw)) as { seed?: unknown };
            cachedGeometrySeed = typeof parsed.seed === 'number' ? parsed.seed : undefined;
        } catch {
            // Unreadable geometry: don't block progress writes on it.
            cachedGeometrySeed = undefined;
        }
    }
    return cachedGeometrySeed;
}

/** Persist the static geometry + metadata blob. Written once per puzzle. */
export function saveGeometry(state: GameState): SaveResult {
    return writeWithOverflow(STORAGE_KEY, JSON.stringify(serializeStatic(state)));
}

/**
 * Persist the small mutable progress blob. Written on every debounced save.
 *
 * Refuses to write (returns `'skipped'`) when the geometry currently in
 * localStorage belongs to a *different* puzzle than `state` — e.g. another tab
 * on the same origin started a new puzzle while this tab still holds the old
 * one. Writing here would tear the geometry/progress pair into a seed-mismatch
 * that the next load rejects as a false "corrupt save" (#404). The geometry key
 * is the anchor; the tab that last wrote it owns the single save slot. Only a
 * confirmed seed mismatch skips — absent / unreadable / seedless geometry writes
 * as before.
 */
export function saveProgress(state: GameState, selection?: Iterable<number>): SaveResult {
    const geometrySeed = currentGeometrySeed();
    if (
        geometrySeed !== undefined &&
        state.seed !== undefined &&
        geometrySeed !== state.seed
    ) {
        diagnostics.warn(
            'Skipping progress save: stored geometry belongs to a different puzzle ' +
                '(cross-tab takeover); not overwriting it.',
        );
        return 'skipped';
    }
    return writeWithOverflow(PROGRESS_KEY, JSON.stringify(serializeProgress(state, selection)));
}

/**
 * Persist a freshly created puzzle: geometry (once) + initial progress.
 * Used on new game and share-link load. Worst sub-result wins.
 */
export function saveNewPuzzle(state: GameState, selection?: Iterable<number>): SaveResult {
    const g = saveGeometry(state);
    if (g === 'failed') {
        // The new geometry was too large to persist even compressed; the previous
        // puzzle's geometry is still at STORAGE_KEY. Don't write the new progress
        // on top of it — that would be a seed-mismatch (#404). Leaving the
        // previous pair untouched keeps it loadable; the new puzzle simply won't
        // persist (the caller surfaces a "too large to save" toast). The
        // saveProgress seed-guard likewise drops later autosaves of the new
        // puzzle, so the previous pair stays consistent.
        return 'failed';
    }
    const p = saveProgress(state, selection);
    if (p === 'failed') return 'failed';
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
 * progress, is treated as a present-but-unreadable save.
 *
 * Never throws. The geometry key being absent yields `empty`; any other
 * failure to restore yields `unreadable` carrying the raw blobs (see
 * {@link CorruptSaveData}) so the caller can offer them for download instead
 * of silently destroying the data.
 */
export function loadSavedGame(): LoadOutcome {
    const staticRaw = localStorage.getItem(STORAGE_KEY);
    if (staticRaw === null) {
        // No geometry anchor = no save the player would recognize. (A stray
        // progress key, if any, is a harmless torn-write artifact that the
        // next save overwrites.)
        return { status: 'empty' };
    }

    // From here a save is present. Any path that fails to produce a playable
    // state reports `unreadable` with the raw blobs attached, so startup can
    // warn the user and offer the data for download instead of silently
    // regenerating over a lost puzzle.
    //
    // Read both raw blobs up front (one read each) so every unreadable branch —
    // including the catch, where a parse can throw before the progress key is
    // decoded — can attach the verbatim data without a second large-blob read.
    const progressRaw = localStorage.getItem(PROGRESS_KEY);
    const raw: CorruptSaveData = { geometry: staticRaw, progress: progressRaw };

    try {
        const staticData: SerializedStaticState & SerializedGameState = JSON.parse(
            decompressFromStorage(staticRaw),
        );

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
                return { status: 'unreadable', reason: 'seed-mismatch', raw };
            }
            return {
                status: 'ok',
                state: recombine(staticData, progress),
                selection: readSelection(progress),
            };
        }

        // No progress key: a legacy single-key blob has groups inline.
        if (Array.isArray(staticData.groups) && staticData.groups.length > 0) {
            return {
                status: 'ok',
                state: deserializeState(staticData),
                selection: readSelection(staticData),
            };
        }

        // v11 static blob with no progress = torn write — nothing to restore.
        diagnostics.warn(
            'Discarding saved game: geometry present but no progress (torn write).',
        );
        return { status: 'unreadable', reason: 'torn-write', raw };
    } catch (error) {
        diagnostics.warn('Failed to restore saved game state:', error);
        return { status: 'unreadable', reason: 'parse-error', raw };
    }
}

/**
 * Load just the saved GameState, discarding any persisted selection.
 *
 * Thin wrapper over {@link loadSavedGame} for the existence check and any
 * caller that does not need the selection. The load is read-only; an
 * unreadable save reads as "no state" here and its recovery blobs are
 * discarded — only the startup path surfaces them for download.
 */
export function loadState(): GameState | undefined {
    const outcome = loadSavedGame();
    return outcome.status === 'ok' ? outcome.state : undefined;
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
