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
 *  2. `yieldForPaint()` runs before `createNewGame`, so the loading overlay
 *     paints before the synchronous piece-generation burst.
 *  3. Progress that fails to apply toasts rather than failing the load: the
 *     puzzle still installs, just without the merges.
 *  4. `hideLoadingOverlay()` runs in a `finally`, so it fires even when
 *     generation throws.
 *
 * None of this may add, remove, or reorder a call reaching `createNewGame`:
 * a share link (and an `__reproPuzzle` reproduction of one) replays a
 * puzzle by re-running this seeded PRNG sequence from the seed alone.
 */

import type { GameState } from '../model/types.js';
import type { SharePayload } from '../sharing/index.js';
import { showLoadingOverlay, hideLoadingOverlay, yieldForPaint, showToast } from '../ui/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { createNewGame } from '../game/index.js';
import { applyProgress } from '../game/reconstruct-groups.js';
import { track } from '../analytics/index.js';
import type { NewGameData } from '../analytics/index.js';
import { needsTracedTabChunk, shareInitOptions } from './share-payload-to-init.js';
import { buildSharedGameData } from './new-game-payload.js';
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
    session: GameSession;
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
}

/**
 * Load a puzzle from a decoded share-link payload.
 *
 * @param payload - The decoded share-link payload.
 * @param recipientHadSavedState - Whether the recipient had a readable save
 * before this load; carried into the `recipientHadSavedState` analytics
 * field untouched.
 * @param deps - Collaborators; see {@link LoadSharedPuzzleDeps}.
 */
export async function loadSharedPuzzle(
    payload: SharePayload,
    recipientHadSavedState: boolean,
    deps: LoadSharedPuzzleDeps,
): Promise<void> {
    showLoadingOverlay();
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

        // Let the overlay paint before the synchronous piece-generation burst.
        await yieldForPaint();

        const state = createNewGame(
            imageUrl,
            imageSize,
            viewport,
            { cols: payload.g[0], rows: payload.g[1] },
            shareInitOptions(payload),
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
        });
        deps.onGameAnalytics(data);
        track('new-game-started', data);
    } finally {
        hideLoadingOverlay();
    }
}
