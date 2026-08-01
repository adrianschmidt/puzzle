/**
 * The composition root: construct the app's singletons, wire them together,
 * and kick off boot.
 *
 * This is what `main.ts` used to be, and the reason that file grew to 1939
 * lines no test could reach. `bootstrap` is a function and **this module runs
 * nothing on import**, so the wiring — and in particular its order — is
 * finally testable; `bootstrap.test.ts` pins the orderings that previously
 * held only because of where a statement happened to sit.
 *
 * Statement order here is a contract, not a style choice:
 *
 *  - `installGlobalHandlers` goes first, so analytics and error reporting are
 *    up before anything that can throw.
 *  - `installGeometryTokenInvalidation` follows it, ahead of boot. Not because
 *    of *this* tab's writes — storage events never fire in the window that
 *    made the change, so our own saves are invisible to that listener by
 *    design. Because another tab's write is only ever seen live: there is no
 *    replay for a document that was not listening at the time. Nothing below
 *    can deliver one today, since this function runs synchronously through to
 *    `runBootSequence`; installing here is what keeps that true if any
 *    statement above it ever gains an `await`.
 *  - The rotation UI is built before the session. The session's `onInstalled`
 *    is built from `rotationUi.syncVisibility` read as a bare value, which
 *    makes reordering the two a use-before-declaration error the compiler
 *    reports rather than a convention a comment asks for.
 *  - `installToolbar` runs before `sharedDeps`: the toolbar is what invokes
 *    `installBackgroundColorControl`, and the handle it hands back is what
 *    the share path reads. That one is a plain data dependency now, so the
 *    compiler holds it rather than this comment.
 *  - The `hashchange` listener is registered *after* boot is kicked off. Boot
 *    runs synchronously to its first await, so the order is observable.
 */

import type { GameState, PieceGroup } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import { SvgDomRenderer } from '../renderer/index.js';
import { ViewportTransform, RotationFocus } from '../interaction/index.js';
import {
    createAttributionElement,
    removeAttribution,
} from '../ui/index.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import type { NewGameData } from '../analytics/index.js';
import { startNewGame, type StartNewGameDeps } from './start-new-game.js';
import { loadSharedPuzzle, type LoadSharedPuzzleDeps } from './load-shared-puzzle.js';
import { createShareLinkLoader } from './share-link-loader.js';
import { runBootSequence } from './boot-sequence.js';
import { openNewGameDialog } from './new-game-flow.js';
import { createCompletionPresenter } from './completion-presenter.js';
import { gatherAndZoomToFit, zoomToFitCompletedPuzzle, type ViewportFitDeps } from './viewport-fit.js';
import { createSaveCoordinator } from './save-coordinator.js';
import { applyMergeResult } from './merge-result.js';
import { createGameSession } from './game-session.js';
import { createRotationUi, type RotationUi } from './rotation-ui.js';
import { installBackgroundColor } from './install-background-color.js';
import { installGlobalHandlers } from './global-handlers.js';
import { installToolbar } from './install-toolbar.js';
import { installDevHooks, solvePuzzle } from './dev-hooks.js';
import { installGeometryTokenInvalidation } from '../persistence/index.js';
import { initPwaUpdates } from '../pwa/register.js';

/**
 * Build the app and start it inside `root`.
 *
 * `root` defaults to `#app`, evaluated at call time: `main.ts` stays free of
 * any DOM lookup while a test can pass its own container — and importing this
 * module boots nothing.
 */
export function bootstrap(
    root: HTMLElement = document.querySelector<HTMLDivElement>('#app')!,
): void {
    installGlobalHandlers(root);

    // Distrust the persisted geometry-ownership token as soon as another tab
    // touches the geometry, or as soon as we come back from the back/forward
    // cache having missed those events. Installed ahead of boot because a
    // storage event is delivered only to a document already listening — it is
    // never replayed — so any turn of the event loop that precedes this is a
    // turn whose cross-tab writes we never learn about.
    installGeometryTokenInvalidation();

    /**
     * Analytics metadata for the currently-playing puzzle.
     *
     * Populated when a puzzle starts (fresh or shared). Stays null when
     * the user resumes a previous session from localStorage — in that
     * case `puzzle-completed` falls back to deriving fields from the
     * installed game state alone.
     *
     * Deliberately *not* cleared by `session.install`, so it can outlive the
     * puzzle it describes: both start flows install first and assign this
     * several statements later, and a throw in between (fitting the view,
     * persisting, adopting a shared color) leaves the previous puzzle's
     * payload cached against the newly installed game, where
     * `buildPuzzleCompletedData` lets it win over the derived fields.
     * Carried verbatim from `main.ts` rather than fixed here — this refactor
     * changes no behavior. Tracked as #507.
     */
    let currentGameAnalytics: NewGameData | null = null;

    const renderer = new SvgDomRenderer();
    renderer.init(root);

    // Multi-select tool
    const selectionManager = new SelectionManager();

    // Floating rotate-buttons focus tracker
    const rotationFocus = new RotationFocus();

    const completionPresenter = createCompletionPresenter({ container: root, rotationFocus });

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
        container: root,
        renderer,
        viewportTransform,
        applyTransform: applyViewportTransform,
        // Late-bound: the completion cleanup can fire up to 1000ms after the
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

    /**
     * Apply a merge produced by a drop or a rotate-handle commit: hand off to
     * `applyMergeResult` with the collaborators it needs to update visuals,
     * selection and rotation focus, carry analytics, and trigger the
     * completion flow. Shared, unmodified, by the rotation UI and the game
     * session — both drive a merge outcome through the exact same follow-up.
     */
    const applyMerge = (
        state: GameState,
        result: MergeResult,
        droppedGroupIds: readonly number[],
    ): void => {
        applyMergeResult(state, result, droppedGroupIds, {
            renderer,
            selectionManager,
            rotationFocus,
            currentGameAnalytics: () => currentGameAnalytics,
            onCompleted: onPuzzleCompleted,
        });
    };

    // Owns the rotate-buttons/-handle pair (bottom-left, fractal-only /
    // free-rotation drag handle), their shared snap-position controller, and
    // screen-space bounds projection. Constructed before `session` — see
    // `createOnInstalled` for why the compiler now enforces that.
    const rotationUi = createRotationUi({
        container: root,
        renderer,
        viewportTransform,
        selectionManager,
        rotationFocus,
        getState: () => session.current(),
        save: (state) => saveCoordinator.autoSave(state),
        applyMerge,
    });

    /**
     * Build the session's `onInstalled` hook around the rotation UI's
     * `syncVisibility`.
     *
     * Taking `syncRotationUi` as a parameter rather than closing over
     * `rotationUi` is the whole point: the call site below reads
     * `rotationUi.syncVisibility` as a bare value — no wrapper arrow, no
     * `.bind`, which requires `createRotationUi` to return closures rather
     * than a class instance. That read sits in `createGameSession`'s argument
     * list rather than inside a closure, so hoisting `createGameSession` above
     * `createRotationUi` is a use-before-declaration error the compiler
     * reports, rather than an ordering that merely holds because of where two
     * `const`s sit.
     *
     * **Do not inline this back into the deps literal.** Doing so puts the
     * read inside a closure again, and the compile-time guard disappears
     * without a word: `tsc` stays clean, the suite stays green, and
     * `bootstrap.test.ts`'s `creates the rotation UI before the game session`
     * is then the only thing standing between a reorder and a TDZ crash at
     * boot.
     */
    function createOnInstalled(
        syncRotationUi: RotationUi['syncVisibility'],
    ): (state: GameState) => void {
        return (state) => {
            // Any overlay from the previous game goes before this one's can be
            // shown — `completionPresenter.show` no-ops while one is already up.
            completionPresenter.remove();
            updateAttribution(state);
            syncRotationUi(state);
            if (state.completed) {
                completionPresenter.show(state);
            }
        };
    }

    // Owns the installed game and the interaction wiring bound to it. Everything
    // above reads it through `session.current()`, which is `GameState |
    // undefined` — boot can fail and install nothing (#488), and the compiler
    // now makes each reader say what it does about that.
    const session = createGameSession({
        container: root,
        renderer,
        viewportTransform,
        selectionManager,
        rotationFocus,
        onInstalled: createOnInstalled(rotationUi.syncVisibility),
        save: (state) => saveCoordinator.autoSave(state),
        applyMerge,
        onViewportChanged,
        applyTransform: applyViewportTransform,
    });

    // Keep the installed PWA current: detect new versions while open and on
    // reopen, and apply them at a safe moment (focus regain or a manual tap).
    // The save coordinator flushes first so progress within the debounce window
    // survives the reload.
    const pwaUpdates = initPwaUpdates(() => saveCoordinator.flush());

    /**
     * Frame and celebrate a completed puzzle: zoom to fit `group`, then show
     * the completion overlay once the zoom settles.
     *
     * The overlay reads the session late, as the module global did: the zoom
     * lands up to ~1000ms later, by which time a new game may have replaced
     * this one — and the overlay carries a "Challenge a friend" link built
     * from the state it is given, so showing the finished puzzle over a fresh
     * one would hand out a link to the wrong puzzle.
     *
     * The identity test is what makes that real. Nothing owns the settle:
     * `zoomToFitCompletedPuzzle` returns no cancel handle, so once its rAF
     * has run the callback *will* fire, and a bare "something is installed"
     * test passes for the fresh puzzle the player just started — the very
     * case the paragraph above is about. `session.current() === state` asks
     * the narrower question the paragraph actually poses: is the game I
     * zoomed for still the installed one? Anything else — nothing installed,
     * a fresh game, a restored save, or a second puzzle already solved
     * inside this one's zoom window — means this celebration is stale and
     * the overlay is simply skipped. The installed game's own completion,
     * if it has one, gets its own zoom and its own overlay.
     *
     * Shared by both completion routes — a merge-to-one-group win and the
     * debug Solve action — so the two cannot drift apart on this.
     */
    function celebrateCompletion(state: GameState, group: PieceGroup): void {
        zoomToFitCompletedPuzzle(state, group, viewportFitDeps, () => {
            if (session.current() === state) completionPresenter.show(state);
        });
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
            celebrateCompletion(state, state.groups[0]);
        } else {
            // Fallback: shouldn't happen if the puzzle just completed. Shows
            // `state` directly rather than re-reading the session, because
            // nothing defers here — the two are the same object.
            completionPresenter.show(state);
        }
    }

    /**
     * Update the attribution display for the game being installed.
     */
    function updateAttribution(state: GameState): void {
        removeAttribution(root);

        if (state.attribution) {
            const el = createAttributionElement(state.attribution);
            root.appendChild(el);
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
        container: root,
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
        // `hasGame()`, not `current() !== undefined`: the same distinction
        // `boot-sequence.ts` makes for its fallback gate. `install` makes the
        // state current *before* it renders and wires interaction, so
        // `current()` can be non-undefined over a blank canvas — and Cancel's
        // promise ("return to your current puzzle") is the interactive-puzzle
        // question, not the reference-assigned one.
        hasCurrentGame: () => session.hasGame(),
    };

    /**
     * Solve the puzzle: one binding, shared by `window.__solvePuzzle` and the
     * info modal's Solve button. The button receiving it as a dependency
     * instead of looking `window.__solvePuzzle` up at click time is the one
     * sanctioned behavior change in this refactor (see the plan's Global
     * Constraints).
     *
     * Bound here, once, and handed to both `installDevHooks` and
     * `installToolbar`: while each owned its own `solvePuzzle` call, an edit to
     * either `onSolved` would have silently desynchronized the console hook
     * from the button — the exact agreement the change exists to establish.
     */
    const solve = (): void =>
        solvePuzzle({ session, renderer, onSolved: celebrateCompletion });

    installDevHooks({
        // 'dev': this binding is exclusively dev-console starts (e.g.
        // `__newComposableGame`), never the new-game dialog or the boot
        // path. Dev-deploy reports to the same Umami website ID as
        // production, so without this a developer poking at cut parameters
        // would inflate the field-incident count with games no player ever
        // started. Not 'repro': a fresh dev game is not a replay of anything.
        //
        // It is not the only developer route to an arbitrary sine config: on
        // a dev build `isComposableVisible()` also puts Composable in the
        // new-game dialog, frequency sliders and all, and that binding below
        // reports the default 'fresh'. Deliberately left that way — labeling
        // it would mean labeling the whole dialog on a dev build, which would
        // also suppress genuine Classic/Wavy mismatches seen while reviewing
        // a preview, and those are real signal from the production code path.
        // Production hides Composable from the dialog, so the dev rows are
        // separable by query instead; see `PieceCountMismatchData`'s `source`
        // note for the exclusion the operator applies.
        start: (gridSize, options) => startNewGame(gridSize, options, startNewGameDeps, 'dev'),
        // 'repro': this binding is exclusively `__reproPuzzle`'s replay path
        // (see `dev-hooks.ts`), never a real recipient's `#p=` link — so a
        // piece-count mismatch it surfaces is a developer re-running a
        // known-bad puzzle while investigating, not a new field incident.
        // Mirrors the same distinction `runWithErrorReport`'s `source:
        // 'repro'` already makes for `shared-load-failed` on this path.
        loadShared: (payload, recipientHadSavedState) =>
            loadSharedPuzzle(payload, recipientHadSavedState, sharedDeps, 'repro'),
        solve,
    });

    /**
     * Background-color control handle — the swatch picker, the OS-theme
     * re-apply, and the piece-outline SVG filter plus its saved preferences,
     * all installed by the one call.
     *
     * `installToolbar` invokes `installBackgroundColorControl` between the
     * deselect and Info buttons (see `install-toolbar.ts`'s module doc) so
     * DOM order matches the visual top-to-bottom control stack, then hands
     * the handle back. The `installBackgroundColor` call itself stays here,
     * rather than moving into `install-toolbar.ts`, so that the toolbar
     * takes the installer as a dependency instead of reaching for it:
     * `install-toolbar.test.ts` substitutes a marker div and asserts DOM
     * order without running an installer that touches localStorage and an
     * SVG filter. The toolbar module owns *when* the picker's DOM lands,
     * not the picker itself.
     *
     * Taking it as a return value rather than letting the callback assign an
     * outer binding is what keeps `sharedDeps` honest: a `let backgroundColor!`
     * captured by side effect type-checks even when the assignment never
     * happens, and the resulting `undefined` would only surface at
     * `deps.backgroundColor.adopt(...)` — *after* the shared puzzle has
     * already been installed (#500's half-applied state, by a new route).
     */
    const backgroundColor = installToolbar({
        container: root,
        session,
        selectionManager,
        fitView: startNewGameDeps.fitView,
        save: (state) => saveCoordinator.autoSave(state),
        onNewGame: () => {
            openNewGameDialog({
                container: root,
                start: (gridSize, options) => startNewGame(gridSize, options, startNewGameDeps),
            });
        },
        installBackgroundColorControl: () => installBackgroundColor({ container: root }),
        solve,
    });

    /**
     * Dependencies for `loadSharedPuzzle`, built once so both call sites — the
     * share-link boot path and the `__reproPuzzle` console hook — spell the
     * argument the same way. Reuses `startNewGameDeps`'s `fitView`,
     * `persistNewPuzzle` and `onGameAnalytics`: installing a freshly generated
     * puzzle works the same whether it came from a fresh start or a share link.
     *
     * Built after `installToolbar`, which is what invokes
     * `installBackgroundColorControl` and so returns `backgroundColor`.
     */
    const sharedDeps: LoadSharedPuzzleDeps = {
        container: root,
        session,
        fitView: startNewGameDeps.fitView,
        persistNewPuzzle: startNewGameDeps.persistNewPuzzle,
        backgroundColor,
        onGameAnalytics: startNewGameDeps.onGameAnalytics,
        hasCurrentGame: startNewGameDeps.hasCurrentGame,
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
        container: root,
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
    //
    // Registered after the boot sequence is kicked off, matching main.ts's
    // original ordering: boot runs synchronously to its first await.
    window.addEventListener('hashchange', () => {
        void shareLinks.tryLoad();
    });
}
