/**
 * The floating rotation controls: the quarter-turn button pair, the
 * free-rotation drag handle, and the plumbing shared between them — a snap
 * proximity controller for the drag gesture and a screen-space bounds
 * projector both read.
 *
 * Bundled together because they share almost everything: both controls
 * float next to whichever group has rotate focus, both rotate the same way
 * (`rotateGroup` + re-render + re-apply selection visuals), and both commit
 * through the same merge-detection path. Only which pair is visible depends
 * on the game's `rotationMode`.
 */

import type { GameState } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import type { Renderer } from '../renderer/index.js';
import type { ViewportTransform, RotationFocus } from '../interaction/index.js';
import type { SelectionManager } from '../interaction/selection-manager.js';
import { createRotateButtons, createRotateHandle } from '../ui/index.js';
import { SnapProximityPositionController } from '../interaction/snap-proximity-position-controller.js';
import { rotateGroup } from '../game/rotate-group.js';
import { getGroupLocalBounds, getGroupVisualBounds, processDrop } from '../game/index.js';
import { localToWorld } from '../model/helpers.js';
import { activeSnapTolerances } from './snap-tolerances.js';

/**
 * The rotation UI's public surface: syncing which control is visible, and
 * projecting a group's bounds into screen space (also handed to the two
 * controls themselves, so `main.ts` needs neither).
 */
export interface RotationUi {
    /** Show the controls matching `state.rotationMode`, hiding the others. */
    syncVisibility: (state: GameState | undefined) => void;
    /** Project the focused group's visual bounds into screen space. */
    getFocusedGroupScreenBounds: (
        groupId: number,
    ) => { left: number; right: number; top: number; bottom: number } | null;
}

/**
 * Create the rotation UI.
 *
 * Returns an object literal of closures rather than a class instance so
 * `syncVisibility` can be handed to a caller as a bare value — no `.bind`,
 * no wrapper arrow — and still work. The composition root passes it into
 * the game session's `onInstalled` hook, which makes "the rotation UI must
 * exist before the session" a data dependency the compiler enforces, rather
 * than an ordering that only happens to hold because of where two `const`s
 * sit in a file.
 */
export function createRotationUi(deps: {
    container: HTMLElement;
    renderer: Renderer;
    viewportTransform: ViewportTransform;
    selectionManager: SelectionManager;
    rotationFocus: RotationFocus;
    getState: () => GameState | undefined;
    save: (state: GameState) => void;
    applyMerge: (
        state: GameState,
        result: MergeResult,
        droppedGroupIds: readonly number[],
    ) => void;
}): RotationUi {
    const {
        container,
        renderer,
        viewportTransform,
        selectionManager,
        rotationFocus,
        getState,
        save,
        applyMerge,
    } = deps;

    /**
     * Project the visual bounds of the given group from world space into
     * screen space, using the current viewport transform. Returns `null` if
     * the group is no longer in the game state, or there is no game at all.
     */
    function getFocusedGroupScreenBounds(
        groupId: number,
    ): { left: number; right: number; top: number; bottom: number } | null {
        const state = getState();
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

    // Set up the rotate buttons (bottom-left, fractal-only).
    // Visibility is updated whenever a game is installed.
    const rotateButtons = createRotateButtons({
        container,
        rotationFocus,
        onRotate: (groupId, direction) => {
            const state = getState();
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
            save(state);
        },
        getFocusedGroupScreenBounds,
    });

    const snapPosition = new SnapProximityPositionController({
        getState,
        getTolerances: activeSnapTolerances,
    });

    const rotateHandle = createRotateHandle({
        container,
        rotationFocus,
        onRotateStart: (groupId) => {
            if (!getState()) return;
            snapPosition.start(groupId);
        },
        onRotate: (groupId, deltaDegrees) => {
            const state = getState();
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
            const state = getState();
            if (!state) return;

            const { tolerancePx, rotationToleranceDeg } = activeSnapTolerances(state);

            const result = processDrop(groupId, state, tolerancePx, rotationToleranceDeg);
            if (result) {
                applyMerge(state, result, [result.group.id]);
            }
            save(state);
        },
        onRotateEnd: () => {
            snapPosition.stop();
        },
        getFocusedGroupScreenBounds,
        getGroupRotation: (groupId) => getState()?.groupsById.get(groupId)?.rotation ?? null,
        getGroupPivotWorld: (groupId) => {
            const state = getState();
            if (!state) return null;
            const group = state.groupsById.get(groupId);
            if (!group) return null;
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

    /** Show the controls matching `state.rotationMode`, hiding the others. */
    function syncVisibility(state: GameState | undefined): void {
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

    return {
        syncVisibility,
        getFocusedGroupScreenBounds,
    };
}
