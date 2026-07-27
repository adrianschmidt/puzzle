/**
 * The single post-merge follow-up sequence: selection, rotate-handle focus,
 * rendering, z-order, and win detection all need to react the same way
 * whenever pieces settle into a merged group, regardless of which gesture
 * (drag drop or rotate-handle commit) produced the merge.
 */

import type { GameState } from '../model/types.js';
import type { MergeResult } from '../game/group-merging.js';
import { checkAndMarkWin } from '../game/index.js';
import { reorderGroupsAfterDrop } from '../game/z-order.js';
import { track } from '../analytics/index.js';
import type { NewGameData } from '../analytics/index.js';
import { buildPuzzleCompletedData } from './completed-payload.js';
import type { Renderer } from '../renderer/index.js';
import type { SelectionManager } from '../interaction/selection-manager.js';
import type { RotationFocus } from '../interaction/index.js';

/**
 * Prune the selection and rotate-handle focus of any group `result` just
 * absorbed, re-render, refresh z-order, and check for a win.
 *
 * `droppedGroupIds` is the caller-supplied list of groups whose z-order
 * should be refreshed; absorbed IDs are remapped to the surviving merged
 * group. Drag flows pass the multi-select expansion; rotate-handle
 * commits pass just the result group.
 *
 * On completion this hands off to `deps.onCompleted` rather than deciding
 * between the celebratory zoom and the bare overlay itself — that choice
 * (including the "shouldn't happen" fallback for a stray group count)
 * belongs to the caller, which is the thing that owns the viewport.
 */
export function applyMergeResult(
    state: GameState,
    result: MergeResult,
    droppedGroupIds: readonly number[],
    deps: {
        renderer: Renderer;
        selectionManager: SelectionManager;
        rotationFocus: RotationFocus;
        /** Cached new-game analytics, for the completion payload. */
        currentGameAnalytics: () => NewGameData | null;
        /** Frame and celebrate a completed puzzle. */
        onCompleted: (state: GameState) => void;
    },
): void {
    const { renderer, selectionManager, rotationFocus, currentGameAnalytics, onCompleted } = deps;

    // Prune absorbed groups from selection. The surviving merged group
    // inherits selection if any absorbed group was selected.
    const validIds = new Set(state.groups.map(g => g.id));
    const hadSelectedAbsorbed = [...selectionManager.selectedGroupIds]
        .some(id => !validIds.has(id));
    selectionManager.pruneStale(validIds);
    if (hadSelectedAbsorbed) {
        selectionManager.select(result.group.id);
    }

    // If the rotate-handle's anchor group was absorbed (free-rotation
    // commit-merge), retarget focus to the survivor — otherwise the
    // handle stays anchored to a now-deleted group until the idle timer
    // expires, and the next pointerdown silently no-ops.
    const focused = rotationFocus.focusedGroupId;
    if (focused !== null && !validIds.has(focused)) {
        rotationFocus.setFocus(result.group.id);
    }

    renderer.renderState(state);
    renderer.flashMergePulse(result.group.id);
    for (const selectedId of selectionManager.selectedGroupIds) {
        renderer.setGroupSelected(selectedId, true);
    }

    // Remap absorbed IDs from the caller-supplied list to the surviving
    // merged group so every entry still names a real group.
    const remapped = droppedGroupIds.map(id =>
        state.groups.some(g => g.id === id) ? id : result.group.id,
    );
    const unique = [...new Set(remapped)];
    reorderGroupsAfterDrop(unique, state, (gId) => renderer.bringGroupToFront(gId));

    if (checkAndMarkWin(state)) {
        track('puzzle-completed', buildPuzzleCompletedData(state, currentGameAnalytics()));
        onCompleted(state);
    }
}
