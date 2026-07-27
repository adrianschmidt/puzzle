/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { GameState, PieceGroup } from '../model/types.js';
import { SelectionManager } from '../interaction/selection-manager.js';
import { RotationFocus } from '../interaction/index.js';
import { createFakeRenderer, type FakeRenderer } from '../test-helpers/fake-renderer.js';
import { makeGameState, makeCenteredGroup, makeRectPiece } from '../test-helpers/fixtures.js';
import { reorderGroupsAfterDrop } from '../game/z-order.js';
import { applyMergeResult } from './merge-result.js';

// Plain `vi.spyOn` can't intercept a call `merge-result.ts` makes to a
// function imported from another module under Vite; wrap the real
// implementation via `vi.mock` passthrough so the "remaps absorbed ids"
// test can inspect exactly what array reached the reorder, while every
// other test still gets real z-order behavior.
vi.mock('../game/z-order.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../game/z-order.js')>();
    return {
        ...actual,
        reorderGroupsAfterDrop: vi.fn(actual.reorderGroupsAfterDrop),
    };
});

/**
 * Two real, independent single-piece groups (rather than the default empty
 * `groups: []`) so tests have a genuine survivor to merge into and a
 * second group left over — `checkWin` correctly stays false against this
 * state, which matters for tests that must *not* trip completion.
 */
function makeTwoGroupState(): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const groups: PieceGroup[] = [
        makeCenteredGroup(0, 0, { x: 100, y: 100 }),
        makeCenteredGroup(1, 1, { x: 500, y: 500 }),
    ];
    return makeGameState({ pieces, groups });
}

/**
 * A state with a single group holding every piece — the shape
 * `win-detection.test.ts` uses to exercise a genuine win. `checkWin` only
 * checks `groups.length === 1` and `groups[0].pieces.size ===
 * pieces.length`, both true here, so `checkAndMarkWin` passes for the real
 * reason rather than a mocked one.
 */
function makeCompletedState(): GameState {
    const pieces = [
        makeRectPiece({ id: 0, width: 100, height: 100 }),
        makeRectPiece({ id: 1, width: 100, height: 100 }),
    ];
    const group: PieceGroup = {
        id: 0,
        pieces: new Map([
            [0, { x: 0, y: 0 }],
            [1, { x: -100, y: 0 }],
        ]),
        position: { x: 0, y: 0 },
        rotation: 0,
    };
    return makeGameState({ pieces, groups: [group] });
}

describe('applyMergeResult', () => {
    let renderer: FakeRenderer;
    let selectionManager: SelectionManager;
    let rotationFocus: RotationFocus;
    // `Mock<(state: GameState) => void>` rather than bare `ReturnType<typeof
    // vi.fn>`, which widens to vi.fn's full generic constraint and stops
    // being assignable to the deps' `onCompleted` signature.
    let onCompleted: Mock<(state: GameState) => void>;
    let umamiTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        umamiTrack = vi.fn();
        (window as unknown as { umami: { track: typeof umamiTrack } }).umami = { track: umamiTrack };
        renderer = createFakeRenderer();
        selectionManager = new SelectionManager();
        rotationFocus = new RotationFocus();
        onCompleted = vi.fn();
        // The z-order mock is module-scoped (not per-test), so clear its
        // call history — otherwise a later test would see earlier tests'
        // calls to `reorderGroupsAfterDrop` too.
        vi.mocked(reorderGroupsAfterDrop).mockClear();
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    function deps() {
        return {
            renderer,
            selectionManager,
            rotationFocus,
            currentGameAnalytics: () => null,
            onCompleted,
        };
    }

    it('prunes absorbed groups from the selection', () => {
        const state = makeTwoGroupState();
        const survivor = state.groups[0];
        const absorbedId = 999;
        selectionManager.toolActive = true;
        selectionManager.select(absorbedId);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [absorbedId], deps());

        expect(selectionManager.isSelected(absorbedId)).toBe(false);
    });

    it('lets the surviving group inherit selection from an absorbed one', () => {
        const state = makeTwoGroupState();
        const survivor = state.groups[0];
        selectionManager.toolActive = true;
        selectionManager.select(999);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [999], deps());

        expect(selectionManager.isSelected(survivor.id)).toBe(true);
    });

    it('leaves the selection alone when nothing selected was absorbed', () => {
        const state = makeTwoGroupState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(selectionManager.hasSelection).toBe(false);
    });

    it('retargets rotate-handle focus onto the survivor when its anchor was absorbed', () => {
        // Otherwise the handle stays anchored to a deleted group and the next
        // pointerdown silently no-ops until the idle timer expires.
        const state = makeTwoGroupState();
        const survivor = state.groups[0];
        rotationFocus.setFocus(999);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [999], deps());

        expect(rotationFocus.focusedGroupId).toBe(survivor.id);
    });

    it('leaves focus alone when the focused group survived', () => {
        // Focus a *different* still-live group (not the merge survivor) so
        // an "always retarget to the survivor" bug is distinguishable from
        // correct behavior — focusing the survivor itself wouldn't catch
        // that, since `RotationFocus.setFocus` is already a no-op when the
        // target equals the current focus.
        const state = makeTwoGroupState();
        const survivor = state.groups[0];
        const otherGroup = state.groups[1];
        rotationFocus.setFocus(otherGroup.id);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(rotationFocus.focusedGroupId).toBe(otherGroup.id);
    });

    it('re-renders and pulses the merged group', () => {
        const state = makeTwoGroupState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(renderer.renderState).toHaveBeenCalledWith(state);
        expect(renderer.flashMergePulse).toHaveBeenCalledWith(survivor.id);
    });

    it('re-applies the selection highlight for every surviving selected group after the re-render', () => {
        // renderState can recreate the DOM elements a highlight was painted
        // onto, so the re-apply loop only works if it runs strictly after
        // renderState — asserting mere presence wouldn't catch a version
        // that (wrongly) re-applies the highlight before the re-render.
        const state = makeTwoGroupState();
        const survivor = state.groups[0];
        const other = state.groups[1];
        selectionManager.toolActive = true;
        selectionManager.selectMany([survivor.id, other.id]);

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(renderer.setGroupSelected).toHaveBeenCalledWith(survivor.id, true);
        expect(renderer.setGroupSelected).toHaveBeenCalledWith(other.id, true);

        const renderOrder = renderer.renderState.mock.invocationCallOrder[0];
        for (const order of renderer.setGroupSelected.mock.invocationCallOrder) {
            expect(order).toBeGreaterThan(renderOrder);
        }
    });

    it('remaps absorbed ids to the survivor before reordering z-order', () => {
        // Every entry handed to the reorder must name a group that still
        // exists; 999 never existed in `state.groups`, so it must be
        // remapped to the survivor rather than passed through as-is, and
        // the resulting duplicate collapsed.
        const state = makeTwoGroupState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [999, survivor.id], deps());

        expect(vi.mocked(reorderGroupsAfterDrop).mock.calls[0]?.[0]).toEqual([survivor.id]);
    });

    it('reports and celebrates a completed puzzle', () => {
        const state = makeCompletedState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(umamiTrack).toHaveBeenCalledWith('puzzle-completed', expect.any(Object));
        expect(onCompleted).toHaveBeenCalledWith(state);
    });

    it('reports the completion before handing off to the celebration', () => {
        // Order, not just co-occurrence. `onCompleted` runs the celebratory
        // zoom, whose deferred settle then decides whether the win screen is
        // still warranted — and that decision is allowed to be "no". What
        // makes that suppression free of telemetry cost is that the event has
        // already left by then. `onCompleted` also does real work before its
        // `requestAnimationFrame` (DOM queries, the group re-anchor, the
        // `groups.length !== 1` overlay fallback), so under the reverse order
        // a synchronous throw anywhere in it swallows `puzzle-completed` and
        // the funnel silently loses completions. Nothing but this holds the
        // two statements apart.
        const state = makeCompletedState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(umamiTrack.mock.invocationCallOrder[0])
            .toBeLessThan(onCompleted.mock.invocationCallOrder[0]);
    });

    it('does not report completion for an unfinished puzzle', () => {
        const state = makeTwoGroupState();
        const survivor = state.groups[0];

        applyMergeResult(state, { group: survivor, mergeCount: 1 }, [survivor.id], deps());

        expect(umamiTrack).not.toHaveBeenCalled();
        expect(onCompleted).not.toHaveBeenCalled();
    });
});
