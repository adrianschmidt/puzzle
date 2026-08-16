/**
 * Owns *which* game is installed: the reference to its `GameState` and the
 * teardown handle for the interaction wiring bound to it.
 *
 * The reference, not the state. `current()` hands out the live object and
 * callers mutate it in place (merge-result, viewport-fit, dev-hooks, and the
 * interaction layer writing through `getState` every frame). A session that
 * copied or froze the state would change what those call sites do. What this
 * module enforces is when the reference changes and what `hasGame()` means
 * while it changes:
 *
 *  - `current()` returns `GameState | undefined`: boot can fail and install
 *    nothing (#488), and the compiler makes each call site handle that (#501).
 *  - `hasGame()` is false until interaction is wired — see `install`.
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

/** The installed game and the only way to replace it; mutation stays the caller's. */
export interface GameSession {
    /** The installed game, or `undefined` before the first install / after a failed boot. */
    current(): GameState | undefined;
    /** Whether a puzzle is rendered *and* interactive — stricter than `current() !== undefined`; see `install`. */
    hasGame(): boolean;
    install(state: GameState): void;
    /**
     * Undo the last install: tear the interaction wiring down and drop the
     * reference, so `current()` is `undefined` and `hasGame()` is `false`
     * again. A share load that throws after `install` calls this so it leaves
     * no half-applied puzzle for the boot fallback's `hasGame()` gate to read
     * as a finished game (#500).
     */
    uninstall(): void;
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
    /** Drop any pending debounced save (see the ordering note in `install`). */
    cancelPendingSave: () => void;
    applyMerge: (
        state: GameState,
        result: MergeResult,
        droppedGroupIds: readonly number[],
    ) => void;
    /** Push the viewport transform to the renderer and persist it. */
    onViewportChanged: () => void;
    /**
     * Push the viewport transform without persisting it. Auto-pan calls this
     * every frame of an edge drag and must not restart the debounced save.
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
        cancelPendingSave,
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

        uninstall(): void {
            if (teardown) {
                teardown();
                teardown = null;
            }
            installed = undefined;
        },

        install(state: GameState): void {
            // `clearAll` notifies while `installed` is still the outgoing
            // state, so bootstrap's selection listener arms an autosave for it.
            // `cancelPendingSave` drops that save (and any other pending one):
            // the new puzzle is about to take the save slot, so it could only
            // skip (#514). Order matters — cancel must follow the clear, or the
            // save it arms isn't pending yet.
            selectionManager.clearAll();
            rotationFocus.clearFocus();
            cancelPendingSave();

            if (teardown) {
                teardown();
                teardown = null;
            }

            installed = state;
            renderer.renderState(state);
            onInstalled(state);

            // Read late, so every callback sees whatever is installed when it
            // fires, not when it was wired. The `?? state` arm is unreachable
            // (install tears this down before replacing `installed`) — it just
            // keeps the getter total without a non-null assertion.
            const liveState = (): GameState => installed ?? state;

            // Keep this assignment last and unconditional: the boot fallback
            // reads `hasGame()` as "rendered and interactive". Moving it
            // earlier, wiring only some states, or clearing the handle
            // elsewhere restores #488's dead-and-silent app.
            teardown = setupInteraction({
                container,
                renderer,
                viewportTransform,
                getState: liveState,
                onStateChanged: () => {
                    const current = liveState();
                    renderer.renderState(current);
                    // Re-apply selection visuals: renderState may recreate elements.
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
         * Saved-game restore path, right after `install`. Group ids are stable
         * across a reload, so saved ids map back to the same groups; any that
         * no longer exists is dropped. A non-empty restored selection switches
         * the multi-select tool on so it's visible and draggable.
         */
        restoreSelection(savedSelection: readonly number[]): void {
            const state = installed;
            // Nothing installed: no-op, same as an empty selection. Not reached
            // from boot, which only restores for a game it just installed.
            if (!state || savedSelection.length === 0) return;

            const validIds = new Set(state.groups.map((g) => g.id));
            const toSelect = savedSelection.filter((id) => validIds.has(id));

            if (toSelect.length < savedSelection.length) {
                // Same blob as the restored game, so every id should exist on a
                // pure reload; a mismatch is a genuine inconsistency worth a
                // dev warning rather than a silent drop.
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
