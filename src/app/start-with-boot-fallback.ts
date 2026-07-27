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
 * What this does not cover: the fallback keeps the failed attempt's grid
 * size and image-source preferences, so a failure rooted in those inputs
 * — an oversized saved grid, a throw decoding the resolved image — repeats
 * identically against `startFallback` and ends at `BOOT_FAILED_TOAST`.
 * Still strictly better than the pre-#488 dead app, but this is a
 * different-generator fallback, not a retry-with-different-inputs one.
 *
 * Extracted from `main.ts` so the outcomes are unit-testable.
 */

import { runWithErrorReport } from './run-with-error-report.js';
import { BOOT_FALLBACK_CUT_STYLE } from './traced-tab-plan.js';
import { showToast } from '../ui/toast.js';

/** Shown once the last-resort puzzle is actually on screen. */
export const FALLBACK_STARTED_TOAST = "Couldn't start your usual puzzle — started a Classic one";

/** Shown when even the last-resort puzzle failed and the app is stuck. */
export const BOOT_FAILED_TOAST = "Couldn't start a puzzle — try reloading";

export async function startWithBootFallback(opts: {
    /** Start the puzzle the player's preferences ask for. */
    start: () => Promise<void>;
    /**
     * Cut style `start` is attempting, for failure attribution. The
     * fallback's own failure reports {@link BOOT_FALLBACK_CUT_STYLE}
     * instead — it never generates the requested style.
     */
    cutStyle: string;
    /** Start the last-resort puzzle: legacy Classic, no lazy chunk. */
    startFallback: () => Promise<void>;
    /**
     * Whether a puzzle actually made it onto the screen — rendered and
     * interactive, not merely "the app assigned some state somewhere".
     * The caller owns that distinction, and an over-optimistic answer is
     * expensive: it skips both the substitution and every message, which
     * is the dead-and-silent app #488 is about.
     */
    hasGame: () => boolean;
}): Promise<void> {
    const started = await runWithErrorReport({
        run: async () => {
            await opts.start();
            return true;
        },
        warnMessage: 'Failed to start the boot puzzle:',
        // Before this branch a boot rejection had no catch at all, so it
        // reached the browser as an unhandled rejection and printed in
        // production. Catching it here must not silently regress that
        // console visibility, so this flow opts in where the user-facing
        // dialog and share-link flows (already caught pre-#488) stay silent.
        logInProduction: true,
        event: 'new-game-failed',
        cutStyle: opts.cutStyle,
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
        // Same reasoning as the preferred start above: this is the last
        // catch before the app is stuck, so it must stay visible in a
        // production console.
        logInProduction: true,
        event: 'new-game-failed',
        cutStyle: BOOT_FALLBACK_CUT_STYLE,
        phase: 'boot-fallback',
        // No toast here either, for the same reason as above: this
        // function owns every message it shows, so all three live in the
        // one block below and the policy has a single place to read.
        fallback: false,
    });

    // Deliberately after the fallback settles: the player reads "started a
    // Classic one" only once that is true. `hasGame()` was false above, so
    // anything on screen now came from the fallback — it can reject after
    // its own puzzle rendered, and "try reloading" over a working puzzle
    // would be both wrong and destructive.
    if (recovered || opts.hasGame()) {
        showToast(FALLBACK_STARTED_TOAST);
        return;
    }
    showToast(BOOT_FAILED_TOAST);
}
