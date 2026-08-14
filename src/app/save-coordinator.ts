/**
 * A save failure surfaces two ways: telemetry (always, so a regression is
 * observable) and a rate-limited toast (so a fast debounced loop can't spam
 * the player).
 */

import type { GameState } from '../model/types.js';
import { createDebouncedSave, saveNewPuzzle } from '../persistence/index.js';
import { showToast } from '../ui/index.js';
import { track } from '../analytics/index.js';
import { traceSetVersionOf } from './trace-set-version.js';
import { diagnostics } from '../diagnostics.js';
import type { SelectionManager } from '../interaction/selection-manager.js';
import type { ViewportTransform } from '../interaction/index.js';

/** Shown when a save could not be persisted (quota exceeded even after compression). */
export const SAVE_FAILED_TOAST =
    "This puzzle is too large to save — your progress won't be kept across reloads.";
export const SAVE_FAILED_TOAST_DEDUP_MS = 10_000;

export interface SaveCoordinator {
    autoSave(state: GameState): void;
    persistNewPuzzle(state: GameState): void;
    flush(): void;
}

/**
 * Installs the `pagehide`/`visibilitychange` flush listeners as a construction
 * side effect, so a change within the debounce window survives a reload,
 * navigation, close, or mobile app-switch / background-kill.
 */
export function createSaveCoordinator(deps: {
    selectionManager: SelectionManager;
    viewportTransform: ViewportTransform;
    /** Injected for testing. */
    now?: () => number;
}): SaveCoordinator {
    const { selectionManager, viewportTransform, now = Date.now } = deps;

    // A suppressed repeat still leaves a diagnostic trail rather than vanishing.
    let lastSaveFailedToastAt = -Infinity;
    // `state` is the puzzle whose save failed — not always the current
    // `gameState`: a debounced progress save can flush after a new game starts.
    function notifySaveFailed(op: 'progress' | 'new-puzzle', state: GameState): void {
        track('save-failed', {
            op,
            cutStyle: state.cutStyle ?? 'classic',
            pieceCount: state.pieces.length,
            traceSetVersion: traceSetVersionOf(state),
        });
        const at = now();
        if (at - lastSaveFailedToastAt < SAVE_FAILED_TOAST_DEDUP_MS) {
            diagnostics.warn(`Save failed (${op}) within the toast-dedup window; toast suppressed.`);
            return;
        }
        lastSaveFailedToastAt = at;
        showToast(SAVE_FAILED_TOAST);
    }

    // Both callbacks attribute to the flushed state, not the next `autoSave`
    // state: a save queued for the previous puzzle can flush after a new game
    // starts, which would otherwise report the new puzzle's fields for the old
    // failure.
    const debouncedSave = createDebouncedSave({
        onSaveFailed: (state) => notifySaveFailed('progress', state),
        // The save slot is recorded as another puzzle's, so this autosave was
        // refused rather than allowed to tear the pair. A cross-tab takeover on
        // the same origin is the race this targets, but a quota-failed geometry
        // write and a late-flushing outgoing save land here too (see
        // `ProgressSaveSkippedData`). Not user-facing, but worth measuring.
        onSaveSkipped: (state) =>
            track('progress-save-skipped', {
                cutStyle: state.cutStyle ?? 'classic',
                pieceCount: state.pieces.length,
                traceSetVersion: traceSetVersionOf(state),
            }),
    });

    // `pagehide` covers reloads, navigations and closes; `visibilitychange` →
    // hidden additionally covers mobile app-switch / background-kill, where
    // `pagehide` is not guaranteed to fire. `flush()` is a no-op when nothing
    // is pending, so firing on both is safe.
    window.addEventListener('pagehide', () => debouncedSave.flush());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') debouncedSave.flush();
    });

    return {
        autoSave(state: GameState): void {
            debouncedSave.save(state, selectionManager.selectedGroupIds, viewportTransform.getState());
        },

        /**
         * `save-compressed` covers the whole save, not the geometry write
         * alone: `saveNewPuzzle` reports the worse of the two writes. See
         * `SaveCompressedData` in `analytics/umami.ts`.
         */
        persistNewPuzzle(state: GameState): void {
            const result = saveNewPuzzle(
                state,
                selectionManager.selectedGroupIds,
                viewportTransform.getState(),
            );
            if (result === 'failed') {
                // Synchronous with the write, so the current state is the saved state.
                notifySaveFailed('new-puzzle', state);
            } else if (result === 'ok-compressed') {
                track('save-compressed', {
                    cutStyle: state.cutStyle ?? 'classic',
                    pieceCount: state.pieces.length,
                    traceSetVersion: traceSetVersionOf(state),
                });
            }
        },

        flush(): void {
            debouncedSave.flush();
        },
    };
}
