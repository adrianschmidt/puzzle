/**
 * Surfacing a save failure has two independent halves: telemetry (always,
 * so a regression is observable) and a user-facing toast (rate-limited, so
 * a fast debounced save loop can't spam the player). See
 * {@link createSaveCoordinator}'s `notifySaveFailed` for why both matter.
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
 * Installs the `pagehide` and `visibilitychange` flush listeners as a side
 * effect of construction, so a change made within the debounce window is
 * not lost on a fast reload, navigation, tab close, or mobile app-switch /
 * background-kill.
 */
export function createSaveCoordinator(deps: {
    selectionManager: SelectionManager;
    viewportTransform: ViewportTransform;
    /** Injected for testing; defaults to Date.now. */
    now?: () => number;
}): SaveCoordinator {
    const { selectionManager, viewportTransform, now = Date.now } = deps;

    // Surface a save failure (quota exceeded even after compression). Every
    // failure emits telemetry so the regression is observable; the
    // user-facing toast is rate-limited so a fast debounced save loop can't
    // spam it — and a suppressed repeat still leaves a diagnostic trail
    // rather than vanishing silently.
    let lastSaveFailedToastAt = -Infinity;
    // `state` is the puzzle whose save failed, which is not always the
    // current `gameState`: a debounced progress save can flush after a new
    // game has started.
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

    // Both callbacks attribute to the flushed state, not to whatever state
    // the caller passes to `autoSave` next: a save queued for the previous
    // puzzle can flush inside the debounce window after a new game starts,
    // which would otherwise report the new puzzle's cut style and piece
    // count for the old puzzle's failure.
    const debouncedSave = createDebouncedSave({
        onSaveFailed: (state) => notifySaveFailed('progress', state),
        // The save slot is recorded as another puzzle's, so this autosave was
        // refused rather than allowed to tear the pair. A cross-tab takeover
        // (another tab started a new puzzle on the same origin) is the race
        // this was built for, but it is not the only cause — a geometry write
        // that failed on quota, and a save queued for the outgoing puzzle that
        // flushed after a new game replaced it, land here too. See
        // `ProgressSaveSkippedData` in `analytics/umami.ts` for the full set
        // and how to tell them apart. Not a failure to warn the user about,
        // but worth measuring.
        onSaveSkipped: (state) =>
            track('progress-save-skipped', {
                cutStyle: state.cutStyle ?? 'classic',
                pieceCount: state.pieces.length,
                traceSetVersion: traceSetVersionOf(state),
            }),
    });

    // Persist any pending debounced save before the page goes away, so a
    // change made within the 500ms debounce window (e.g. a just-tapped
    // selection) is not lost on a fast reload or tab close. `pagehide`
    // covers reloads, navigations and closes; `visibilitychange` → hidden
    // additionally covers mobile app-switch / background-kill, where
    // `pagehide` is not guaranteed to fire. `flush()` is a no-op when
    // nothing is pending, so firing on both is safe.
    window.addEventListener('pagehide', () => debouncedSave.flush());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') debouncedSave.flush();
    });

    return {
        autoSave(state: GameState): void {
            debouncedSave.save(state, selectionManager.selectedGroupIds, viewportTransform.getState());
        },

        /**
         * The `save-compressed` signal covers the whole save, not the
         * geometry write alone: `saveNewPuzzle` reports the worse of the two
         * writes, so a compressed initial *progress* write emits the same
         * event. See `SaveCompressedData` in `analytics/umami.ts`.
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
