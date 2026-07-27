/**
 * Boot-path safety net for starting a new game.
 *
 * The boot flow has no user standing in front of it: if its
 * `startNewGame` rejects there is no previous puzzle to fall back to and
 * no dialog to retry from, so the app is left with an unassigned
 * `gameState`, an empty canvas, and a New Game button that throws on
 * click (#488). This runs the preferred start, reports a failure, and
 * then starts a last-resort puzzle that cannot depend on the lazy chunk.
 *
 * Extracted from `main.ts` so the outcomes are unit-testable.
 */

import { runWithErrorReport } from './run-with-error-report.js';
import { showToast } from '../ui/toast.js';

/** Shown once the last-resort puzzle is actually on screen. */
export const FALLBACK_STARTED_TOAST = "Couldn't start your usual puzzle — started a Classic one";

/** Shown when even the last-resort puzzle failed and the app is stuck. */
export const BOOT_FAILED_TOAST = "Couldn't start a puzzle — try reloading";

export async function startWithBootFallback(opts: {
    /** Start the puzzle the player's preferences ask for. */
    start: () => Promise<void>;
    /** Start the last-resort puzzle: legacy Classic, no lazy chunk. */
    startFallback: () => Promise<void>;
    /** Whether a puzzle made it onto the screen. */
    hasGame: () => boolean;
}): Promise<void> {
    const started = await runWithErrorReport({
        run: async () => {
            await opts.start();
            return true;
        },
        warnMessage: 'Failed to start the boot puzzle:',
        event: 'new-game-failed',
        phase: 'boot',
        // No toast: the message the player gets depends on whether the
        // recovery below works, and only one toast renders at a time.
        fallback: false,
    });
    if (started) return;

    // A rejection *after* `initGame` — say a throw while fitting the
    // view — leaves the player with the puzzle they asked for. Replacing
    // it with a Classic one would be the regression, not the fix. The
    // failure is still reported above.
    if (opts.hasGame()) return;

    const recovered = await runWithErrorReport({
        run: async () => {
            await opts.startFallback();
            return true;
        },
        warnMessage: 'Boot fallback puzzle also failed to start:',
        event: 'new-game-failed',
        phase: 'boot-fallback',
        toastMessage: BOOT_FAILED_TOAST,
        fallback: false,
    });
    // Deliberately after the fallback settles: the player reads
    // "started a Classic one" only once that is true.
    if (recovered) showToast(FALLBACK_STARTED_TOAST);
}
