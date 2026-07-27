/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import { RotationFocus, ViewportTransform } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState, makeCenteredGroup, makeRectPiece } from '../test-helpers/fixtures.js';
import type { RotateButtonsHandle } from '../ui/rotate-buttons.js';
import type { RotateHandleHandle } from '../ui/rotate-handle.js';
import { createRotateButtons, createRotateHandle } from '../ui/index.js';

// `createRotateButtons`/`createRotateHandle` only put anything in the DOM
// once `rotationFocus` already has a focused group (see
// rotate-buttons.test.ts / rotate-handle.test.ts: "starts hidden — no
// buttons exist before show() and focus is set"). Asserting DOM presence
// here would either be vacuously null or require duplicating that focus
// setup, so instead the two factories are replaced with spy handles and
// `syncVisibility` is asserted against `show`/`hide` calls directly — the
// same seam the real code drives.
vi.mock('../ui/index.js', () => ({
    createRotateButtons: vi.fn(() => ({
        show: vi.fn(),
        hide: vi.fn(),
        destroy: vi.fn(),
    })),
    createRotateHandle: vi.fn(() => ({
        show: vi.fn(),
        hide: vi.fn(),
        destroy: vi.fn(),
    })),
}));

import { createRotationUi } from './rotation-ui.js';

/** The button-pair handle most recently produced by the mocked factory. */
function lastButtonsHandle(): RotateButtonsHandle {
    const last = vi.mocked(createRotateButtons).mock.results.at(-1);
    if (!last) throw new Error('createRotateButtons was never called');
    return last.value;
}

/** The drag-handle handle most recently produced by the mocked factory. */
function lastHandleHandle(): RotateHandleHandle {
    const last = vi.mocked(createRotateHandle).mock.results.at(-1);
    if (!last) throw new Error('createRotateHandle was never called');
    return last.value;
}

/**
 * A state with one real, well-formed group (rather than the default empty
 * `groups: []`) so bounds/pivot math has something to actually measure.
 * Group id 9 — deliberately neither 0 nor an array index — so an assertion
 * on a specific id can't pass by coincidence.
 */
function makeStateWithGroup(): GameState {
    const pieces = [makeRectPiece({ id: 0, width: 100, height: 100 })];
    const groups: PieceGroup[] = [makeCenteredGroup(9, 0, { x: 100, y: 100 })];
    return makeGameState({ pieces, groups });
}

describe('createRotationUi', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let viewportTransform: ViewportTransform;
    let selectionManager: SelectionManager;
    let rotationFocus: RotationFocus;
    let state: GameState | undefined;
    // `Mock<...>` (not bare `ReturnType<typeof vi.fn>`, which widens to
    // vi.fn's full generic constraint and stops being assignable to the
    // dep's signature).
    let save: Mock<(state: GameState) => void>;
    let applyMerge: Mock<
        (state: GameState, result: MergeResult, droppedGroupIds: readonly number[]) => void
    >;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.appendChild(container);
        renderer = createFakeRenderer();
        viewportTransform = new ViewportTransform();
        selectionManager = new SelectionManager();
        rotationFocus = new RotationFocus();
        state = makeStateWithGroup();
        save = vi.fn();
        applyMerge = vi.fn();
    });

    afterEach(() => {
        container.remove();
    });

    function make() {
        return createRotationUi({
            container,
            renderer,
            viewportTransform,
            selectionManager,
            rotationFocus,
            getState: () => state,
            save,
            applyMerge,
        });
    }

    describe('syncVisibility', () => {
        it('shows the quarter-turn buttons and hides the free handle', () => {
            const ui = make();
            ui.syncVisibility(makeGameState({ rotationMode: 'quarter-turn' }));

            expect(lastButtonsHandle().show).toHaveBeenCalledTimes(1);
            expect(lastButtonsHandle().hide).not.toHaveBeenCalled();
            expect(lastHandleHandle().hide).toHaveBeenCalledTimes(1);
            expect(lastHandleHandle().show).not.toHaveBeenCalled();
        });

        it('shows the free-rotate handle and hides the quarter-turn buttons', () => {
            const ui = make();
            ui.syncVisibility(makeGameState({ rotationMode: 'free' }));

            expect(lastHandleHandle().show).toHaveBeenCalledTimes(1);
            expect(lastHandleHandle().hide).not.toHaveBeenCalled();
            expect(lastButtonsHandle().hide).toHaveBeenCalledTimes(1);
            expect(lastButtonsHandle().show).not.toHaveBeenCalled();
        });

        it('hides both controls for a state with no rotation mode', () => {
            const ui = make();
            // `rotationMode` is optional; `makeGameState()` leaves it unset.
            ui.syncVisibility(makeGameState());

            expect(lastButtonsHandle().hide).toHaveBeenCalledTimes(1);
            expect(lastButtonsHandle().show).not.toHaveBeenCalled();
            expect(lastHandleHandle().hide).toHaveBeenCalledTimes(1);
            expect(lastHandleHandle().show).not.toHaveBeenCalled();
        });

        it('tolerates being asked to sync with no game, hiding both controls', () => {
            // Boot can leave no game behind; syncing must not throw, and must
            // hide rather than leave whatever was showing before.
            const ui = make();
            expect(() => ui.syncVisibility(undefined)).not.toThrow();

            expect(lastButtonsHandle().hide).toHaveBeenCalledTimes(1);
            expect(lastHandleHandle().hide).toHaveBeenCalledTimes(1);
        });

        it('survives being called detached from the returned object', () => {
            // The composition root passes `rotationUi.syncVisibility` as a bare
            // value into the session's `onInstalled` — no wrapper, no `.bind`.
            // If the implementation ever grew a `this` dependency (e.g. method
            // shorthand on the returned object literal), destructuring it out
            // and calling it standalone would break that at the call site.
            const ui = make();
            const { syncVisibility } = ui;

            syncVisibility(makeGameState({ rotationMode: 'quarter-turn' }));

            expect(lastButtonsHandle().show).toHaveBeenCalledTimes(1);
            expect(lastHandleHandle().hide).toHaveBeenCalledTimes(1);
        });
    });

    describe('getFocusedGroupScreenBounds', () => {
        it('returns null for a group that is gone', () => {
            const ui = make();
            expect(ui.getFocusedGroupScreenBounds(4242)).toBeNull();
        });

        it('returns null when there is no game at all', () => {
            const ui = make();
            state = undefined;
            expect(ui.getFocusedGroupScreenBounds(9)).toBeNull();
        });

        it('projects a live group into screen space', () => {
            const ui = make();
            const bounds = ui.getFocusedGroupScreenBounds(9);

            expect(bounds).not.toBeNull();
            // Identity viewport transform (scale 1, offset 0,0): world bounds
            // pass through as screen bounds unchanged, so this pins the exact
            // numbers rather than just "some finite box" — a group centered at
            // (100, 100) with a 100x100 piece spans (50,50)-(150,150).
            expect(bounds).toEqual({ left: 50, top: 50, right: 150, bottom: 150 });
        });
    });
});
