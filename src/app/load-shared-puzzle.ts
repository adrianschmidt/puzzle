/**
 * Load a puzzle from a decoded share-link payload — or, via the
 * `__reproPuzzle` console hook, from a reconstructed one. Preload the
 * traced-tab chunk if the payload needs it, resolve the image (the
 * payload's URL, or a locally-regenerated blank canvas for the `'blank'`
 * sentinel), generate the puzzle, apply the link's attribution and
 * progress, and install it.
 *
 * Most of the work is delegated to extracted modules; what is left here is
 * orchestration order:
 *
 *  1. {@link needsTracedTabChunk} decides, before anything else runs,
 *     whether this payload needs the lazy traced-tab chunk — a plain
 *     Classic link never pays the fetch.
 *  2. `yieldForPaint()` runs before generation (off-thread when possible;
 *     the yield still covers the sync fallback), so the loading overlay
 *     paints before it.
 *  3. Progress that fails to apply toasts rather than failing the load: the
 *     puzzle still installs, just without the merges.
 *  4. `hideLoadingOverlay()` runs in a `finally`, so it fires even when
 *     generation throws or is cancelled.
 *
 * None of this may add, remove, or reorder a call reaching `createNewGameAsync`:
 * a share link (and an `__reproPuzzle` reproduction of one) replays a
 * puzzle by re-running this seeded PRNG sequence from the seed alone.
 *
 * Cancellation: the only async step ahead of generation here is the traced-
 * tab chunk preload, and it carries no download report to guard the way
 * `startNewGame`'s Unsplash fetch does — so there is no separate abort
 * checkpoint to add. A cancelled load unwinds entirely from inside
 * `createNewGameAsync`'s own signal handling, straight to the `catch` below.
 */

import type { GameState } from '../model/types.js';
import type { SharePayload } from '../sharing/index.js';
import { showLoadingOverlay, hideLoadingOverlay, yieldForPaint, showToast } from '../ui/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { createNewGameAsync, GenerationCancelledError } from '../game/index.js';
import { applyProgress } from '../game/reconstruct-groups.js';
import { track } from '../analytics/index.js';
import type { NewGameData } from '../analytics/index.js';
import { needsTracedTabChunk, shareInitOptions } from './share-payload-to-init.js';
import { buildSharedGameData } from './new-game-payload.js';
import { buildPieceCountMismatchData } from './piece-count-mismatch-payload.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { diagnostics } from '../diagnostics.js';
import { createBlankImageDataUrl } from './blank-canvas.js';
import type { BackgroundColorControl } from './install-background-color.js';
import type { GameSession } from './game-session.js';

/**
 * Collaborators {@link loadSharedPuzzle} cannot own itself: the DOM
 * container it sizes the puzzle against, the session that installs the
 * generated state, the background-color control the sharer's color is
 * offered through, and two callbacks for the composition-root-owned parts
 * of loading a shared puzzle (view-fitting/persistence, and analytics
 * bookkeeping).
 */
export interface LoadSharedPuzzleDeps {
    container: HTMLElement;
    /**
     * Install-only slice of the {@link GameSession}: this flow regenerates
     * the shared puzzle and installs it, and never reads back what was
     * there before.
     */
    session: Pick<GameSession, 'install'>;
    /** Gather and zoom-to-fit the freshly installed puzzle. */
    fitView: (state: GameState) => void;
    persistNewPuzzle: (state: GameState) => void;
    /**
     * Offers the sharer's background color to a recipient who has never
     * picked one. Routed through the control's `adopt()` rather than the
     * picker directly, so the closed-over current-color id and the
     * picker's selection cannot diverge.
     */
    backgroundColor: BackgroundColorControl;
    /** Record the payload as the current game's analytics. */
    onGameAnalytics: (data: NewGameData) => void;
    /**
     * Whether a puzzle is currently installed. Gates the overlay's Cancel
     * affordance: cancelling means "return to your current puzzle", so for
     * a share-link load, "nothing to return to" is a first visit with no
     * installed game.
     */
    hasCurrentGame: () => boolean;
}

/**
 * Load a puzzle from a decoded share-link payload.
 *
 * @param payload - The decoded share-link payload.
 * @param recipientHadSavedState - Whether the recipient had a readable save
 * before this load; carried into the `recipientHadSavedState` analytics
 * field untouched.
 * @param deps - Collaborators; see {@link LoadSharedPuzzleDeps}.
 * @param source - `'shared'` for a real `#p=` link, `'repro'` for a
 * `__reproPuzzle` replay. Only affects the `source` field of the
 * `piece-count-mismatch` and `generation-cancelled` events — it separates
 * real field incidents, and real recipient abandonment, from a developer
 * replaying a known-bad puzzle while investigating one (#512). Defaults to
 * `'shared'`; the composition root passes `'repro'` explicitly on the one
 * binding it hands to `__reproPuzzle`.
 *
 * As with `startNewGame`'s `source`, the default is the real-recipient path:
 * a new binding that omits the argument reports as field traffic and nothing
 * goes red, so a binding that is not a real recipient must pass `'repro'`.
 */
export async function loadSharedPuzzle(
    payload: SharePayload,
    recipientHadSavedState: boolean,
    deps: LoadSharedPuzzleDeps,
    source: 'shared' | 'repro' = 'shared',
): Promise<void> {
    const startedAt = performance.now();
    const controller = new AbortController();
    showLoadingOverlay(
        undefined,
        deps.hasCurrentGame() ? { onCancel: () => controller.abort() } : {},
    );
    try {
        // A share link with `cf.tg: "traced"` needs the lazy chunk before
        // generation runs. The await is short on warm caches and fits
        // inside the loading overlay the user already sees.
        if (needsTracedTabChunk(payload)) {
            await preloadTracedTabGenerator();
        }

        const imageSize = { width: payload.is[0], height: payload.is[1] };

        // If the sentinel is the blank canvas, regenerate it locally.
        let imageUrl = payload.i;
        if (imageUrl === 'blank') {
            imageUrl = createBlankImageDataUrl(imageSize);
        }

        const viewport = {
            width: deps.container.clientWidth || window.innerWidth,
            height: deps.container.clientHeight || window.innerHeight,
        };

        // Let the overlay paint before generation starts. Off-thread when
        // possible, but the yield still matters for the sync fallback.
        await yieldForPaint();

        // The callback fires synchronously during generation, while the
        // state is still being built — captured here so it can be reported
        // below, once the state exists to report it against.
        let pieceCountMismatch: PieceCountMismatch | undefined;
        const { state, generation } = await createNewGameAsync(
            imageUrl,
            imageSize,
            viewport,
            { cols: payload.g[0], rows: payload.g[1] },
            {
                ...shareInitOptions(payload),
                onPieceCountMismatch: (m) => { pieceCountMismatch = m; },
            },
            controller.signal,
        );

        if (payload.a) {
            state.attribution = {
                photographerName: payload.a.n,
                photographerUrl: payload.a.u,
                photoUrl: payload.a.p,
            };
        }

        if (payload.pr) {
            const ok = applyProgress(state, payload.pr);
            if (!ok) {
                showToast("Couldn't load progress — starting from scratch");
            }
        }

        deps.session.install(state);
        deps.fitView(state);
        deps.persistNewPuzzle(state);

        // Offer the sharer's background color to a recipient who has never
        // picked one. 'none' means the link carried no color at all; a
        // present-but-unrecognized id reports as 'invalid' so palette drift
        // that silently drops a live link's color stays visible in analytics.
        let sharedColor: NonNullable<NewGameData['sharedColor']> = 'none';
        if (payload.bgc !== undefined) {
            sharedColor = deps.backgroundColor.adopt(payload.bgc);
        }

        const data = buildSharedGameData({
            state,
            includesProgress: payload.pr !== undefined,
            recipientHadSavedState,
            sharedColor,
            generation,
        });
        deps.onGameAnalytics(data);
        track('new-game-started', data);

        // Reported after the normal event, so it still lands first if
        // anything below throws. A diagnostic, not an error — this must
        // never block a game load.
        if (pieceCountMismatch) {
            const mismatchData =
                buildPieceCountMismatchData(state, pieceCountMismatch, source);
            track('piece-count-mismatch', mismatchData);
            // Console copy for the local loop; see the matching note in
            // `start-new-game.ts`, including why no deployed build — the
            // `/puzzle/dev/` preview included — can print it.
            diagnostics.warn('[piece-count] repro params', mismatchData);
        }
    } catch (err) {
        if (err instanceof GenerationCancelledError) {
            track('generation-cancelled', {
                // The real source, not a hardcoded 'shared': `__reproPuzzle`
                // is installed in production builds too, and a developer
                // cancelling a replay must not read as a recipient
                // abandoning a real link (#512).
                source,
                cutStyle: payload.c,
                // Already post-transpose — the link stores the oriented
                // grid — so this matches `new-game-started`'s cols/rows
                // without conversion, as the fresh path's does after
                // orienting.
                cols: payload.g[0],
                rows: payload.g[1],
                elapsedMs: Math.round(performance.now() - startedAt),
            });
            return;
        }
        throw err;
    } finally {
        hideLoadingOverlay();
    }
}
