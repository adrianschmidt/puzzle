import './palette.css';
import './style.css';
import type { GameState, PieceGroup } from './model/types.js';
import { SvgDomRenderer } from './renderer/index.js';
import { ViewportTransform, RotationFocus } from './interaction/index.js';
import {
    createAttributionElement,
    removeAttribution,
} from './ui/index.js';
import { SelectionManager } from './interaction/selection-manager.js';
import type { NewGameData } from './analytics/index.js';
import { startNewGame, type StartNewGameDeps } from './app/start-new-game.js';
import { loadSharedPuzzle, type LoadSharedPuzzleDeps } from './app/load-shared-puzzle.js';
import { createShareLinkLoader } from './app/share-link-loader.js';
import { runBootSequence } from './app/boot-sequence.js';
import { openNewGameDialog } from './app/new-game-flow.js';
import { createCompletionPresenter } from './app/completion-presenter.js';
import { gatherAndZoomToFit, zoomToFitCompletedPuzzle, type ViewportFitDeps } from './app/viewport-fit.js';
import { createSaveCoordinator } from './app/save-coordinator.js';
import { applyMergeResult } from './app/merge-result.js';
import { createGameSession } from './app/game-session.js';
import { createRotationUi } from './app/rotation-ui.js';
import { installBackgroundColor, type BackgroundColorControl } from './app/install-background-color.js';
import { installGlobalHandlers } from './app/global-handlers.js';
import { installToolbar } from './app/install-toolbar.js';
import { installDevHooks, solvePuzzle } from './app/dev-hooks.js';
import { initPwaUpdates } from './pwa/register.js';

const app = document.querySelector<HTMLDivElement>('#app')!;

installGlobalHandlers(app);

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

// Owns the rotate-buttons/-handle pair (bottom-left, fractal-only /
// free-rotation drag handle), their shared snap-position controller, and
// screen-space bounds projection. Constructed before `session` so
// `rotationUi.syncVisibility` can be handed to the session's `onInstalled`
// below as a bare value — no wrapper, no `.bind` — which makes "the
// rotation UI must exist before the session" a data dependency the
// compiler enforces, rather than an ordering that only held because of
// where these consts used to sit in the file.
const rotationUi = createRotationUi({
    container: app,
    renderer,
    viewportTransform,
    selectionManager,
    rotationFocus,
    getState: () => session.current(),
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
});

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
        rotationUi.syncVisibility(state);
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

/**
 * Dependencies for `startNewGame`, built once so every call site spells the
 * argument the same way. `fitView` folds the gather-and-zoom-to-fit step and
 * the follow-up render together: `session.install` already renders the state
 * at its pre-gather positions, so the view-fit's repositioning needs a
 * second render to reach the screen.
 */
const startNewGameDeps: StartNewGameDeps = {
    container: app,
    session,
    resetViewport: () => {
        viewportTransform.reset();
        applyViewportTransform();
    },
    fitView: (state) => {
        gatherAndZoomToFit(state, viewportFitDeps);
        renderer.renderState(state);
    },
    persistNewPuzzle: (state) => saveCoordinator.persistNewPuzzle(state),
    onGameAnalytics: (data) => {
        currentGameAnalytics = data;
    },
};

/**
 * Frame and celebrate a puzzle solved via the debug Solve action — the same
 * completion zoom a normal merge-to-one-group win uses. Shared by
 * `installDevHooks` (for `window.__solvePuzzle`) and `installToolbar`'s
 * `solve` (for the info modal's Solve button), which both call `solvePuzzle`
 * with this same callback.
 */
const onSolved = (state: GameState, group: PieceGroup): void => {
    zoomToFitCompletedPuzzle(state, group, viewportFitDeps, () => {
        // Read late, as the module global did: the overlay lands ~800ms
        // later, by which time a new game may have replaced this one.
        const settled = session.current();
        if (settled) completionPresenter.show(settled);
    });
};

installDevHooks({
    session,
    renderer,
    start: (gridSize, options) => startNewGame(gridSize, options, startNewGameDeps),
    loadShared: (payload, recipientHadSavedState) =>
        loadSharedPuzzle(payload, recipientHadSavedState, sharedDeps),
    onSolved,
});

/**
 * Background-color control handle. Assigned inside
 * `installBackgroundColorControl` below, which `installToolbar` invokes
 * between the deselect and Info buttons (see `install-toolbar.ts`'s module
 * doc) so DOM order matches the visual top-to-bottom control stack. The
 * `installBackgroundColor` call itself stays here, rather than moving into
 * `install-toolbar.ts`, because the handle it returns is also needed below
 * for `sharedDeps` — the toolbar module only owns *when* the picker's DOM
 * lands, not the picker itself.
 */
let backgroundColor!: BackgroundColorControl;

installToolbar({
    container: app,
    session,
    selectionManager,
    fitView: startNewGameDeps.fitView,
    save: (state) => saveCoordinator.autoSave(state),
    onNewGame: () => {
        openNewGameDialog({
            container: app,
            start: (gridSize, options) => startNewGame(gridSize, options, startNewGameDeps),
        });
    },
    installBackgroundColorControl: () => {
        backgroundColor = installBackgroundColor({ container: app });
    },
    // Same implementation `installDevHooks` exposes on `window.__solvePuzzle`
    // — the one sanctioned behavior change in this refactor (see the plan's
    // Global Constraints). The info modal's Solve button receives it as a
    // dependency rather than looking `window.__solvePuzzle` up at click time.
    solve: () => solvePuzzle({ session, renderer, onSolved }),
});

/**
 * Dependencies for `loadSharedPuzzle`, built once so both call sites — the
 * share-link boot path and the `__reproPuzzle` console hook — spell the
 * argument the same way. Reuses `startNewGameDeps`'s `fitView`,
 * `persistNewPuzzle` and `onGameAnalytics`: installing a freshly generated
 * puzzle works the same whether it came from a fresh start or a share link.
 */
const sharedDeps: LoadSharedPuzzleDeps = {
    container: app,
    session,
    fitView: startNewGameDeps.fitView,
    persistNewPuzzle: startNewGameDeps.persistNewPuzzle,
    backgroundColor,
    onGameAnalytics: startNewGameDeps.onGameAnalytics,
};

/**
 * Handles a `#p=` link on boot and on an in-tab hash change, including the
 * stale-client rescue for a link that fails to decode. See
 * `share-link-loader.ts` for the mechanism.
 */
const shareLinks = createShareLinkLoader({
    loadShared: (payload, recipientHadSavedState) =>
        loadSharedPuzzle(payload, recipientHadSavedState, sharedDeps),
    attemptRescue: () => pwaUpdates.attemptShareLinkRescue(),
});

// On load: shared-link (hash) > saved game > fresh start. See
// `boot-sequence.ts` for the flow, the corrupt-save recovery gate, and
// first-run detection.
void runBootSequence({
    container: app,
    session,
    viewportTransform,
    applyTransform: applyViewportTransform,
    tryLoadShared: () => shareLinks.tryLoad(),
    isRescueReloadPending: () => shareLinks.isRescueReloadPending(),
    start: (gridSize, options) => startNewGame(gridSize, options, startNewGameDeps),
});

// Handle share links pasted into the address bar of a tab that already
// has the app loaded. Without this, the hash changes but nothing reacts
// until the user reloads. `history.replaceState` calls inside
// shareLinks.tryLoad don't fire hashchange, so there's no loop risk.
window.addEventListener('hashchange', () => {
    void shareLinks.tryLoad();
});
