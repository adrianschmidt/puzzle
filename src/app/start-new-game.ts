/**
 * Start a fresh game: decide the cut style, resolve the image (bundled,
 * blank, player-picked, or a fresh Unsplash fetch), generate the puzzle, and
 * install it. Used by the New Game dialog, the boot flow's preferred start
 * and its last-resort fallback, and two dev-console hooks.
 *
 * Most of the work is delegated to extracted modules; what is left here is
 * orchestration, and the orchestration *order* is the contract:
 *
 *  1. {@link planTracedTabs} decides the cut style and whether the lazy
 *     traced-tab chunk is needed before anything else runs. The boot
 *     fallback forces legacy Classic and skips the fetch entirely, so the
 *     recovery path cannot fail the way the start it is recovering from did.
 *  2. The chunk preload starts immediately but is awaited later (see the
 *     comment above `tracedTabsPreload` below), so on paths that did not go
 *     through the dialog the fetch overlaps the image request instead of
 *     running ahead of it.
 *  3. The chunk outcome is collected after the image resolves but *before*
 *     the Unsplash download report (see the comment above `tracedTabs`
 *     below) — a start that is about to throw must not report a "download"
 *     for a photo it discards.
 *  4. `yieldForPaint()` runs before generation (off-thread when possible;
 *     the yield still covers the sync fallback), so the loading overlay
 *     paints before it.
 *  5. `hideLoadingOverlay()` runs in a `finally`, so it fires even when
 *     generation throws or is canceled.
 *
 * None of this may add, remove, or reorder a call reaching `createNewGameAsync`:
 * share links and saves replay a puzzle by re-running this seeded PRNG
 * sequence from the seed alone.
 *
 * Cancellation: an abort check sits right after the chunk-outcome collection
 * from point 3, still ahead of the Unsplash download report — same spot,
 * same reason. A start that is about to unwind, canceled or otherwise,
 * must not report a "download" for a photo it discards.
 */

import type { GameState, GridSize } from '../model/types.js';
import type { CutStyle } from '../game/cut-styles.js';
import { rotationModeForNewGame } from '../game/cut-styles.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';
import type { FractalDialogConfig, WavyDialogConfig } from '../ui/index.js';
import { showLoadingOverlay, hideLoadingOverlay, yieldForPaint } from '../ui/index.js';
import { getImageProxyBaseUrl, triggerPhotoDownload } from '../images/index.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import { createNewGameAsync, GenerationCanceledError } from '../game/index.js';
import { diagnostics } from '../diagnostics.js';
import { track } from '../analytics/index.js';
import type { NewGameData } from '../analytics/index.js';
import { planTracedTabs, resolveTracedTabOutcome } from './traced-tab-plan.js';
import { generatorConfigsForNewGame } from './generator-configs.js';
import { buildFreshGameData } from './new-game-payload.js';
import { buildPieceCountMismatchData } from './piece-count-mismatch-payload.js';
import type { PieceCountMismatch } from '../puzzle/topology/generator.js';
import { pickBundledImage } from './bundled-image.js';
import { resolveUnsplashImage } from './resolve-image.js';
import {
    orientationForViewport,
    orientGridSize,
    blankSizeForOrientation,
} from './orientation.js';
import type { CandidateImage } from './unsplash-display-image.js';
import type { GameSession } from './game-session.js';

/** Per-game choices for {@link startNewGame}. */
export interface StartNewGameOptions {
    /** Cut style for piece generation. Defaults to Classic. */
    cutStyle?: CutStyle;
    composableConfig?: ComposableConfig;
    imageSource?: string;
    imageCategory?: string;
    fractalConfig?: FractalDialogConfig;
    wavyConfig?: WavyDialogConfig;
    vibrant?: boolean;
    rotationEnabled?: boolean;
    seed?: number;
    pickedImage?: CandidateImage;
    /**
     * Start the last-resort boot puzzle (#488): legacy Classic cut, lazy
     * traced-tab chunk never fetched, flagged in analytics. Overrides
     * `cutStyle` — see `planTracedTabs`.
     */
    bootFallback?: boolean;
}

/**
 * Collaborators {@link startNewGame} cannot own itself: the DOM container it
 * sizes the puzzle against, the session that installs the generated state,
 * and four callbacks for the composition-root-owned parts of starting a
 * game (viewport reset, view-fitting, persistence, analytics bookkeeping).
 */
export interface StartNewGameDeps {
    container: HTMLElement;
    /**
     * Install-only slice of the {@link GameSession}: this flow generates a
     * puzzle and installs it, and never reads back what was there before.
     */
    session: Pick<GameSession, 'install'>;
    /**
     * Reset the viewport transform to identity and push it to the renderer.
     * Called once generation has resolved, right before the new state is
     * installed — not any earlier — so the new puzzle never renders under
     * the previous game's zoom, and so a start that cancels or throws before
     * that point leaves the current puzzle's pan/zoom untouched.
     */
    resetViewport: () => void;
    /** Gather and zoom-to-fit the freshly installed puzzle. */
    fitView: (state: GameState) => void;
    persistNewPuzzle: (state: GameState) => void;
    /** Record the payload as the current game's analytics. */
    onGameAnalytics: (data: NewGameData) => void;
    /**
     * Whether a puzzle is currently installed. Gates the overlay's Cancel
     * affordance: canceling means "return to your current puzzle", so
     * with nothing installed (boot, first-visit share link) there is
     * nothing to offer.
     */
    hasCurrentGame: () => boolean;
}

/**
 * Start a new game. Uses the player-picked photo when one is given;
 * otherwise fetches a random Unsplash image if available. Falls back to
 * the default image if the API key is missing or fetch fails.
 *
 * @param gridSize - Grid dimensions (cols × rows) for the puzzle
 * @param options - Per-game choices; see {@link StartNewGameOptions}
 * @param deps - Collaborators; see {@link StartNewGameDeps}
 * @param source - `'fresh'` for a real player start (the new-game dialog or
 * the boot path), `'dev'` for a start kicked off from the dev console (e.g.
 * `__newComposableGame`). Only affects the `source` field of the
 * `piece-count-mismatch` and `generation-canceled` events — it keeps a
 * developer poking at cut parameters out of the field-incident signal, and
 * out of the cancel-rate signal, the same distinction `loadSharedPuzzle`'s
 * `source` already draws for `__reproPuzzle` (#512). Defaults to `'fresh'`; the
 * composition root passes `'dev'` explicitly on the one binding it hands to
 * `installDevHooks`.
 *
 * The default is the PLAYER path, so a new binding that forgets the argument
 * opts itself INTO the field-incident count and nothing goes red
 * (`bootstrap.test.ts` asserts per binding). Kept optional deliberately —
 * making it required would touch every call site to catch a mistake possible
 * only in the composition root — so: a new binding that is not a real player
 * start must pass `'dev'`. The developer traffic this does miss today is
 * separable by query instead; see `PieceCountMismatchData`'s `source` note.
 */
export async function startNewGame(
    gridSize: GridSize,
    options: StartNewGameOptions,
    deps: StartNewGameDeps,
    source: 'fresh' | 'dev' = 'fresh',
): Promise<void> {
    const {
        cutStyle: requestedCutStyle = 'classic',
        composableConfig,
        imageSource,
        imageCategory,
        fractalConfig,
        wavyConfig,
        vibrant = false,
        rotationEnabled = false,
        seed,
        pickedImage,
        bootFallback = false,
    } = options;
    const startedAt = performance.now();
    const controller = new AbortController();
    showLoadingOverlay(
        undefined,
        deps.hasCurrentGame() ? { onCancel: () => controller.abort() } : {},
    );

    const viewport = {
        width: deps.container.clientWidth || window.innerWidth,
        height: deps.container.clientHeight || window.innerHeight,
    };

    // Match the puzzle to the shape of the screen it's created on. This is
    // the only place orientation is decided; the resulting grid and image
    // size flow into the save/share payload, so replay reproduces it
    // without re-reading the viewport.
    //
    // Computed above the `try` rather than inside it so the cancel branch
    // in the `catch` can report the same post-transpose grid
    // `new-game-started` does. Nothing here can throw or consume
    // randomness, so hoisting it changes no behaviour.
    const orientation = orientationForViewport(viewport);
    const oriented = orientGridSize(gridSize, orientation);

    try {
        // Traced tabs live in a lazy chunk. `planTracedTabs` decides
        // whether this start needs it and which cut style is actually
        // generated; the boot fallback forces legacy Classic and skips the
        // fetch entirely, so the recovery path cannot fail the same way the
        // start it is recovering from did.
        const tracedTabPlan = planTracedTabs({
            cutStyle: requestedCutStyle,
            tabGenerator: composableConfig?.tabGenerator,
            bootFallback,
        });
        const { cutStyle, preloadChunk } = tracedTabPlan;

        // The dialog kicked off the preload when the user picked a traced
        // style, so this usually resolves instantly. Started here but
        // awaited further down, so on the paths that didn't go through the
        // dialog (the boot path, the __newComposableGame console hook) the
        // chunk fetch overlaps the image request — where there is one —
        // instead of running ahead of it. The first-run boot puzzle uses a
        // bundled image and so has nothing to overlap with; it just pays the
        // fetch under the overlay.
        //
        // The rejection is captured into a value rather than left floating:
        // an unawaited rejected promise would surface as an unhandled
        // rejection while the image loads. It is interpreted at the await
        // site below. `null` is the success sentinel there, so a rejection
        // reason that is itself falsy (`reject()`, `reject(null)`) has to be
        // defaulted to a real Error — otherwise it would read as success.
        const tracedTabsPreload = preloadChunk
            ? preloadTracedTabGenerator().then(
                () => null,
                (error: unknown) => error ?? new Error('Traced tab chunk failed to load'),
            )
            : null;

        const bundled = pickBundledImage(orientation);
        let imageUrl: string | null = bundled.url;
        let imageSize = bundled.size;
        let attribution: GameState['attribution'] = bundled.attribution;

        // Blank puzzle: no photo. Match the puzzle orientation so a portrait
        // screen gets a portrait blank.
        if (imageSource === 'blank') {
            imageUrl = null;
            imageSize = blankSizeForOrientation(orientation);
            attribution = undefined;
        }

        // Unsplash access is needed for the random fetch and for the
        // download trigger on a picked photo — but not for blank or the
        // deterministic first-run puzzle (bundled defaults set above).
        const proxyBaseUrl =
            imageSource !== 'blank' && imageSource !== 'first-run'
                ? getImageProxyBaseUrl()
                : null;

        let downloadLocation: string | undefined;

        if (imageSource !== 'blank' && pickedImage) {
            // The player picked a concrete candidate in the dialog — use it
            // directly, no second API call.
            imageUrl = pickedImage.imageUrl;
            imageSize = pickedImage.imageSize;
            attribution = pickedImage.attribution;
            downloadLocation = pickedImage.downloadLocation;
        } else if (proxyBaseUrl) {
            const resolved = await resolveUnsplashImage(proxyBaseUrl, imageCategory ?? 'any', vibrant, orientation);
            if (resolved) {
                imageUrl = resolved.imageUrl;
                imageSize = resolved.imageSize;
                attribution = resolved.attribution;
                downloadLocation = resolved.downloadLocation;
            }
        }

        // The traced-tab chunk fetch started before the image request;
        // collect its outcome now that the image has resolved. Before the
        // download report below, not after: a start that is about to throw
        // must not report an Unsplash "download" for a photo it discards.
        const tracedTabs = resolveTracedTabOutcome({
            plan: tracedTabPlan,
            chunkError: tracedTabsPreload ? await tracedTabsPreload : null,
        });
        if (tracedTabs.kind === 'fail') throw tracedTabs.error;
        // Read twice — warned on here, and handed to `buildFreshGameData`
        // below, which turns it into the event's `tracedChunkDegraded` flag
        // (`new-game-payload.ts`) — so it gets one spelling. Aliasing the
        // discriminant check keeps `tracedTabs.error` narrowed at the first use.
        const chunkDegraded = tracedTabs.kind === 'legacy-classic' && tracedTabs.degraded;
        if (chunkDegraded) {
            // Degrading is quiet for the player by design, but not for us:
            // warn, so a dev console says why Classic silently changed
            // shape, and flag the analytics event so these games stay
            // separable from genuine pre-upgrade Classic traffic.
            diagnostics.warn(
                'Traced tab chunk failed to load; Classic fell back to the legacy cut:',
                tracedTabs.error,
            );
        }

        // A canceled start must not report an Unsplash "download" for a
        // photo it discards — same principle, and the same reason, as the
        // `tracedTabs.kind === 'fail'` throw above.
        if (controller.signal.aborted) throw new GenerationCanceledError();

        // Unsplash guidelines: report a "download" when a photo is actually
        // used. Fire-and-forget — a failure must never block the game.
        if (proxyBaseUrl && downloadLocation) {
            triggerPhotoDownload(downloadLocation, proxyBaseUrl).catch(() => {});
        }

        const rotationMode = rotationModeForNewGame(cutStyle, rotationEnabled);

        const generatorConfigs = generatorConfigsForNewGame({
            cutStyle,
            fractalConfig,
            wavyConfig,
            tracedTabsOk: tracedTabs.kind === 'ok',
        });

        // Let the overlay paint before generation starts. Off-thread when
        // possible, but the yield still matters for the sync fallback.
        await yieldForPaint();

        // The callback fires synchronously during generation, while the
        // state is still being built — captured here so it can be reported
        // below, once the state exists to report it against.
        let pieceCountMismatch: PieceCountMismatch | undefined;
        const { state, generation } = await createNewGameAsync(
            imageUrl, imageSize, viewport, oriented,
            {
                cutStyle,
                composableConfig,
                ...generatorConfigs,
                rotationMode,
                seed,
                onPieceCountMismatch: (m) => { pieceCountMismatch = m; },
            },
            controller.signal,
        );

        if (attribution) {
            state.attribution = attribution;
        }

        // Reset the viewport transform to identity now that generation has
        // actually produced a puzzle to show, and before installing it, so
        // the new puzzle never renders under the previous game's zoom. Not
        // any earlier: every cancellation checkpoint above this line must be
        // able to unwind without ever touching the transform, or canceling
        // would blow away the current puzzle's pan/zoom for nothing.
        deps.resetViewport();
        deps.session.install(state);
        deps.fitView(state);
        deps.persistNewPuzzle(state);

        const data = buildFreshGameData({
            state,
            cutStyle,
            rotationMode,
            orientation,
            oriented,
            imageSource,
            imageCategory,
            vibrant,
            pickedImage,
            chunkDegraded,
            bootFallback,
            generation,
        });
        deps.onGameAnalytics(data);
        track('new-game-started', data);

        // Reported after the normal event, so it still lands first if
        // anything below throws. A diagnostic, not an error — this must
        // never block a game start.
        if (pieceCountMismatch) {
            const mismatchData =
                buildPieceCountMismatchData(state, pieceCountMismatch, source);
            track('piece-count-mismatch', mismatchData);
            // Also to the console. The generator's own `[piece-count]` warn
            // cannot carry repro params: `generateTopologyPuzzle` is handed a
            // `random: () => number` rather than the seed behind it, and
            // neither the rotation mode nor the cut style reaches that far
            // down — so on a local `npm run dev`, where `track` is a no-op
            // without a website ID, this is the only place a replayable set
            // exists at all. Same object the event ships, so it pastes into
            // `__reproPuzzle` the way an Umami row does.
            //
            // Local loop only, and more strictly than "unless enabled at
            // runtime" suggests: `diagnostics` is on under `import.meta.env.DEV`
            // (dev server and Vitest), and `enableDiagnostics()` is a module
            // export bound to no `window` property or dev hook — so on ANY
            // deployed build, `/puzzle/dev/` included, nothing can turn it on
            // and this line never prints. There the Umami event is the whole
            // signal, which is why it carries the full repro params rather
            // than leaning on the console copy.
            diagnostics.warn('[piece-count] repro params', mismatchData);
        }
    } catch (err) {
        if (err instanceof GenerationCanceledError) {
            track('generation-canceled', {
                // The real source, not a hardcoded 'fresh': `installDevHooks`
                // runs in production builds and dev-deploy shares
                // production's Umami website ID, so a developer canceling a
                // `__newComposableGame` start would otherwise read as a
                // player losing patience — the exact conflation #512
                // established this split to prevent.
                source,
                cutStyle: requestedCutStyle,
                orientation,
                // Post-transpose, like `new-game-started`'s cols/rows: the
                // requested grid is always landscape-normalized, so
                // reporting it raw would file every portrait cancel under a
                // grid no completed start ever reports.
                cols: oriented.cols,
                rows: oriented.rows,
                elapsedMs: Math.round(performance.now() - startedAt),
            });
            return;
        }
        throw err;
    } finally {
        hideLoadingOverlay();
    }
}
