/**
 * @vitest-environment jsdom
 */

/**
 * Wiring-order tests for the composition root.
 *
 * Four orderings used to hold only because of where statements happened to
 * sit in `main.ts` — a file no test could import. They are contracts, so
 * they are pinned here:
 *
 *  1. `installGlobalHandlers` runs before anything that can throw, so
 *     analytics and error reporting are up to see it.
 *  2. The rotation UI is built before the session, whose `onInstalled` reads
 *     `syncVisibility` as a bare value.
 *  3. The `hashchange` listener is registered *after* boot is kicked off —
 *     boot runs synchronously to its first await, so the order is observable.
 *  4. The background-color control lands between the deselect and Info
 *     buttons. `install-toolbar.test.ts` owns that tab-order contract with a
 *     full DOM-order assertion; this file checks the real DOM `bootstrap`
 *     builds still satisfies it.
 *  5. Invalidation of the geometry-ownership token is installed, and
 *     installed before boot is kicked off — storage events are delivered
 *     only to a document already listening, never replayed.
 *
 * Plus the one agreement no statement order can enforce: `installDevHooks`
 * and `installToolbar` must receive the *same* `solve` reference, or
 * `window.__solvePuzzle` and the info modal's Solve button can silently
 * drift apart.
 *
 * Most collaborators are spy-*wrapped* rather than replaced, so the real
 * implementations still run and the DOM assertions exercise real code.
 * `global-handlers`, `boot-sequence`, `start-new-game` and
 * `load-shared-puzzle` are replaced outright: they reach analytics, the
 * network and the save file, none of which this file is about.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock, type MockInstance } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import type { SharePayload } from '../sharing/index.js';
import { makeGameState, makeRectPiece } from '../test-helpers/fixtures.js';

// `virtual:pwa-register` only exists at build time (see `pwa/register.ts`'s
// module doc), so the real module cannot be loaded under Vitest at all.
vi.mock('../pwa/register.js', () => ({
    initPwaUpdates: vi.fn(() => ({
        attemptShareLinkRescue: vi.fn(async () => 'no-update' as const),
    })),
}));

vi.mock('./global-handlers.js', () => ({ installGlobalHandlers: vi.fn() }));
vi.mock('./boot-sequence.js', () => ({ runBootSequence: vi.fn(async () => {}) }));
vi.mock('./start-new-game.js', () => ({ startNewGame: vi.fn(async () => {}) }));
vi.mock('./load-shared-puzzle.js', () => ({ loadSharedPuzzle: vi.fn(async () => {}) }));

vi.mock('./rotation-ui.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./rotation-ui.js')>();
    return {
        ...actual,
        // `syncVisibility` is spied on the *returned* object because
        // `bootstrap` reads it as a bare value at construction time — a spy
        // installed afterwards would never be the reference the session got.
        createRotationUi: vi.fn((deps: Parameters<typeof actual.createRotationUi>[0]) => {
            const ui = actual.createRotationUi(deps);
            return { ...ui, syncVisibility: vi.fn(ui.syncVisibility) };
        }),
    };
});

vi.mock('./game-session.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./game-session.js')>();
    return { ...actual, createGameSession: vi.fn(actual.createGameSession) };
});

vi.mock('./share-link-loader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./share-link-loader.js')>();
    return {
        ...actual,
        createShareLinkLoader: vi.fn((deps: Parameters<typeof actual.createShareLinkLoader>[0]) => {
            const loader = actual.createShareLinkLoader(deps);
            return { ...loader, tryLoad: vi.fn(loader.tryLoad) };
        }),
    };
});

// The real zoom waits on `requestAnimationFrame` plus a `transitionend`
// that never fires in jsdom, so the settle callback is captured from the
// mock and invoked by hand — which is also the only way to observe what the
// completion overlay reads *at settle time* rather than at call time.
vi.mock('./viewport-fit.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./viewport-fit.js')>();
    return { ...actual, zoomToFitCompletedPuzzle: vi.fn() };
});

vi.mock('./completion-presenter.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./completion-presenter.js')>();
    return {
        ...actual,
        createCompletionPresenter: vi.fn(
            (deps: Parameters<typeof actual.createCompletionPresenter>[0]) => {
                const presenter = actual.createCompletionPresenter(deps);
                return { ...presenter, show: vi.fn(presenter.show) };
            },
        ),
    };
});

vi.mock('./install-background-color.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./install-background-color.js')>();
    return { ...actual, installBackgroundColor: vi.fn(actual.installBackgroundColor) };
});

vi.mock('./install-toolbar.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./install-toolbar.js')>();
    return { ...actual, installToolbar: vi.fn(actual.installToolbar) };
});

vi.mock('./dev-hooks.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./dev-hooks.js')>();
    return { ...actual, installDevHooks: vi.fn(actual.installDevHooks) };
});

import { installGlobalHandlers } from './global-handlers.js';
import { runBootSequence } from './boot-sequence.js';
import { loadSharedPuzzle } from './load-shared-puzzle.js';
import { createRotationUi } from './rotation-ui.js';
import { createCompletionPresenter } from './completion-presenter.js';
import { zoomToFitCompletedPuzzle } from './viewport-fit.js';
import { createGameSession, type GameSession } from './game-session.js';
import { createShareLinkLoader } from './share-link-loader.js';
import { installBackgroundColor } from './install-background-color.js';
import { installToolbar } from './install-toolbar.js';
import { installDevHooks } from './dev-hooks.js';
// Straight from the module rather than the barrel: the token key is
// deliberately not part of the persistence layer's public surface.
import { STORAGE_KEY, GEOMETRY_SEED_KEY } from '../persistence/storage.js';
import { bootstrap } from './bootstrap.js';

const HOOK_NAMES = [
    '__solvePuzzle',
    '__startVennPuzzle',
    '__newComposableGame',
    '__reproPuzzle',
] as const;

/**
 * Evidence that importing `./bootstrap.js` above did nothing at all.
 *
 * Captured at module-evaluation time rather than asserted inside a test,
 * because `beforeEach`'s `vi.clearAllMocks()` would have erased it by then.
 * A `bootstrap.ts` that ran on import would boot the app the moment any test
 * imported it — the untestability this whole refactor exists to remove.
 */
const atImportTime = {
    globalHandlerCalls: vi.mocked(installGlobalHandlers).mock.calls.length,
    puzzleTables: document.querySelectorAll('[data-puzzle-table]').length,
};

/** The rotation UI `bootstrap` built, with `syncVisibility` spied. */
function createdRotationUi(): { syncVisibility: Mock<(state: GameState | undefined) => void> } {
    const result = vi.mocked(createRotationUi).mock.results[0];
    expect(result.type, 'createRotationUi did not return').toBe('return');
    return result.value as unknown as {
        syncVisibility: Mock<(state: GameState | undefined) => void>;
    };
}

/** The completion presenter `bootstrap` built, with `show` spied. */
function createdCompletionPresenter(): { show: Mock<(state: GameState) => void> } {
    const result = vi.mocked(createCompletionPresenter).mock.results[0];
    expect(result.type, 'createCompletionPresenter did not return').toBe('return');
    return result.value as unknown as { show: Mock<(state: GameState) => void> };
}

/**
 * A state whose single group holds every piece — what `checkAndMarkWin`
 * reads as a completed puzzle, so `applyMergeResult` reaches the
 * composition root's completion handler for the real reason.
 */
function makeCompletedState(): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const group: PieceGroup = {
        id: 0,
        pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
        position: { x: 0, y: 0 },
        rotation: 0,
    };
    return makeGameState({ pieces, groups: [group] });
}

/** The session `bootstrap` built — the real one, wrapped by a recording spy. */
function createdSession(): GameSession {
    const result = vi.mocked(createGameSession).mock.results[0];
    expect(result.type, 'createGameSession did not return').toBe('return');
    return result.value;
}

/** The share-link loader `bootstrap` built, with `tryLoad` spied. */
function createdShareLinks(): { tryLoad: Mock<() => Promise<boolean>> } {
    const result = vi.mocked(createShareLinkLoader).mock.results[0];
    expect(result.type, 'createShareLinkLoader did not return').toBe('return');
    return result.value as unknown as { tryLoad: Mock<() => Promise<boolean>> };
}

/** Call order of the first `addEventListener(type, …)` on `window`. */
function windowListenerOrder(spy: MockInstance<typeof window.addEventListener>, type: string): number {
    const index = spy.mock.calls.findIndex((call) => call[0] === type);
    expect(index, `window.addEventListener('${type}', …) was never called`).toBeGreaterThanOrEqual(0);
    return spy.mock.invocationCallOrder[index];
}

describe('bootstrap', () => {
    let root: HTMLElement;
    // Recording pass-throughs, not replacements: they exist so `afterEach` can
    // undo every listener a `bootstrap()` call installs on a shared target.
    // Ten boots into one jsdom would otherwise leave ten `hashchange`
    // listeners plus the save coordinator's `pagehide`/`visibilitychange`
    // pairs behind, making any future test that counts listeners or asserts a
    // global side effect silently order-dependent. (Nothing tracks the
    // `MediaQueryList` listener `onColorSchemeChange` adds: `matchMedia()`
    // returns a fresh object per call, so those cannot accumulate on anything
    // a later test can see.)
    let windowListeners: MockInstance<typeof window.addEventListener>;
    let documentListeners: MockInstance<typeof document.addEventListener>;

    beforeEach(() => {
        localStorage.clear();
        // Clears call records only. The spy-wrapped implementations set via
        // `vi.fn(actual.…)` survive, which is what these tests rely on.
        vi.clearAllMocks();
        root = document.createElement('div');
        document.body.replaceChildren(root);
        windowListeners = vi.spyOn(window, 'addEventListener');
        documentListeners = vi.spyOn(document, 'addEventListener');
    });

    afterEach(() => {
        for (const [type, listener, options] of windowListeners.mock.calls) {
            window.removeEventListener(type, listener, options as EventListenerOptions);
        }
        for (const [type, listener, options] of documentListeners.mock.calls) {
            document.removeEventListener(type, listener, options as EventListenerOptions);
        }
        windowListeners.mockRestore();
        documentListeners.mockRestore();
        for (const name of HOOK_NAMES) {
            delete (window as unknown as Record<string, unknown>)[name];
        }
        localStorage.clear();
        document.body.replaceChildren();
    });

    it('exports a function and runs nothing on import', () => {
        expect(typeof bootstrap).toBe('function');
        expect(atImportTime.globalHandlerCalls, 'installGlobalHandlers ran at import time').toBe(0);
        expect(atImportTime.puzzleTables, 'the renderer initialized at import time').toBe(0);
    });

    it('installs global handlers before starting the boot sequence', () => {
        // Analytics and error tracking have to be up before anything that can
        // throw runs, or the first failure of a session goes unreported.
        bootstrap(root);

        expect(installGlobalHandlers).toHaveBeenCalledWith(root);
        expect(vi.mocked(installGlobalHandlers).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(runBootSequence).mock.invocationCallOrder[0],
        );
    });

    it('creates the rotation UI before the game session', () => {
        bootstrap(root);

        expect(vi.mocked(createRotationUi).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(createGameSession).mock.invocationCallOrder[0],
        );
    });

    it("hands the session's onInstalled the rotation UI's syncVisibility", () => {
        // This is what makes the ordering above a data dependency rather than
        // a convention: `onInstalled` is built from `rotationUi.syncVisibility`
        // read as a bare value, so the rotation UI must already exist when the
        // session is constructed.
        bootstrap(root);

        const { onInstalled } = vi.mocked(createGameSession).mock.calls[0][0];
        const state = makeGameState();
        onInstalled(state);

        expect(createdRotationUi().syncVisibility).toHaveBeenCalledWith(state);
    });

    it('registers the hashchange listener after kicking off the boot sequence', () => {
        // Boot runs synchronously up to its first await, so this order is
        // observable: registering the listener first would let a hashchange
        // that lands during boot race the boot flow's own share-link read.
        bootstrap(root);

        expect(windowListenerOrder(windowListeners, 'hashchange')).toBeGreaterThan(
            vi.mocked(runBootSequence).mock.invocationCallOrder[0],
        );
    });

    it('routes a later hashchange through the share-link loader', () => {
        // A `#p=` link pasted into an already-open tab changes the hash but
        // triggers no reload, so without this listener nothing reacts. The
        // loader handles it — not a second boot sequence.
        bootstrap(root);
        const { tryLoad } = createdShareLinks();
        vi.mocked(runBootSequence).mockClear();
        expect(tryLoad).not.toHaveBeenCalled();

        window.dispatchEvent(new Event('hashchange'));

        expect(tryLoad).toHaveBeenCalledTimes(1);
        expect(runBootSequence).not.toHaveBeenCalled();
    });

    it('installs cross-tab invalidation of the geometry-ownership token', () => {
        // Nothing else re-derives the token while the app is running, so if
        // this is not wired the app trusts a token another tab has already
        // invalidated — which is #404's torn save, the thing the #490 fast
        // path is not allowed to give back. Asserted through the behavior
        // rather than "addEventListener was called", so it stays honest if
        // the listener moves.
        bootstrap(root);
        localStorage.setItem(GEOMETRY_SEED_KEY, '5');

        window.dispatchEvent(
            new StorageEvent('storage', {
                key: STORAGE_KEY,
                newValue: '{}',
                storageArea: localStorage,
            }),
        );

        expect(localStorage.getItem(GEOMETRY_SEED_KEY)).toBeNull();
    });

    it('installs geometry-token invalidation before boot is kicked off', () => {
        // Not about this tab's own writes — storage events never fire in the
        // window that made the change. About another tab's: a storage event
        // reaches only a document that is already listening, and is never
        // replayed, so every turn of the event loop that precedes the install
        // is a turn whose cross-tab geometry writes are lost. `bootstrap` is
        // synchronous down to `runBootSequence`, so no turn passes today —
        // this is what holds if a statement above it ever gains an `await`.
        bootstrap(root);

        expect(windowListenerOrder(windowListeners, 'storage')).toBeLessThan(
            vi.mocked(runBootSequence).mock.invocationCallOrder[0],
        );
    });

    it('passes one and the same solve reference to the dev hooks and the toolbar', () => {
        // `window.__solvePuzzle` and the info modal's Solve button are the
        // same action. Binding it once here is what stops a later edit to one
        // call site from silently desynchronizing them.
        bootstrap(root);

        const devSolve = vi.mocked(installDevHooks).mock.calls[0][0].solve;
        const toolbarSolve = vi.mocked(installToolbar).mock.calls[0][0].solve;
        expect(typeof devSolve).toBe('function');
        expect(devSolve).toBe(toolbarSolve);
    });

    it('keeps the background-color control between deselect and Info', () => {
        // Every one of these controls is absolutely positioned in one visual
        // top-to-bottom stack, so DOM order alone sets keyboard tab order
        // (WCAG 2.4.3). `install-toolbar.test.ts` pins the full seven-element
        // order; this checks the DOM `bootstrap` actually builds.
        bootstrap(root);

        const classNames = [...root.children].map((el) => el.className);
        const deselect = classNames.indexOf('deselect-button');
        const picker = classNames.indexOf('bg-color-button');
        const info = classNames.indexOf('info-button');
        expect(deselect, 'deselect button').toBeGreaterThanOrEqual(0);
        expect(picker, 'background-color button').toBeGreaterThan(deselect);
        expect(info, 'info button').toBeGreaterThan(picker);
    });

    it('hands the background-color handle to the share-link load path', () => {
        // The handle only exists once `installToolbar` has invoked
        // `installBackgroundColorControl`, so the shared-puzzle deps have to
        // be built after that call. An `undefined` handle here would silently
        // stop a sharer's color ever being offered to a recipient — and
        // `objectContaining({ backgroundColor: undefined })` matches an absent
        // key, so the handle has to be asserted present before it is compared.
        bootstrap(root);
        const installed = vi.mocked(installBackgroundColor).mock.results[0];
        expect(installed.type, 'installBackgroundColor did not return').toBe('return');
        const control = installed.value;
        expect(control, 'no background-color handle to hand over').toBeDefined();

        const { loadShared } = vi.mocked(installDevHooks).mock.calls[0][0];
        void loadShared({} as SharePayload, false);

        expect(loadSharedPuzzle).toHaveBeenCalledWith(
            {},
            false,
            expect.objectContaining({ backgroundColor: control }),
            'repro',
        );
    });

    // #512: the two `loadSharedPuzzle` bindings must not converge on the
    // same `source` — a real recipient's link has to stay distinguishable
    // from a developer's `__reproPuzzle` replay of a known-bad puzzle, or
    // the latter would inflate the `piece-count-mismatch` incident count.
    // The dev-hooks binding above is asserted 'repro'; this pins the
    // share-link binding at the *default* ('shared', the 4th argument
    // omitted entirely) rather than merely "not 'repro'", so a future edit
    // that starts passing 'repro' here too — or anything else — fails this
    // assertion.
    it('leaves the real share-link binding at the default source', () => {
        bootstrap(root);
        const { loadShared } = vi.mocked(createShareLinkLoader).mock.calls[0][0];
        void loadShared({} as SharePayload, false);

        expect(loadSharedPuzzle).toHaveBeenCalledWith(
            {},
            false,
            expect.anything(),
        );
    });

    it('reads the session late before showing the completion overlay', () => {
        // The celebratory zoom lands up to ~1000ms after the win, so `main.ts` read
        // its `gameState` global inside the settle callback rather than
        // capturing it: by then a new game may have replaced the finished
        // one, and the overlay's "Challenge a friend" link is built from
        // whatever state it is handed. Nothing installed — which is all this
        // bootstrap has, since no game was ever installed here — means no
        // overlay at all. Capturing the completed state instead would show it.
        bootstrap(root);
        const { applyMerge } = vi.mocked(createGameSession).mock.calls[0][0];
        const completed = makeCompletedState();

        applyMerge(completed, { group: completed.groups[0], mergeCount: 1 } satisfies MergeResult, [0]);

        const [, , , onSettled] = vi.mocked(zoomToFitCompletedPuzzle).mock.calls[0];
        onSettled();

        expect(createdCompletionPresenter().show).not.toHaveBeenCalled();
    });

    it('shows the completion overlay for the game installed when the zoom settles', () => {
        // The counterpart to the test above: reading the session late is only
        // half the contract, and a `bootstrap` that never showed the overlay
        // at all would satisfy that half. This is the app's payoff moment —
        // the win screen and its "Challenge a friend" link — so the positive
        // direction is pinned too, with a real game installed through the
        // session rather than a hand-rolled stand-in.
        bootstrap(root);
        const session = createdSession();
        const completed = makeCompletedState();
        session.install(completed);

        const { applyMerge } = vi.mocked(createGameSession).mock.calls[0][0];
        applyMerge(completed, { group: completed.groups[0], mergeCount: 1 } satisfies MergeResult, [0]);

        const [, , , onSettled] = vi.mocked(zoomToFitCompletedPuzzle).mock.calls[0];
        onSettled();

        // Asserted against what the session reports rather than the local
        // `completed`, so the pair reads as "the overlay gets the game that
        // is still installed"; the `toBe` first keeps that from degenerating
        // into a comparison of two `undefined`s if nothing installed.
        expect(session.current(), 'nothing installed to celebrate').toBe(completed);
        expect(createdCompletionPresenter().show).toHaveBeenCalledTimes(1);
        expect(createdCompletionPresenter().show).toHaveBeenCalledWith(session.current());
    });

    it('skips the completion overlay when a fresh game is installed by the time the zoom settles', () => {
        // Reading the session late is not enough on its own: the settle has
        // no cancel handle, so a win followed by a New Game inside the ~1s
        // zoom still lands, and "something is installed" is true — of the
        // *fresh* puzzle. Showing the win screen over it would hand the
        // player a "Challenge a friend" link to a puzzle they never
        // finished, which is the exact failure the late read exists to
        // prevent. Identity with the game that was zoomed for is the
        // discriminator.
        bootstrap(root);
        const session = createdSession();
        const completed = makeCompletedState();
        session.install(completed);

        const { applyMerge } = vi.mocked(createGameSession).mock.calls[0][0];
        applyMerge(completed, { group: completed.groups[0], mergeCount: 1 } satisfies MergeResult, [0]);

        // The player starts a new puzzle while the completion zoom is still
        // running. `makeCompletedState` is un-won until `applyMerge` marks
        // it, so a second one stands in for any fresh game.
        const fresh = makeCompletedState();
        session.install(fresh);
        expect(fresh, 'a fresh game must be a different object').not.toBe(completed);
        expect(fresh.completed, 'the stand-in fresh game must be unfinished').toBe(false);

        const [, , , onSettled] = vi.mocked(zoomToFitCompletedPuzzle).mock.calls[0];
        onSettled();

        expect(createdCompletionPresenter().show).not.toHaveBeenCalled();
    });

    it('skips the completion overlay when the game installed at settle time is a different finished one', () => {
        // Why identity rather than "the installed game is finished": that
        // weaker test passes here, and showing this zoom's win screen for a
        // puzzle it was never framing is the same wrong-link defect one step
        // along. The debug Solve hook is the only route in: it can finish a
        // second puzzle inside the ~1s window, bringing its own zoom and its
        // own overlay. No production path installs a finished game there —
        // `boot-sequence.ts` is the sole installer of a restored save and
        // runs once, before any puzzle exists to complete, while the fresh
        // and share-link routes both install `completed: false`.
        bootstrap(root);
        const session = createdSession();
        const completed = makeCompletedState();
        session.install(completed);

        const { applyMerge } = vi.mocked(createGameSession).mock.calls[0][0];
        applyMerge(completed, { group: completed.groups[0], mergeCount: 1 } satisfies MergeResult, [0]);

        const otherFinished = makeCompletedState();
        otherFinished.completed = true;
        session.install(otherFinished);

        // Installing a finished game opens its *own* overlay, from the
        // install path — that is not what is under test, so the settle is
        // measured against the count it inherits rather than against zero.
        const beforeSettle = createdCompletionPresenter().show.mock.calls.length;
        expect(beforeSettle, 'the installed finished game shows its own overlay').toBe(1);

        const [, , , onSettled] = vi.mocked(zoomToFitCompletedPuzzle).mock.calls[0];
        onSettled();

        expect(createdCompletionPresenter().show).toHaveBeenCalledTimes(beforeSettle);
    });

    it('renders the toolbar into the given root', () => {
        bootstrap(root);

        expect(root.querySelector('.new-game-button')).not.toBeNull();
        expect(root.querySelector('.info-button')).not.toBeNull();
    });

    it('falls back to #app when no root is given', () => {
        // The default argument is evaluated at call time, which is what keeps
        // `main.ts` free of a DOM lookup while leaving this module importable.
        const app = document.createElement('div');
        app.id = 'app';
        document.body.replaceChildren(app);

        expect(() => bootstrap()).not.toThrow();

        expect(installGlobalHandlers).toHaveBeenCalledWith(app);
        expect(app.querySelector('.new-game-button')).not.toBeNull();
    });
});
