/**
 * Owns *which* game is currently installed: the reference to its `GameState`
 * and the teardown handle for the interaction wiring bound to it.
 *
 * The reference, not the state. {@link GameSession.current} hands out the
 * live object and callers mutate it in place — `merge-result.ts` flips
 * `completed`, `viewport-fit.ts` rewrites the completed group's transform,
 * `dev-hooks.ts` swaps the group indexes wholesale. The largest of them is
 * the one this module wires itself: `install` passes `liveState` in as the
 * interaction layer's `getState`, and every frame of a drag or a rotate
 * writes straight through it into that state's groups. That is exactly what
 * the `gameState` module global allowed and is kept deliberately: a session
 * that copied or froze the state would change what every one of those call
 * sites does. What this module does enforce is when the reference changes
 * and what `hasGame()` means while it is changing.
 *
 * These were two module-level `let`s in `main.ts` that roughly twenty-five
 * closures read directly, which is what blocked every previous attempt to
 * break that file up. Two properties of the pair are load-bearing and are
 * enforced here rather than described in a comment:
 *
 *  - {@link GameSession.current} returns `GameState | undefined`. The app has
 *    a genuine no-game state — boot can fail and install nothing (#488) — and
 *    the old non-optional declaration hid it, so every consumer rediscovered
 *    it by hand. The optional type makes the compiler ask each call site what
 *    it wants to do with nothing installed (#501).
 *  - {@link GameSession.hasGame} is false until interaction is wired. See
 *    {@link createGameSession}'s `install` for why, and
 *    `game-session.test.ts` for the tests that hold it in place.
 */

import type { GameState } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import { processDrop } from '../game/index.js';
import { reorderGroupsAfterDrop } from '../game/z-order.js';
import { setupInteraction } from '../interaction/index.js';
import type { RotationFocus, ViewportTransform } from '../interaction/index.js';
import type { SelectionManager } from '../interaction/selection-manager.js';
import type { Renderer } from '../renderer/index.js';
import { diagnostics } from '../diagnostics.js';
import { activeSnapTolerances } from './snap-tolerances.js';

/**
 * The installed game, and the only way to *replace* it — mutating the state
 * it hands back stays the caller's business, as it was with the module
 * global. Everything that used to read `gameState` goes through `current()`.
 */
export interface GameSession {
    /**
     * The installed game, or `undefined` when there is none — before the
     * first install, and after a boot that failed to produce one.
     */
    current(): GameState | undefined;
    /**
     * Whether a puzzle is both rendered and interactive. Deliberately
     * stricter than `current() !== undefined`: see `install`.
     */
    hasGame(): boolean;
    install(state: GameState): void;
    restoreSelection(saved: readonly number[]): void;
}

export function createGameSession(deps: {
    container: HTMLElement;
    renderer: Renderer;
    viewportTransform: ViewportTransform;
    selectionManager: SelectionManager;
    rotationFocus: RotationFocus;
    /** Run after the state is installed and rendered, before interaction is wired. */
    onInstalled: (state: GameState) => void;
    /** Debounced progress save. */
    save: (state: GameState) => void;
    applyMerge: (
        state: GameState,
        result: MergeResult,
        droppedGroupIds: readonly number[],
    ) => void;
    /** Push the viewport transform to the renderer and persist it. */
    onViewportChanged: () => void;
    /**
     * Push the viewport transform to the renderer without persisting it.
     * Auto-pan calls this on every frame of an edge drag, which must not
     * restart the debounced save on each tick.
     */
    applyTransform: () => void;
}): GameSession {
    const {
        container,
        renderer,
        viewportTransform,
        selectionManager,
        rotationFocus,
        onInstalled,
        save,
        applyMerge,
        onViewportChanged,
        applyTransform,
    } = deps;

    let installed: GameState | undefined;
    let teardown: (() => void) | null = null;

    return {
        current(): GameState | undefined {
            return installed;
        },

        hasGame(): boolean {
            return teardown !== null;
        },

        install(state: GameState): void {
            // Clears before `installed = state`, so bootstrap's selection
            // listener autosaves the *outgoing* puzzle — a debounced save the
            // new puzzle's save slot then correctly refuses, emitting a
            // spurious `progress-save-skipped`. Pre-existing. Tracked as #514.
            selectionManager.clearAll();
            rotationFocus.clearFocus();

            if (teardown) {
                teardown();
                teardown = null;
            }

            installed = state;
            renderer.renderState(state);
            onInstalled(state);

            // Read late, so every callback below sees whatever is installed
            // when it fires rather than what was installed when it was wired
            // — the behavior of the module-level global these replaced.
            //
            // The `?? state` arm is unreachable: `install` is the only writer
            // of `installed`, and it tears this wiring down before replacing
            // the state, so the wiring's lifetime is exactly the lifetime of
            // `state` being current. It is here to keep the getter total
            // without a non-null assertion, and it names the only state this
            // wiring could ever legitimately be asked about.
            const liveState = (): GameState => installed ?? state;

            // Keep this assignment last, and keep it unconditional: the boot
            // fallback reads `hasGame()` as "a puzzle is rendered and
            // interactive". Moving the assignment earlier, wiring interaction
            // only for some states, or clearing the handle from anywhere but
            // the teardown above silently restores #488's dead-and-silent
            // app. This used to be a comment asking a maintainer not to move
            // a line in a file no test could import; `game-session.test.ts`
            // now enforces it.
            teardown = setupInteraction({
                container,
                renderer,
                viewportTransform,
                getState: liveState,
                onStateChanged: () => {
                    const current = liveState();
                    renderer.renderState(current);
                    // Re-apply selection visuals after re-render (renderState may recreate elements)
                    if (selectionManager.hasSelection) {
                        for (const selectedId of selectionManager.selectedGroupIds) {
                            renderer.setGroupSelected(selectedId, true);
                        }
                    }
                    save(current);
                },
                onDrop: (groupId: number) => {
                    const current = liveState();
                    const { tolerancePx, rotationToleranceDeg } = activeSnapTolerances(current);

                    const droppedGroupIds = [...selectionManager.expandToSelectionIfActive(groupId)];

                    const result = processDrop(groupId, current, tolerancePx, rotationToleranceDeg);
                    if (result) {
                        applyMerge(current, result, droppedGroupIds);
                        save(current);
                    } else {
                        reorderGroupsAfterDrop(
                            droppedGroupIds,
                            current,
                            (gId) => renderer.bringGroupToFront(gId),
                        );
                    }
                },
                getSnapTolerances: () => activeSnapTolerances(liveState()),
                onViewportChanged,
                screenDeltaToWorld: (delta) => viewportTransform.screenDeltaToWorld(delta),
                panViewport: (screenDelta) => {
                    viewportTransform.pan(screenDelta);
                    applyTransform();
                },
                selectionManager,
                rotationFocus,
            });
        },

        /**
         * Called only on the saved-game restore path, right after `install`
         * has put the restored state in place (and cleared any in-memory
         * selection). Group ids are stable across a reload, so the saved ids
         * map back to the same groups; any id that no longer exists
         * (defensive — shouldn't happen on a pure reload) is dropped. When a
         * non-empty selection is restored the multi-select tool is switched
         * on so the selection is visible and draggable, mirroring the state
         * the user left.
         */
        restoreSelection(savedSelection: readonly number[]): void {
            const state = installed;
            // With nothing installed there is nothing to select against, so
            // the whole restore is a no-op — the same answer as an empty
            // saved selection. Not reachable from the boot path, which only
            // restores a selection for a game it just installed.
            if (!state || savedSelection.length === 0) return;

            const validIds = new Set(state.groups.map((g) => g.id));
            const toSelect = savedSelection.filter((id) => validIds.has(id));

            if (toSelect.length < savedSelection.length) {
                // The saved selection comes from the same blob as the restored
                // game, so on a pure reload every id should still exist. A
                // mismatch points at a genuine inconsistency (id-allocation
                // drift, a save/restore ordering bug) worth surfacing in dev
                // rather than dropping silently.
                const dropped = savedSelection.filter((id) => !validIds.has(id));
                diagnostics.warn(
                    'restoreSelection: dropped saved selection id(s) with no matching group',
                    { dropped, liveGroupCount: validIds.size },
                );
            }

            if (toSelect.length === 0) return;

            selectionManager.toolActive = true;
            for (const id of toSelect) {
                selectionManager.select(id);
            }
        },
    };
}
