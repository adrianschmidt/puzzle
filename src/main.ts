import './palette.css';
import './style.css';
import { diagnostics } from './diagnostics.js';
import type { GameState, GridSize } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { ViewportTransform, RotationFocus } from './interaction/index.js';
import {
    createNewGame,
    processDrop,
    getGroupLocalBounds,
    getGroupVisualBounds,
} from './game/index.js';
import { loadState, loadSavedGame, clearSavedState } from './persistence/index.js';
import {
    createNewGameButton,
    createGatherPiecesButton,
    loadColorPreference,
    saveColorPreference,
    applyBackgroundColor,
    adoptSharedBackgroundColor,
    onColorSchemeChange,
    installPieceOutlineFilter,
    loadPieceOutlinePreference,
    applyPieceOutline,
    loadPieceOutlineColorPreference,
    applyPieceOutlineColor,
    createBackgroundColorPicker,
    createInfoButton,
    createInfoModal,
    createSelectToolButton,
    createMarqueeToolButton,
    createDeselectButton,
    createRotateButtons,
    createRotateHandle,
    createAttributionElement,
    removeAttribution,
    createNewGameDialog,
    createCorruptSaveDialog,
    showToast,
    showLoadingOverlay,
    hideLoadingOverlay,
    yieldForPaint,
    loadRotationEnabledPreference,
    saveRotationEnabledPreference,
    type FractalDialogConfig,
    type WavyDialogConfig,
} from './ui/index.js';
import { SelectionManager } from './interaction/selection-manager.js';
import { SnapProximityPositionController } from './interaction/snap-proximity-position-controller.js';
import { rotateGroup } from './game/rotate-group.js';
import {
    buildGroupIndexes,
    localToWorld,
} from './model/helpers.js';
import { getUnsplashAccessKey, triggerPhotoDownload } from './images/index.js';
import {
    loadSizePreference,
    saveSizePreference,
    getSizeOption,
    toGridSize,
} from './game/puzzle-sizes.js';
import {
    loadCutStylePreference,
    saveCutStylePreference,
    rotationModeForNewGame,
} from './game/cut-styles.js';
import type { CutStyle } from './game/cut-styles.js';
import {
    loadComposableConfigPreference,
    saveComposableConfigPreference,
    composableSliderToGeneratorConfig,
} from './game/composable-config.js';
import {
    loadFractalConfigPreference,
    saveFractalConfigPreference,
} from './game/fractal-config.js';
import {
    loadWavyConfigPreference,
    saveWavyConfigPreference,
} from './game/wavy-config.js';
import {
    loadImageSourcePreference,
    saveImageSourcePreference,
    imageSourcePreferenceExists,
} from './game/image-source.js';
import {
    loadImageCategoryPreference,
    saveImageCategoryPreference,
    loadVibrantPreference,
    saveVibrantPreference,
    imageCategoryPreferenceExists,
} from './game/image-categories.js';
import {
    parseLocationHash,
    type SharePayload,
    encodePayload,
    decodePayload,
    reproParamsToPayload,
    type ReproParams,
} from './sharing/index.js';
import { applyProgress } from './game/reconstruct-groups.js';
import { preloadTracedTabGenerator } from './puzzle/topology/traced-tab-loader.js';
import { getBaseCutGenerator } from './puzzle/topology/generator-registry.js';
import { initAnalytics, initErrorTracking, track } from './analytics/index.js';
import type { NewGameData } from './analytics/index.js';
import { runWithErrorReport } from './app/run-with-error-report.js';
import { startWithBootFallback } from './app/start-with-boot-fallback.js';
import { generatorConfigsForNewGame } from './app/generator-configs.js';
import { planTracedTabs, resolveTracedTabOutcome } from './app/traced-tab-plan.js';
import { needsTracedTabChunk, shareInitOptions } from './app/share-payload-to-init.js';
import { resolveUnsplashImage } from './app/resolve-image.js';
import { buildFreshGameData, buildSharedGameData } from './app/new-game-payload.js';
import { pickBundledImage } from './app/bundled-image.js';
import { fetchCandidateImages } from './app/fetch-candidate-images.js';
import type { CandidateImage } from './app/unsplash-display-image.js';
import {
    orientationForViewport,
    orientGridSize,
    blankSizeForOrientation,
} from './app/orientation.js';
import { activeSnapTolerances } from './app/snap-tolerances.js';
import { createBlankImageDataUrl } from './app/blank-canvas.js';
import { createCompletionPresenter } from './app/completion-presenter.js';
import { gatherAndZoomToFit, zoomToFitCompletedPuzzle, type ViewportFitDeps } from './app/viewport-fit.js';
import { createSaveCoordinator } from './app/save-coordinator.js';
import { applyMergeResult } from './app/merge-result.js';
import { createGameSession } from './app/game-session.js';
import { initPwaUpdates } from './pwa/register.js';
import {
    wasRescueAttempted,
    recordRescueAttempt,
    clearRescueAttempt,
} from './pwa/share-link-rescue.js';
import { initSwErrorReporting } from './pwa/sw-error-bridge.js';

const app = document.querySelector<HTMLDivElement>('#app')!;

// Suppress the browser context menu on the puzzle table only.
// On touch devices (especially iPad), long-pressing a piece would
// otherwise trigger the context menu, interfering with drag. We
// can't target the table directly here because it's created later
// by renderer.init; delegate from #app and check the event target
// so context menus inside the info modal / debug panels still
// reach the browser (otherwise the user can't copy share links
// or reproduction parameters via long-press).
app.addEventListener('contextmenu', (e) => {
    const target = e.target as Element | null;
    if (target?.closest('[data-puzzle-table]')) {
        e.preventDefault();
    }
});

initAnalytics();

// Global backstop: report unhandled rejections / uncaught errors that
// no local try/catch handled. Observe-only; never swallows them.
initErrorTracking();

// Companion backstop for the service worker's own scope (#430): the
// `window` listeners above run in the page realm and never see exceptions
// thrown inside the worker, so the worker posts those here for reporting.
initSwErrorReporting();

// Resource Timing entries back the traced-chunk `cacheState` dimension
// (see detectCacheState in traced-tab-loader.ts). The 250-entry default
// buffer can evict the chunk's entry on long-lived PWA sessions, which
// would degrade the signal to `unknown`; a larger buffer keeps it
// reliable at negligible memory cost.
performance.setResourceTimingBufferSize?.(500);

// Display app version in bottom-right corner.
// Injected at build time by the deploy workflow via VITE_APP_VERSION.
const appVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
if (appVersion) {
    const versionEl = document.createElement('div');
    versionEl.className = 'app-version';
    versionEl.textContent = appVersion;
    app.appendChild(versionEl);
}

/**
 * Analytics metadata for the currently-playing puzzle.
 *
 * Populated when a puzzle starts (fresh or shared). Stays null when
 * the user resumes a previous session from localStorage — in that
 * case `puzzle-completed` falls back to deriving fields from the
 * installed game state alone.
 */
let currentGameAnalytics: NewGameData | null = null;

const renderer = new SvgDomRenderer();
renderer.init(app);

// Multi-select tool
const selectionManager = new SelectionManager();

// Floating rotate-buttons focus tracker
const rotationFocus = new RotationFocus();

const completionPresenter = createCompletionPresenter({ container: app, rotationFocus });

// When selection changes, update group visuals and persist it (debounced)
// so the selection survives a reload. The selection is stored alongside the
// game state, so it is cleared automatically when the user deselects all or
// starts a new game, and never leaks into share links.
selectionManager.onChange((selectedIds) => {
    const state = session.current();
    // Remove highlight from all groups, then re-apply to selected
    for (const group of state?.groups ?? []) {
        renderer.setGroupSelected(group.id, selectedIds.has(group.id));
    }
    if (state) saveCoordinator.autoSave(state);
});

// Debug helper: solve the puzzle by placing all pieces in their correct positions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__solvePuzzle = () => {
    const state = session.current();
    if (!state) return;

    const solvedGroup: import('./model/types.js').PieceGroup = {
        id: 0,
        pieces: new Map(),
        position: { x: 0, y: 0 },
        rotation: 0,
    };

    for (const piece of state.pieces) {
        solvedGroup.pieces.set(piece.id, {
            x: -piece.imageOffset.x,
            y: -piece.imageOffset.y,
        });
    }

    state.groups = [solvedGroup];
    const solvedIndexes = buildGroupIndexes(state.groups);
    state.groupsById = solvedIndexes.groupsById;
    state.pieceToGroup = solvedIndexes.pieceToGroup;
    state.completed = true;
    renderer.renderState(state);

    // Use the same animated zoom as normal completion
    zoomToFitCompletedPuzzle(state, solvedGroup, viewportFitDeps, () => {
        // Read late, as the module global did: the overlay lands ~800ms
        // later, by which time a new game may have replaced this one.
        const settled = session.current();
        if (settled) completionPresenter.show(settled);
    });
};

/**
 * Dev-console hook for visual smoke-testing the experimental two-circle
 * Venn cut style. Not exposed in any UI. Removed before Plan 2 merges
 * if the cut style isn't promoted to a user-facing option.
 *
 * Usage (in browser dev console):
 *   __startVennPuzzle()
 *   __startVennPuzzle({ leftRadius: 200, rightCenter: { x: 700, y: 360 } })
 *   __startVennPuzzle({ tabs: true })   // classic tabs on the shared arcs
 *
 * Caveat: share-links and reloads don't yet preserve the venn config —
 * only the in-memory render is meaningful. After the page reloads, the
 * autosaved state falls back to sine defaults.
 */
(window as any).__startVennPuzzle = (overrides?: {
    leftCenter?: { x: number; y: number };
    leftRadius?: number;
    rightCenter?: { x: number; y: number };
    rightRadius?: number;
    tabs?: boolean;
}) => {
    const baseCutConfig = {
        leftCenter: overrides?.leftCenter ?? { x: 432, y: 360 },
        leftRadius: overrides?.leftRadius ?? 240,
        rightCenter: overrides?.rightCenter ?? { x: 648, y: 360 },
        rightRadius: overrides?.rightRadius ?? 240,
    };
    void startNewGame({ cols: 1, rows: 1 }, {
        cutStyle: 'composable',
        composableConfig: {
            baseCutGenerator: 'venn',
            baseCutConfig,
            tabGenerator: overrides?.tabs ? 'classic' : 'none',
            tabConfig: {},
        },
        imageSource: 'blank',
    });
};

/**
 * Dev-console hook for launching a Composable puzzle with arbitrary
 * generator parameters. Exposed because Composable is hidden from the
 * production new-game dialog; power users can still reach the full
 * surface via this helper.
 *
 * Usage (browser console):
 *   __newComposableGame()
 *   __newComposableGame({ cols: 12, rows: 8 })
 *   __newComposableGame({
 *       baseCutConfig: { cols: 8, rows: 6, ha: 0.3, hf: 2, va: 0.3, vf: 1.5 },
 *       tabGenerator: 'none',
 *   })
 *   __newComposableGame({ rotation: 'free' })
 *   __newComposableGame({ seed: 1086655870 })   // reproduce a specific puzzle
 *
 * Defaults: 8×6 grid, sine base-cut generator with composable's stock
 * defaults, classic tabs, no rotation, current saved image-source
 * preference. Seed defaults to a fresh random value each call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__newComposableGame = (overrides?: {
    cols?: number;
    rows?: number;
    baseCutGenerator?: string;
    baseCutConfig?: Record<string, unknown>;
    tabGenerator?: string;
    tabConfig?: Record<string, unknown>;
    minPieceArea?: number;
    rotation?: 'none' | 'free';
    imageSource?: 'random' | 'blank';
    seed?: number;
}) => {
    const cols = overrides?.cols ?? 8;
    const rows = overrides?.rows ?? 6;
    const baseCutConfig = overrides?.baseCutConfig ?? {
        cols, rows, ha: 0.15, hf: 1.5, va: 0.15, vf: 1.5,
    };
    const config: import('./puzzle/composable-generator.js').ComposableConfig = {
        baseCutGenerator: overrides?.baseCutGenerator ?? 'sine',
        baseCutConfig,
        tabGenerator: overrides?.tabGenerator ?? 'classic',
        tabConfig: overrides?.tabConfig ?? {},
    };
    if (overrides?.minPieceArea !== undefined) {
        config.minPieceArea = overrides.minPieceArea;
    }
    const rotation = overrides?.rotation ?? 'none';
    void startNewGame({ cols, rows }, {
        cutStyle: 'composable',
        composableConfig: config,
        imageSource: overrides?.imageSource ?? loadImageSourcePreference(),
        imageCategory: loadImageCategoryPreference(),
        vibrant: loadVibrantPreference(),
        rotationEnabled: rotation !== 'none',
        seed: overrides?.seed,
    });
};

/**
 * Dev-console hook: regenerate a puzzle from the info modal's
 * "Reproduction parameters" block. Paste the block's JSON verbatim:
 *
 *   __reproPuzzle({
 *       seed: 1534700170,
 *       cutStyle: 'classic',
 *       imageUrl: 'https://images.unsplash.com/...',
 *       imageSize: { width: 1080, height: 1440 },
 *       gridSize: { cols: 12, rows: 16 },
 *       rotationMode: 'free',
 *       classicConfig: { traceSetVersion: 1 },
 *   })
 *
 * The params run through the share codec's validation and clamps and
 * then the share-link load path, so reproduction semantics match a
 * share link exactly. `imageUrl: 'blank'` — or no `imageUrl` at all —
 * renders on the blank canvas at the recorded dimensions; geometry
 * depends on the image's dimensions, not its pixels. Fractional
 * `imageSize` values are floored by the codec's clamps, and attribution
 * and background color are not part of the params, so a replayed
 * Unsplash puzzle loses its credit. Replaces the current game and save
 * without confirmation, but leaves the address bar alone: a `#p=` link
 * stays put — as declining its confirm dialog does — so the original
 * link remains reloadable, and a reload re-offers it. Decline the prompt
 * and the replay survives.
 *
 * Resolves `true` once the puzzle is on screen and `false` on any
 * failure (matching `tryLoadSharedPuzzle`), so `await __reproPuzzle(...)`
 * reports the outcome instead of resolving before generation starts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__reproPuzzle = async (params: ReproParams): Promise<boolean> => {
    let payload: SharePayload;
    let decoded: SharePayload | null;
    try {
        payload = reproParamsToPayload(params);
        decoded = decodePayload(encodePayload(payload));
    } catch (err) {
        // The error object rather than its message, so the console keeps the
        // stack and renders it expandable (as `diagnostics.warn` does).
        // eslint-disable-next-line no-console
        console.error('[__reproPuzzle]', err);
        return false;
    }
    if (!decoded) {
        // `decodePayload` returns a bare `null` from any of its shape checks,
        // so which field failed is structurally unavailable here. Echoing the
        // mapped payload is the only way the caller sees the rejected value.
        // The two throwing steps above name the field for every hand-typing
        // mistake they can see (unknown cutStyle/rotationMode; a non-numeric
        // imageSize/gridSize/seed throws from assertPayloadNumbersFinite), so
        // what still reaches this branch is a non-string `imageUrl` or a
        // `composableConfig` the decoder rejects.
        // eslint-disable-next-line no-console
        console.error('[__reproPuzzle] params did not survive share-codec validation', payload);
        return false;
    }
    // Narrowing captured in a const: the async closure below would silently
    // un-narrow if `decoded` ever gained a second assignment.
    const validated = decoded;
    // `!!loadState()` rather than a cheaper key probe, for parity with the
    // share path: `recipientHadSavedState` means "had a *readable* save".
    // The decompress is affordable for a one-shot manual dev action.
    const hadSavedState = !!loadState();
    clearSavedState();
    return runWithErrorReport({
        run: async () => {
            await loadSharedPuzzle(validated, hadSavedState);
            return true;
        },
        warnMessage: 'Failed to load repro puzzle:',
        // A generation failure is the thing this helper exists to
        // investigate, so it has to be readable on a deployed build —
        // `runWithErrorReport`'s default diagnostic is DEV-gated.
        logInProduction: true,
        event: 'shared-load-failed',
        // Not a user-facing share-link failure: a generator failure is often
        // the reason this helper was called at all.
        source: 'repro',
        toastMessage: "Couldn't load repro puzzle",
        fallback: false,
    });
};

// Viewport transform for zoom & pan
const viewportTransform = new ViewportTransform();

/**
 * Apply the current viewport transform to the renderer.
 */
function applyViewportTransform(): void {
    const state = viewportTransform.getState();
    renderer.setViewportTransform(state.scale, state.offset.x, state.offset.y);
}

/** Dependencies for `gatherAndZoomToFit` / `zoomToFitCompletedPuzzle`, built once. */
const viewportFitDeps: ViewportFitDeps = {
    container: app,
    renderer,
    viewportTransform,
    applyTransform: applyViewportTransform,
    // Late-bound: the completion cleanup can fire up to 800ms after the
    // triggering call, by which time a new game may have started — or, if
    // boot failed, none may be installed at all. Nothing installed means
    // nothing to re-render, so the settle step is simply skipped; throwing
    // here would abort the cleanup before the completion overlay is shown.
    renderCurrent: () => {
        const state = session.current();
        if (state) renderer.renderState(state);
    },
};

/**
 * React to a viewport (zoom/pan) change: re-apply the transform to the
 * renderer and persist the new view via the debounced auto-save, so the
 * player's zoom level and pan offset survive a reload (#420).
 */
function onViewportChanged(): void {
    applyViewportTransform();
    const state = session.current();
    if (state) saveCoordinator.autoSave(state);
}

// Owns debounced progress saves, the new-puzzle geometry+progress write, and
// flushing before the page can be torn down (installs its own pagehide /
// visibilitychange listeners as a side effect of construction).
const saveCoordinator = createSaveCoordinator({ selectionManager, viewportTransform });

// Owns the installed game and the interaction wiring bound to it. Everything
// above reads it through `session.current()`, which is `GameState |
// undefined` — boot can fail and install nothing (#488), and the compiler
// now makes each reader say what it does about that.
const session = createGameSession({
    container: app,
    renderer,
    viewportTransform,
    selectionManager,
    rotationFocus,
    onInstalled: (state) => {
        // Any overlay from the previous game goes before this one's can be
        // shown — `completionPresenter.show` no-ops while one is already up.
        completionPresenter.remove();
        updateAttribution(state);
        updateRotationUiVisibility();
        if (state.completed) {
            completionPresenter.show(state);
        }
    },
    save: (state) => saveCoordinator.autoSave(state),
    applyMerge: (state, result, droppedGroupIds) => {
        applyMergeResult(state, result, droppedGroupIds, {
            renderer,
            selectionManager,
            rotationFocus,
            currentGameAnalytics: () => currentGameAnalytics,
            onCompleted: onPuzzleCompleted,
        });
    },
    onViewportChanged,
    applyTransform: applyViewportTransform,
});

// Keep the installed PWA current: detect new versions while open and on
// reopen, and apply them at a safe moment (focus regain or a manual tap).
// The save coordinator flushes first so progress within the debounce window
// survives the reload.
const pwaUpdates = initPwaUpdates(() => saveCoordinator.flush());

/**
 * Project the visual bounds of the given group from world space into
 * screen space, using the current viewport transform. Returns `null` if
 * the group is no longer in the game state.
 */
function getFocusedGroupScreenBounds(
    groupId: number,
): { left: number; right: number; top: number; bottom: number } | null {
    const state = session.current();
    if (!state) return null;
    const group = state.groupsById.get(groupId);
    if (!group) return null;
    const local = getGroupVisualBounds(group, state.piecesById);
    const worldLeft = group.position.x + local.minX;
    const worldTop = group.position.y + local.minY;
    const worldRight = worldLeft + local.width;
    const worldBottom = worldTop + local.height;
    const tl = viewportTransform.worldToScreen({ x: worldLeft, y: worldTop });
    const br = viewportTransform.worldToScreen({ x: worldRight, y: worldBottom });
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

/**
 * Frame and celebrate a just-completed puzzle: zoom to fit the single
 * surviving group, then show the completion overlay once the zoom settles.
 *
 * Passed to `applyMergeResult` as `onCompleted`, which owns detecting the
 * win but not the viewport — that stays here.
 */
function onPuzzleCompleted(state: GameState): void {
    if (state.groups.length === 1) {
        zoomToFitCompletedPuzzle(state, state.groups[0], viewportFitDeps, () => {
            completionPresenter.show(state);
        });
    } else {
        // Fallback: shouldn't happen if the puzzle just completed.
        completionPresenter.show(state);
    }
}

/**
 * Update the attribution display for the game being installed.
 */
function updateAttribution(state: GameState): void {
    removeAttribution(app);

    if (state.attribution) {
        const el = createAttributionElement(state.attribution);
        app.appendChild(el);
    }
}

interface StartNewGameOptions {
    /** Cut style for piece generation. Defaults to Classic. */
    cutStyle?: CutStyle;
    composableConfig?: import('./puzzle/composable-generator.js').ComposableConfig;
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
 * Start a new game. Uses the player-picked photo when one is given;
 * otherwise fetches a random Unsplash image if available. Falls back to
 * the default image if the API key is missing or fetch fails.
 *
 * @param gridSize - Grid dimensions (cols × rows) for the puzzle
 * @param options - Per-game choices; see {@link StartNewGameOptions}
 */
async function startNewGame(
    gridSize: GridSize,
    options: StartNewGameOptions = {},
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
    showLoadingOverlay();
    try {
        // Reset viewport transform so pieces are randomized in unzoomed coordinates
        viewportTransform.reset();
        applyViewportTransform();

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

        const viewport = {
            width: app.clientWidth || window.innerWidth,
            height: app.clientHeight || window.innerHeight,
        };

        // Match the puzzle to the shape of the screen it's created on. This is
        // the only place orientation is decided; the resulting grid and image
        // size flow into the save/share payload, so replay reproduces it
        // without re-reading the viewport.
        const orientation = orientationForViewport(viewport);
        const oriented = orientGridSize(gridSize, orientation);

        const bundled = pickBundledImage(orientation);
        let imageUrl: string = bundled.url;
        let imageSize = bundled.size;
        let attribution: GameState['attribution'] = bundled.attribution;

        // Blank puzzle: white image, no photo. Match the puzzle orientation so
        // a portrait screen gets a portrait blank canvas.
        if (imageSource === 'blank') {
            const blankSize = blankSizeForOrientation(orientation);
            imageUrl = createBlankImageDataUrl(blankSize);
            imageSize = blankSize;
            attribution = undefined;
        }

        // Unsplash access is needed for the random fetch and for the
        // download trigger on a picked photo — but not for blank or the
        // deterministic first-run puzzle (bundled defaults set above).
        const accessKey =
            imageSource !== 'blank' && imageSource !== 'first-run'
                ? getUnsplashAccessKey()
                : null;

        let downloadLocation: string | undefined;

        if (imageSource !== 'blank' && pickedImage) {
            // The player picked a concrete candidate in the dialog — use it
            // directly, no second API call.
            imageUrl = pickedImage.imageUrl;
            imageSize = pickedImage.imageSize;
            attribution = pickedImage.attribution;
            downloadLocation = pickedImage.downloadLocation;
        } else if (accessKey) {
            const resolved = await resolveUnsplashImage(accessKey, imageCategory ?? 'any', vibrant, orientation);
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
        // Read twice, ~100 lines apart (warn here, flag the analytics event
        // below), so it gets one spelling. Aliasing the discriminant check
        // keeps `tracedTabs.error` narrowed at the first use.
        const chunkDegraded = tracedTabs.kind === 'legacy-classic' && tracedTabs.degraded;
        if (chunkDegraded) {
            // Degrading is quiet for the player by design, but not for us:
            // warn like every other failure channel in this file, and flag
            // the analytics event below so these games stay separable from
            // genuine pre-upgrade Classic traffic.
            diagnostics.warn(
                'Traced tab chunk failed to load; Classic fell back to the legacy cut:',
                tracedTabs.error,
            );
        }

        // Unsplash guidelines: report a "download" when a photo is actually
        // used. Fire-and-forget — a failure must never block the game.
        if (accessKey && downloadLocation) {
            triggerPhotoDownload(downloadLocation, accessKey).catch(() => {});
        }

        const rotationMode = rotationModeForNewGame(cutStyle, rotationEnabled);

        const generatorConfigs = generatorConfigsForNewGame({
            cutStyle,
            fractalConfig,
            wavyConfig,
            tracedTabsOk: tracedTabs.kind === 'ok',
        });

        // Let the overlay paint before the synchronous piece-generation burst.
        await yieldForPaint();

        const state = createNewGame(imageUrl, imageSize, viewport, oriented, {
            cutStyle,
            composableConfig,
            ...generatorConfigs,
            rotationMode,
            seed,
        });

        if (attribution) {
            state.attribution = attribution;
        }

        session.install(state);
        gatherAndZoomToFit(state, viewportFitDeps);
        renderer.renderState(state);
        saveCoordinator.persistNewPuzzle(state);

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
        });
        currentGameAnalytics = data;
        track('new-game-started', currentGameAnalytics);
    } finally {
        hideLoadingOverlay();
    }
}

// Set up the New Game button
createNewGameButton({
    container: app,
    // Guarded like the other interaction entry points that read the
    // session: these three run synchronously on click, so an unguarded read
    // threw and swallowed the click whenever boot left no game behind —
    // making the New Game dialog, the one place a player can pick a
    // smaller grid or a blank image and escape a failure rooted in their
    // inputs, the one thing they couldn't reach (#488). Reloading just
    // replays the same inputs. Zero counts read as "no progress to lose",
    // so the dialog opens without a confirm, which is correct with nothing
    // on screen.
    isCompleted: () => session.current()?.completed ?? false,
    getGroupCount: () => session.current()?.groups.length ?? 0,
    getPieceCount: () => session.current()?.pieces.length ?? 0,
    onNewGame: () => {
        const preferredSizeId = loadSizePreference();
        const preferredCutStyleId = loadCutStylePreference();
        const savedComposableConfig = loadComposableConfigPreference();
        const savedFractalConfig = loadFractalConfigPreference();
        const savedRotationEnabled = loadRotationEnabledPreference();
        const savedImageCategory = loadImageCategoryPreference();
        const savedVibrant = loadVibrantPreference();
        createNewGameDialog({
            container: app,
            selectedSizeId: preferredSizeId,
            selectedCutStyleId: preferredCutStyleId,
            savedComposableConfig: savedComposableConfig,
            savedFractalConfig: savedFractalConfig,
            savedWavyConfig: loadWavyConfigPreference(),
            savedRotationEnabled: savedRotationEnabled,
            composableSupportsBorderless:
                getBaseCutGenerator('sine').supportsBorderless ?? false,
            savedImageCategory: savedImageCategory,
            savedVibrant: savedVibrant,
            fetchImageCandidates: (() => {
                const accessKey = getUnsplashAccessKey();
                if (!accessKey) return undefined;
                return (imageCategory: string, vibrant: boolean) =>
                    fetchCandidateImages(
                        accessKey,
                        imageCategory,
                        vibrant,
                        orientationForViewport({
                            width: app.clientWidth || window.innerWidth,
                            height: app.clientHeight || window.innerHeight,
                        }),
                    );
            })(),
            onPreloadTracedTabs: () => {
                // Fire-and-forget — preloadTracedTabGenerator is
                // idempotent and clears its cached promise on failure,
                // so the eventual `await` in startNewGame triggers a
                // fresh attempt that surfaces the real error. Swallow
                // here only to stop the in-flight rejection from
                // surfacing as an unhandled-rejection warning.
                preloadTracedTabGenerator().catch(() => {});
            },
            onSelect: ({ sizeId, cutStyleId, composableConfig, fractalConfig, wavyConfig, rotationEnabled, imageChoice, imageCategory, vibrant }) => {
                saveSizePreference(sizeId);
                saveCutStylePreference(cutStyleId);
                if (composableConfig) {
                    saveComposableConfigPreference(composableConfig);
                }
                if (fractalConfig) {
                    saveFractalConfigPreference(fractalConfig);
                }
                if (wavyConfig) {
                    saveWavyConfigPreference(wavyConfig);
                }
                saveRotationEnabledPreference(rotationEnabled);
                // No UI reads this preference anymore, but first-run
                // detection depends on the key existing, and analytics
                // still classifies by it.
                saveImageSourcePreference(imageChoice.kind === 'blank' ? 'blank' : 'random');
                saveImageCategoryPreference(imageCategory);
                saveVibrantPreference(vibrant);
                const option = getSizeOption(sizeId);
                const cutStyle = cutStyleId as CutStyle;
                clearSavedState();
                const newGame = startNewGame(toGridSize(option), {
                    cutStyle,
                    composableConfig: composableConfig
                        ? composableSliderToGeneratorConfig(composableConfig)
                        : undefined,
                    imageSource: imageChoice.kind === 'blank' ? 'blank' : 'random',
                    imageCategory,
                    fractalConfig,
                    wavyConfig,
                    vibrant,
                    rotationEnabled,
                    // seed omitted — fresh random for every dialog game
                    pickedImage: imageChoice.kind === 'photo' ? imageChoice.photo : undefined,
                });
                void runWithErrorReport({
                    // The chunk-load path (traced tabs lazy import) is the most
                    // likely source of a rejection here — a network blip or
                    // stale deploy hash. The user gets a toast so the click
                    // doesn't silently do nothing; `new-game-failed` records it.
                    run: () => newGame,
                    warnMessage: 'Failed to start new game:',
                    event: 'new-game-failed',
                    cutStyle,
                    toastMessage: "Couldn't start new game",
                    fallback: undefined,
                });
            },
        });
    },
});

// Set up the Gather Pieces button
createGatherPiecesButton({
    container: app,
    onGatherPieces: () => {
        // The last sibling of the New Game read above: all three of these
        // touch the session synchronously, so the click threw whenever boot
        // left no game behind. There is nothing to gather in that state,
        // so doing nothing is the whole correct behavior.
        const state = session.current();
        if (!state) return;
        gatherAndZoomToFit(state, viewportFitDeps);
        renderer.renderState(state);
        saveCoordinator.autoSave(state);
    },
});

// Set up the multi-select tool button (top-left)
createSelectToolButton({
    container: app,
    selectionManager,
});

// Set up the marquee tool button, directly below the multi-select button
createMarqueeToolButton({
    container: app,
    selectionManager,
});

// Set up the deselect-all button (bottom-center, hidden until selection exists)
createDeselectButton({
    container: app,
    selectionManager,
});

// Set up the rotate buttons (bottom-left, fractal-only).
// Visibility is updated whenever a game is installed.
const rotateButtons = createRotateButtons({
    container: app,
    rotationFocus,
    onRotate: (groupId, direction) => {
        const state = session.current();
        if (!state) return;
        const group = state.groupsById.get(groupId);
        if (!group) return;

        const deltaDeg = direction === 'cw' ? 90 : -90;
        rotateGroup(group, state.piecesById, deltaDeg);

        renderer.renderState(state);
        // Re-apply selection visuals after re-render (rotation re-renders the group).
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        saveCoordinator.autoSave(state);
    },
    getFocusedGroupScreenBounds,
});

const snapPosition = new SnapProximityPositionController({
    getState: () => session.current(),
    getTolerances: activeSnapTolerances,
});

const rotateHandle = createRotateHandle({
    container: app,
    rotationFocus,
    onRotateStart: (groupId) => {
        if (!session.current()) return;
        snapPosition.start(groupId);
    },
    onRotate: (groupId, deltaDegrees) => {
        const state = session.current();
        if (!state) return;
        const group = state.groupsById.get(groupId);
        if (!group) return;
        rotateGroup(group, state.piecesById, deltaDegrees);
        snapPosition.onGroupRotated();
        renderer.renderState(state);
        // Re-apply selection visuals after re-render.
        for (const selectedId of selectionManager.selectedGroupIds) {
            renderer.setGroupSelected(selectedId, true);
        }
        // Don't autoSave on every drag tick — autoSave fires on commit.
    },
    onCommit: (groupId) => {
        const state = session.current();
        if (!state) return;

        const { tolerancePx, rotationToleranceDeg } = activeSnapTolerances(state);

        const result = processDrop(groupId, state, tolerancePx, rotationToleranceDeg);
        if (result) {
            applyMergeResult(state, result, [result.group.id], {
                renderer,
                selectionManager,
                rotationFocus,
                currentGameAnalytics: () => currentGameAnalytics,
                onCompleted: onPuzzleCompleted,
            });
        }
        saveCoordinator.autoSave(state);
    },
    onRotateEnd: () => {
        snapPosition.stop();
    },
    getFocusedGroupScreenBounds,
    getGroupRotation: (groupId) => session.current()?.groupsById.get(groupId)?.rotation ?? null,
    getGroupPivotWorld: (groupId) => {
        const state = session.current();
        const group = state?.groupsById.get(groupId);
        if (!group || !state) return null;
        // Interactive rotation pivots about the tab-inclusive bounds center so
        // the handle tracks the visible footprint of a mid-assembly group with
        // exposed tabs/blanks. (The completion spin instead pivots about the
        // corner-only image center via getGroupImageCenter — a deliberately
        // different point, since a solved puzzle has a flat border.)
        const bounds = getGroupLocalBounds(group, state.piecesById);
        const centerLocal = {
            x: bounds.minX + bounds.width / 2,
            y: bounds.minY + bounds.height / 2,
        };
        return localToWorld(centerLocal, group);
    },
    screenToWorld: (clientX, clientY) => viewportTransform.screenToWorld({ x: clientX, y: clientY }),
});

function updateRotationUiVisibility(): void {
    const state = session.current();
    if (state?.rotationMode === 'quarter-turn') {
        rotateButtons.show();
        rotateHandle.hide();
    } else if (state?.rotationMode === 'free') {
        rotateButtons.hide();
        rotateHandle.show();
    } else {
        rotateButtons.hide();
        rotateHandle.hide();
    }
}

// Install the SVG filter used by the "Outline" piece-outline mode and
// apply the saved style + color preferences. The color itself flips
// with the OS theme via CSS, so (unlike the background) no re-apply on
// theme change is needed.
installPieceOutlineFilter();
applyPieceOutline(loadPieceOutlinePreference());
applyPieceOutlineColor(loadPieceOutlineColorPreference());

// Set up the Background Color picker
let currentColorId = loadColorPreference();
applyBackgroundColor(currentColorId);

// The background color flips with the OS theme via CSS; re-apply only
// to recompute the luminance-derived UI-chrome scheme on the flip.
onColorSchemeChange(() => applyBackgroundColor(currentColorId));

const backgroundColorPicker = createBackgroundColorPicker({
    container: app,
    selectedId: currentColorId,
    onSelect: (id) => {
        // Re-selecting the current swatch is a no-op, not a switch.
        if (id !== currentColorId) {
            track('background-color-changed', { from: currentColorId, to: id });
        }
        currentColorId = id;
        saveColorPreference(id);
        applyBackgroundColor(id);
    },
});

// Set up the Info button
createInfoButton({
    container: app,
    onShowInfo: () => {
        createInfoModal({
            container: app,
            getState: () => session.current(),
            state: session.current(),
            onSolve: () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__solvePuzzle?.();
            },
        });
    },
});

async function loadSharedPuzzle(
    payload: SharePayload,
    recipientHadSavedState: boolean,
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
            width: app.clientWidth || window.innerWidth,
            height: app.clientHeight || window.innerHeight,
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

        session.install(state);
        gatherAndZoomToFit(state, viewportFitDeps);
        renderer.renderState(state);
        saveCoordinator.persistNewPuzzle(state);

        // Offer the sharer's background color to a recipient who has
        // never picked one. Adoption persists it as their preference and
        // must be reflected in the picker + the OS-theme re-apply state.
        // 'none' means the link carried no color at all; a present-but-
        // unrecognized id reports as 'invalid' so palette drift that
        // silently drops a live link's color stays visible in analytics.
        let sharedColor: NonNullable<NewGameData['sharedColor']> = 'none';
        if (payload.bgc !== undefined) {
            const outcome = adoptSharedBackgroundColor(payload.bgc);
            if (outcome === 'adopted') {
                currentColorId = payload.bgc;
                backgroundColorPicker.setSelected(payload.bgc);
            }
            sharedColor = outcome;
        }

        const data = buildSharedGameData({
            state,
            includesProgress: payload.pr !== undefined,
            recipientHadSavedState,
            sharedColor,
        });
        currentGameAnalytics = data;
        track('new-game-started', currentGameAnalytics);
    } finally {
        hideLoadingOverlay();
    }
}

// Set when a rescue update was applied and the page is about to reload:
// the boot flow's blanket overlay teardown must not run, or the page
// flashes blank for the up-to-3s gap before the reload lands.
let rescueReloadPending = false;

/**
 * After the awaited rescue, does our guard entry still name this exact link?
 * True means no concurrent hashchange superseded us mid-rescue — a newer
 * link's attempt would have overwritten the guard. This is the same predicate
 * as {@link wasRescueAttempted}, named for its post-await meaning: before the
 * await the identical call instead answers "is this load the post-reload
 * re-check". Keeping the two readings behind distinct names stops the flipped
 * intent from reading as a copy-paste.
 */
function rescueStillOwnsGuard(hashBody: string): boolean {
    return wasRescueAttempted(hashBody);
}

/**
 * A `#p=` link that fails to decode may just be newer than this cached
 * build (the share format grows without bumping `v`). Run one
 * update-check-and-reload rescue per link: on success the page reloads
 * with the hash intact and the updated build re-parses it. Returns true
 * when that reload is imminent (the caller must halt the boot flow); on
 * every other outcome the caller falls through to the invalid-link toast.
 */
async function rescueUndecodableLink(hashBody: string): Promise<boolean> {
    if (wasRescueAttempted(hashBody)) {
        // This load IS the rescue reload for this exact link, and it still
        // doesn't decode: the latest build doesn't understand it either.
        // A same-document hash round-trip back to this link during an
        // in-flight rescue would also land here; that's accepted as a
        // contrived edge case (a real re-paste navigates and gets fresh page).
        clearRescueAttempt();
        track('share-link-rescue-result', { decoded: false });
        return false;
    }
    // A guard that can't be persisted would let a still-invalid link
    // reload forever; skip the rescue instead of risking the loop.
    if (!recordRescueAttempt(hashBody)) return false;
    showLoadingOverlay('Checking for app update…');
    const outcome = await pwaUpdates.attemptShareLinkRescue();
    track('share-link-rescue-attempted', { outcome });
    if (outcome === 'updated') {
        // The new worker is activating; the update-controller reloads the
        // page (with a hard-reload fallback). Keep the overlay and hash up.
        rescueReloadPending = true;
        return true;
    }
    // A guard mismatch means a hashchange during our rescue started a
    // newer link's attempt: its guard entry must survive, and the overlay
    // now belongs to that in-flight rescue — leave both alone.
    if (rescueStillOwnsGuard(hashBody)) {
        clearRescueAttempt();
        // The boot path's finally would hide it, but the hashchange path
        // has no such backstop — hide explicitly before the toast.
        hideLoadingOverlay();
    }
    return false;
}

async function tryLoadSharedPuzzle(): Promise<boolean> {
    // Captured once at entry, before any await. `slice(3)` drops the `#p=`
    // prefix and is only meaningful on a `#p=` hash — every use below is gated
    // on that. The post-rescue change-detection check deliberately re-slices
    // the *current* hash instead of reusing this, to spot a hashchange that
    // landed during the await.
    const hashBody = window.location.hash.slice(3);
    const payload = parseLocationHash(window.location.hash);
    if (!payload) {
        if (window.location.hash.startsWith('#p=')) {
            if (await rescueUndecodableLink(hashBody)) {
                // Rescue reload imminent — report "handled" so the boot
                // flow doesn't start a saved/fresh game underneath it.
                return true;
            }
            // A hashchange during the rescue means this invocation's link
            // is no longer the one in the address bar; the newer
            // invocation owns the toast/strip decision now.
            if (window.location.hash.slice(3) !== hashBody) return false;
            showToast('Invalid share link');
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        return false;
    }

    // The link decoded. If this load is the back half of a rescue reload,
    // close the analytics funnel: the update fixed the link. Clearing
    // unconditionally also drops any stale guard from an abandoned rescue.
    if (wasRescueAttempted(hashBody)) {
        track('share-link-rescue-result', { decoded: true });
    }
    clearRescueAttempt();

    // An unreadable save reads as no progress here, so its recovery blobs are
    // not offered for download on this path — corrupt-save recovery is
    // deliberately startup-only. The user is explicitly navigating to a new
    // puzzle, and clearSavedState() below would overwrite the blobs anyway.
    const hasExistingProgress = !!loadState();
    if (hasExistingProgress) {
        const ok = window.confirm('Load shared puzzle? Your current progress will be lost.');
        if (!ok) {
            // Leave the hash in place so the user can reload to retry.
            return false;
        }
    }

    clearSavedState();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    // Surface-shape validation (`isValidComposableCf` etc.) catches most
    // malformed payloads at decode time, but a link can still satisfy the
    // schema and then trip the topology pipeline — e.g. a config combination
    // the current build doesn't support. Report it and toast rather than
    // letting it surface as an unhandled rejection.
    return runWithErrorReport({
        run: async () => {
            await loadSharedPuzzle(payload, hasExistingProgress);
            return true;
        },
        warnMessage: 'Failed to load shared puzzle:',
        event: 'shared-load-failed',
        source: 'shared',
        toastMessage: "Couldn't load shared puzzle",
        fallback: false,
    });
}

// On load: shared-link (hash) > saved game > fresh start.
// index.html renders the loading overlay up front so users see feedback
// before JS finishes booting. `startNewGame` / `loadSharedPuzzle` manage
// the overlay themselves; the saved-state branch hides it manually.
void (async () => {
    try {
        const loadedFromShare = await tryLoadSharedPuzzle();
        if (loadedFromShare) return;

        const saved = loadSavedGame();
        if (saved.status === 'ok') {
            session.install(saved.state);
            session.restoreSelection(saved.selection);
            if (saved.viewport) {
                // Restore the zoom/pan the player last had (#420). Absent on
                // pre-feature saves — those keep the default view, as before.
                viewportTransform.setState(saved.viewport);
                applyViewportTransform();
            }
            return;
        }
        if (saved.status === 'unreadable') {
            // A save was present but couldn't be restored. Stop before the
            // fresh puzzle overwrites it: let the player download the raw
            // (in-memory) blobs for recovery. Boot continues once they close
            // the dialog. The pre-boot loading overlay (z-index above the
            // dialog) is hidden so the modal is visible.
            track('save-unreadable', { reason: saved.reason });
            hideLoadingOverlay();
            await new Promise<void>((resolve) => {
                createCorruptSaveDialog({
                    container: app,
                    raw: saved.raw,
                    onDismiss: ({ downloaded }) => {
                        track('save-recovery', { downloaded });
                        resolve();
                    },
                });
            });
        }

        // No (readable) saved game: use the saved preferences. Mirror the
        // New Game dialog path so a first-load (or post-regeneration) puzzle
        // respects every remembered preference — otherwise composable cuts,
        // image source/category, and vibrancy silently fall back to defaults
        // and the resulting save (and any share link from it) wouldn't match
        // what the user last chose.
        const preferredSizeId = loadSizePreference();
        const option = getSizeOption(preferredSizeId);
        const preferredCutStyle = loadCutStylePreference() as CutStyle;
        const preferredComposable = loadComposableConfigPreference();
        const preferredFractalConfig = loadFractalConfigPreference();
        const preferredWavyConfig = loadWavyConfigPreference();
        const preferredRotationEnabled = loadRotationEnabledPreference();
        // A brand-new visitor (no save at all, never touched an image
        // preference) gets the hand-picked bundled image instead of a
        // random one, so the first impression works against the default
        // background. An unreadable save means a returning user — they
        // keep today's random-image behavior.
        const firstRun = saved.status === 'empty'
            && !imageSourcePreferenceExists()
            && !imageCategoryPreferenceExists();
        const gridSize = toGridSize(option);
        const imageSource = firstRun ? 'first-run' : loadImageSourcePreference();
        const imageCategory = loadImageCategoryPreference();
        const vibrant = loadVibrantPreference();

        await startWithBootFallback({
            cutStyle: preferredCutStyle,
            start: () => startNewGame(gridSize, {
                cutStyle: preferredCutStyle,
                composableConfig: preferredCutStyle === 'composable' && preferredComposable
                    ? composableSliderToGeneratorConfig(preferredComposable)
                    : undefined,
                imageSource,
                imageCategory,
                fractalConfig: preferredFractalConfig,
                wavyConfig: preferredWavyConfig,
                vibrant,
                rotationEnabled: preferredRotationEnabled,
            }),
            // Everything except the cut is kept: same size, image source,
            // category, vibrancy, rotation. The per-style configs are
            // deliberately dropped — with the style forced to Classic they
            // are dead weight, and a saved Composable config the build
            // cannot generate is one of the failures being recovered from.
            startFallback: () => startNewGame(gridSize, {
                bootFallback: true,
                imageSource,
                imageCategory,
                vibrant,
                rotationEnabled: preferredRotationEnabled,
            }),
            // Deliberately not `session.current() !== undefined`: `install`
            // makes the state current before it renders and wires
            // interaction, so a throw inside that window would report "a
            // puzzle reached the screen" over a blank or undraggable canvas
            // — the fallback skipped and no toast shown, which is the #488
            // symptom again. `hasGame()` is false until the interaction
            // teardown handle is assigned, which is `install`'s last
            // statement, so it means exactly what this predicate has to
            // mean. (A throw in that window makes the fallback re-run
            // `install` and most likely fail the same way — but then the
            // player gets told.)
            hasGame: () => session.hasGame(),
        });
    } finally {
        if (!rescueReloadPending) hideLoadingOverlay();
    }
})();

// Handle share links pasted into the address bar of a tab that already
// has the app loaded. Without this, the hash changes but nothing reacts
// until the user reloads. `history.replaceState` calls inside
// tryLoadSharedPuzzle don't fire hashchange, so there's no loop risk.
window.addEventListener('hashchange', () => {
    void tryLoadSharedPuzzle();
});
