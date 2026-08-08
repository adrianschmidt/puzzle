/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import { RotationFocus, ViewportTransform, setupInteraction } from '../interaction/index.js';
import type { InteractionSetupOptions } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import {
    makeGameState,
    makeCenteredGroup,
    makeMatedPiecePair,
    makeRectPiece,
} from '../test-helpers/fixtures.js';
import { activeSnapTolerances } from './snap-tolerances.js';
import { createGameSession, type GameSession } from './game-session.js';

// Plain `vi.spyOn` can't intercept the call `game-session.ts` makes to a
// function imported from another module under Vite; wrap the real
// implementation via `vi.mock` passthrough so the tests below can inspect
// the options object `install` built, while every other test still gets
// real interaction wiring (which the teardown test depends on).
vi.mock('../interaction/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../interaction/index.js')>();
    return {
        ...actual,
        setupInteraction: vi.fn(actual.setupInteraction),
    };
});

function lastInteractionOptions(): InteractionSetupOptions {
    const last = vi.mocked(setupInteraction).mock.calls.at(-1);
    if (!last) throw new Error('setupInteraction was never called');
    return last[0];
}

/**
 * A state with two real, well-formed groups (rather than the default empty
 * `groups: []`), so selection restore has ids to match and the interaction
 * wiring has something to reach for.
 *
 * The group ids are 7 and 8 — deliberately neither 0 nor the array indexes —
 * so a test asserting on a specific id cannot pass by coincidence.
 */
function makeState(): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const groups: PieceGroup[] = [
        makeCenteredGroup(7, 0, { x: 100, y: 100 }),
        makeCenteredGroup(8, 1, { x: 500, y: 500 }),
    ];
    return makeGameState({ pieces, groups });
}

describe('createGameSession', () => {
    let container: HTMLElement;
    let renderer: FakeRenderer;
    let viewportTransform: ViewportTransform;
    let selectionManager: SelectionManager;
    let rotationFocus: RotationFocus;
    // `Mock<(state: GameState) => void>` rather than bare
    // `ReturnType<typeof vi.fn>`: the latter widens to vi.fn's full generic
    // constraint and stops being assignable to the dep's signature.
    let onInstalled: Mock<(state: GameState) => void>;
    let save: Mock<(state: GameState) => void>;
    let applyMerge: Mock<
        (state: GameState, result: MergeResult, droppedGroupIds: readonly number[]) => void
    >;
    let applyTransform: Mock<() => void>;
    let onViewportChanged: Mock<() => void>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        renderer = createFakeRenderer();
        viewportTransform = new ViewportTransform();
        selectionManager = new SelectionManager();
        rotationFocus = new RotationFocus();
        onInstalled = vi.fn();
        save = vi.fn();
        applyMerge = vi.fn();
        applyTransform = vi.fn();
        onViewportChanged = vi.fn();
        vi.mocked(setupInteraction).mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
    });

    function make(overrides: Partial<Parameters<typeof createGameSession>[0]> = {}): GameSession {
        return createGameSession({
            container,
            renderer,
            viewportTransform,
            selectionManager,
            rotationFocus,
            onInstalled,
            save,
            applyMerge,
            applyTransform,
            onViewportChanged,
            ...overrides,
        });
    }

    it('reports no game before anything is installed', () => {
        const session = make();
        expect(session.current()).toBeUndefined();
        expect(session.hasGame()).toBe(false);
    });

    it('exposes the installed state', () => {
        const session = make();
        const state = makeState();
        session.install(state);
        expect(session.current()).toBe(state);
        expect(session.hasGame()).toBe(true);
    });

    it('keeps hasGame false until interaction is wired', () => {
        // #488: the boot fallback reads hasGame as "a puzzle is rendered AND
        // interactive". A throw between the state assignment and interaction
        // setup must still report no game, or the fallback is skipped and the
        // player is left with a dead canvas and no message.
        //
        // `onInstalled` runs inside exactly that window, so it is the probe.
        // The session reference reaches it through a holder because the
        // callback has to interrogate the very session it is being passed to.
        const holder: { session?: GameSession } = {};
        let hasGameDuringInstall: boolean | undefined;
        let stateDuringInstall: GameState | undefined;

        holder.session = make({
            onInstalled: () => {
                hasGameDuringInstall = holder.session?.hasGame();
                stateDuringInstall = holder.session?.current();
            },
        });
        const state = makeState();
        holder.session.install(state);

        // Not `toBeFalsy()`: `undefined` (onInstalled never ran) must fail.
        expect(hasGameDuringInstall).toBe(false);
        // The state is already installed at this point — proving the probe
        // really did run inside the window, rather than before it.
        expect(stateDuringInstall).toBe(state);
        expect(holder.session.hasGame()).toBe(true);
    });

    it('still reports no game when rendering throws mid-install', () => {
        const session = make();
        renderer.renderState.mockImplementationOnce(() => {
            throw new Error('render boom');
        });

        expect(() => session.install(makeState())).toThrow('render boom');
        expect(session.hasGame()).toBe(false);
    });

    it('still reports no game when onInstalled throws mid-install', () => {
        // The other half of the #488 window: a throw after the render but
        // before the wiring must not look like a live game either.
        const session = make({
            onInstalled: () => {
                throw new Error('presenter boom');
            },
        });

        expect(() => session.install(makeState())).toThrow('presenter boom');
        expect(session.hasGame()).toBe(false);
    });

    it('wires interaction for an already-completed state too', () => {
        // The wiring must be unconditional. A restored save of a solved
        // puzzle is the state most likely to tempt a "nothing to drag here"
        // shortcut, and it is still draggable — the player can pull the
        // finished picture apart.
        const session = make();
        session.install(makeGameState({ ...makeState(), completed: true }));
        expect(session.hasGame()).toBe(true);
    });

    it('renders the state and runs onInstalled', () => {
        const session = make();
        const state = makeState();
        session.install(state);
        expect(renderer.renderState).toHaveBeenCalledWith(state);
        expect(onInstalled).toHaveBeenCalledWith(state);
    });

    it('clears selection and rotation focus when a new game replaces an old one', () => {
        const session = make();
        session.install(makeState());
        selectionManager.toolActive = true;
        selectionManager.select(7);
        rotationFocus.setFocus(7);

        session.install(makeState());

        expect(selectionManager.hasSelection).toBe(false);
        expect(rotationFocus.focusedGroupId).toBeNull();
    });

    it('tears down the previous interaction before wiring the next', () => {
        // Without this, every new game leaves another live pointer router on
        // the container and a single drag fires each of them.
        const add = vi.spyOn(container, 'addEventListener');
        const remove = vi.spyOn(container, 'removeEventListener');
        const session = make();

        session.install(makeState());
        const wiredByFirst = add.mock.calls.map(([type, listener]) => [type, listener]);
        expect(wiredByFirst.length).toBeGreaterThan(0);
        expect(remove).not.toHaveBeenCalled();

        session.install(makeState());

        // Same handler identities, same order: the first install's listeners
        // specifically were removed, not some arbitrary set.
        const unwired = remove.mock.calls.map(([type, listener]) => [type, listener]);
        expect(unwired).toEqual(wiredByFirst);
    });

    it('pans via applyTransform, which must not persist anything', () => {
        // `panViewport` is the auto-pan hook: it fires on every frame of an
        // edge drag. Routing it through `onViewportChanged` — which saves —
        // would restart the debounced save on each tick, so the two hooks
        // are deliberately different deps and must stay that way.
        const session = make();
        session.install(makeState());

        lastInteractionOptions().panViewport?.({ x: 12, y: -4 });

        // The pan really happened, not just the callback.
        expect(viewportTransform.getState().offset).toEqual({ x: 12, y: -4 });
        expect(applyTransform).toHaveBeenCalledTimes(1);
        expect(onViewportChanged).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('routes zoom/pan settle through onViewportChanged, which does persist', () => {
        // The other side of the same split: collapsing the two hooks in
        // either direction has to fail a test.
        const session = make();
        session.install(makeState());

        lastInteractionOptions().onViewportChanged();

        expect(onViewportChanged).toHaveBeenCalledTimes(1);
        expect(applyTransform).not.toHaveBeenCalled();
    });

    describe('the callbacks install wires into the interaction layer', () => {
        /**
         * Two mated pieces near — but deliberately not at — their aligned
         * offset, so the real `processDrop` merges for the real reason:
         * real geometry, and a snap distance only the *active* tolerance
         * admits.
         *
         * The 25px overshoot is what makes the tolerance wiring visible.
         * `activeSnapTolerances` reads the player's preset against this
         * state (the default `normal` preset's 0.333 × the reference piece
         * width of 800/8 = 100, so 33.3px); `processDrop`'s own default is
         * `MERGE_TOLERANCE_PX` = 18. At exact alignment both admit the
         * merge and dropping the arguments at the call site changes
         * nothing; at 25px only the wired-through value does.
         *
         * Group ids 10/11 are neither the array indexes nor `makeState`'s
         * 7/8.
         */
        const SNAP_OVERSHOOT_PX = 25;

        function makeMergeableState(): GameState {
            const { piece0, piece1 } = makeMatedPiecePair();
            return makeGameState({
                pieces: [piece0, piece1],
                groups: [
                    makeCenteredGroup(10, 0, { x: 50, y: 50 }),
                    makeCenteredGroup(11, 1, { x: 150 + SNAP_OVERSHOOT_PX, y: 50 }),
                ],
            });
        }

        it('hands a merging drop to applyMerge and saves the result', () => {
            const session = make();
            const state = makeMergeableState();
            session.install(state);

            lastInteractionOptions().onDrop(11);

            expect(applyMerge).toHaveBeenCalledTimes(1);
            const [mergedState, result, droppedIds] = applyMerge.mock.calls[0];
            expect(mergedState).toBe(state);
            expect(result.mergeCount).toBe(1);
            // The actual dropped ids, not `[]`: `applyMergeResult` drives
            // z-order and post-merge visuals off them, and an empty array
            // reaches every one of those call sites without throwing.
            expect(droppedIds).toEqual([11]);
            // Merging is the one drop outcome that changes the puzzle, and
            // this is the only save on the path — dropping it loses the merge
            // until some unrelated edit happens to persist the state.
            expect(save).toHaveBeenCalledWith(state);
            // …and it saves the merged state, not the pre-merge one:
            // `applyMerge` mutates `state` in place, so swapping the two
            // statements persists a snapshot taken one step too early.
            expect(save.mock.invocationCallOrder[0])
                .toBeGreaterThan(applyMerge.mock.invocationCallOrder[0]);
            // The merge branch and the reorder branch are exclusive.
            expect(renderer.bringGroupToFront).not.toHaveBeenCalled();
        });

        it('merges on the player\'s active tolerance, not processDrop\'s default', () => {
            // The fixture sits 25px past its aligned offset: inside the
            // active tolerance (33.3px for this state and the default
            // preset), outside `processDrop`'s own 18px fallback. So a drop
            // that stopped passing `tolerancePx` through would stop merging.
            const session = make();
            const state = makeMergeableState();
            session.install(state);

            expect(lastInteractionOptions().getSnapTolerances?.().tolerancePx)
                .toBeGreaterThan(SNAP_OVERSHOOT_PX);

            lastInteractionOptions().onDrop(11);

            expect(applyMerge).toHaveBeenCalledTimes(1);
        });

        it('merges on the player\'s active rotation tolerance too', () => {
            // The other half of `activeSnapTolerances`. The dropped group is
            // 15° off its mate: inside the active rotation tolerance (20° for
            // the default preset), outside `processDrop`'s own 10° fallback.
            //
            // Rotation is the *only* thing off, so the position tolerance
            // cannot also decide this case: both groups are placed by bbox
            // center, 100px apart, which is exactly where the mated pair
            // aligns. `measureEdgeAlignment` measures after simulating the
            // rotation snap, and that snap pivots about the piece center —
            // the same point for these single-piece groups — so the residual
            // distance here is ~0 under any tolerance, and
            // only `rotationToleranceDeg` can gate the merge.
            //
            // Placing group 11 by raw `position` instead would not isolate
            // it: at `{100, 0}` the pre-snap center is off by
            // 2·|(50,50)|·sin(7.5°) = 18.46px, which clears the 18px default
            // and makes the case fail on `tolerancePx` too.
            const { piece0, piece1 } = makeMatedPiecePair();
            const state = makeGameState({
                pieces: [piece0, piece1],
                groups: [
                    makeCenteredGroup(10, 0, { x: 50, y: 50 }),
                    makeCenteredGroup(11, 1, { x: 150, y: 50 }, 15),
                ],
            });
            const session = make();
            session.install(state);

            expect(lastInteractionOptions().getSnapTolerances?.().rotationToleranceDeg)
                .toBeGreaterThan(15);

            lastInteractionOptions().onDrop(11);

            expect(applyMerge).toHaveBeenCalledTimes(1);
        });

        it('expands a merging drop to the whole selection', () => {
            // Multi-select drags the selection as a unit, so every selected
            // group was dropped — not just the one under the pointer.
            const session = make();
            const state = makeMergeableState();
            session.install(state);
            selectionManager.toolActive = true;
            selectionManager.select(10);
            selectionManager.select(11);

            lastInteractionOptions().onDrop(11);

            expect(applyMerge).toHaveBeenCalledTimes(1);
            // Dragged group first, per `expandToSelectionIfActive`.
            expect(applyMerge.mock.calls[0][2]).toEqual([11, 10]);
        });

        it('z-reorders the dropped groups when nothing merges', () => {
            // Group 7 is two pieces spanning world (0,0)–(200,100); group 8 is
            // a single 20×20 piece entirely inside it. Dropping the big one
            // has to raise the small one, or it is lost underneath.
            const pieces = [
                makeRectPiece({ id: 0, width: 100, height: 100, col: 0 }),
                makeRectPiece({ id: 1, width: 100, height: 100, col: 1 }),
                makeRectPiece({ id: 2, width: 20, height: 20, col: 0 }),
            ];
            const groups: PieceGroup[] = [
                {
                    id: 7,
                    pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                    position: { x: 0, y: 0 },
                    rotation: 0,
                },
                {
                    id: 8,
                    pieces: new Map([[2, { x: 0, y: 0 }]]),
                    position: { x: 50, y: 40 },
                    rotation: 0,
                },
            ];
            const session = make();
            session.install(makeGameState({ pieces, groups }));
            renderer.bringGroupToFront.mockClear();

            lastInteractionOptions().onDrop(7);

            // `makeRectPiece`'s edges are all borders, so nothing can mate.
            expect(applyMerge).not.toHaveBeenCalled();
            expect(renderer.bringGroupToFront).toHaveBeenCalledWith(8);
        });

        it('z-reorders the whole selection when a multi-select drop does not merge', () => {
            // The mirror of the merge case above: multi-select drags the
            // selection as a unit, so the reorder has to consider every
            // group that moved, not just the one under the pointer. Group 9
            // is dragged and covers nothing; group 7 rides along in the
            // selection and is the only group covering the small group 8.
            // Narrowing the reorder to the dragged group alone loses that.
            const pieces = [
                makeRectPiece({ id: 0, width: 100, height: 100, col: 0 }),
                makeRectPiece({ id: 1, width: 100, height: 100, col: 1 }),
                makeRectPiece({ id: 2, width: 20, height: 20, col: 0 }),
                makeRectPiece({ id: 3, width: 100, height: 100, col: 0 }),
            ];
            const groups: PieceGroup[] = [
                {
                    id: 7,
                    pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 100, y: 0 }]]),
                    position: { x: 0, y: 0 },
                    rotation: 0,
                },
                {
                    id: 8,
                    pieces: new Map([[2, { x: 0, y: 0 }]]),
                    position: { x: 50, y: 40 },
                    rotation: 0,
                },
                // Off on its own, and a single piece — so it covers nothing,
                // and `reorderGroupsAfterDrop` raises nothing for it alone.
                {
                    id: 9,
                    pieces: new Map([[3, { x: 0, y: 0 }]]),
                    position: { x: 1000, y: 1000 },
                    rotation: 0,
                },
            ];
            const session = make();
            session.install(makeGameState({ pieces, groups }));
            selectionManager.toolActive = true;
            selectionManager.select(9);
            selectionManager.select(7);
            renderer.bringGroupToFront.mockClear();

            lastInteractionOptions().onDrop(9);

            expect(applyMerge).not.toHaveBeenCalled();
            expect(renderer.bringGroupToFront).toHaveBeenCalledWith(8);
        });

        it('reports the live state\'s snap tolerances to the interaction layer', () => {
            // `getSnapTolerances` feeds the snap-proximity controllers, which
            // have to agree with the drop-time merge check or a piece glows
            // as if it will snap and then doesn't. Derived from the installed
            // state, not from a constant: the reference piece width is the
            // image width over the column count, so a wider image widens the
            // window.
            const session = make();
            const state = makeGameState({
                ...makeState(),
                imageSize: { width: 1600, height: 600 },
                gridSize: { cols: 8, rows: 6 },
            });
            session.install(state);

            expect(lastInteractionOptions().getSnapTolerances?.())
                .toEqual(activeSnapTolerances(state));
            // Not the same numbers a narrower image would give — otherwise
            // an implementation ignoring the state would also pass.
            expect(lastInteractionOptions().getSnapTolerances?.().tolerancePx)
                .toBeGreaterThan(activeSnapTolerances(makeState()).tolerancePx);
        });

        it('re-renders, re-applies selection visuals and saves on a state change', () => {
            const session = make();
            const state = makeState();
            session.install(state);
            selectionManager.toolActive = true;
            selectionManager.select(7);
            selectionManager.select(8);
            renderer.renderState.mockClear();
            renderer.setGroupSelected.mockClear();

            lastInteractionOptions().onStateChanged();

            expect(renderer.renderState).toHaveBeenCalledWith(state);
            // `renderState` may recreate the elements, so the highlight has to
            // be re-applied for *every* selected group, after the render.
            expect(renderer.setGroupSelected.mock.calls).toEqual([[7, true], [8, true]]);
            // "After" literally: both are no-op spies here, so only the
            // invocation order distinguishes re-applying the highlight from
            // painting it onto elements the render is about to replace.
            expect(renderer.setGroupSelected.mock.invocationCallOrder[0])
                .toBeGreaterThan(renderer.renderState.mock.invocationCallOrder[0]);
            expect(save).toHaveBeenCalledWith(state);
        });

        it('leaves selection visuals alone when nothing is selected', () => {
            const session = make();
            const state = makeState();
            session.install(state);
            renderer.setGroupSelected.mockClear();

            lastInteractionOptions().onStateChanged();

            expect(renderer.setGroupSelected).not.toHaveBeenCalled();
            expect(save).toHaveBeenCalledWith(state);
        });
    });

    it('restores a saved selection and switches the multi-select tool on', () => {
        const session = make();
        session.install(makeState());

        session.restoreSelection([7]);

        expect(selectionManager.toolActive).toBe(true);
        expect(selectionManager.isSelected(7)).toBe(true);
        expect(selectionManager.isSelected(8)).toBe(false);
    });

    it('does nothing for an empty saved selection', () => {
        const session = make();
        session.install(makeState());
        session.restoreSelection([]);
        expect(selectionManager.toolActive).toBe(false);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('drops saved ids with no matching group and warns', () => {
        // Group ids are stable across a reload, so a mismatch points at real
        // inconsistency rather than something to swallow.
        const session = make();
        session.install(makeState());

        session.restoreSelection([7, 4242]);

        expect(selectionManager.isSelected(4242)).toBe(false);
        expect(selectionManager.isSelected(7)).toBe(true);
        expect(console.warn).toHaveBeenCalled();
    });

    it('leaves the tool off when no saved id survives', () => {
        const session = make();
        session.install(makeState());
        session.restoreSelection([4242]);
        expect(selectionManager.toolActive).toBe(false);
        expect(selectionManager.hasSelection).toBe(false);
    });

    it('restores nothing when no game is installed', () => {
        const session = make();
        session.restoreSelection([7]);
        expect(selectionManager.toolActive).toBe(false);
        expect(selectionManager.hasSelection).toBe(false);
    });
});
