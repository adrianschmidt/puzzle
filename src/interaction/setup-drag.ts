/**
 * Wire up the DragController to a Renderer and the DOM container.
 *
 * SPIKE: deferred drag-start. A piece pointerdown only records a
 * "drag candidate"; the drag is started lazily once the pointer
 * moves past the tap-vs-drag threshold. A pointerup with no
 * promotion is classified as a tap (no rollback dance, because
 * nothing was ever started). Used to evaluate the (b)-style
 * pre-classified event model from issue #260 in a preview deploy
 * before committing to a router design.
 *
 * This is the glue between the pure-logic DragController and the
 * browser APIs (pointer capture, DOM events). Separated from the
 * controller to keep it testable.
 */

import type { GameState, Point } from '../model/types.js';
import { moveGroup, findGroupForPiece } from '../model/helpers.js';
import type { Renderer } from '../renderer/types.js';
import { DragController } from './drag-controller.js';
import type { ScreenDeltaToWorld } from './drag-controller.js';
import { AutoPanController } from './auto-pan.js';
import type { SelectionManager } from './selection-manager.js';
import { loadOffsetDragPreference } from '../ui/index.js';

export interface DragSetupOptions {
    /** The DOM container for the puzzle table (receives move/up events). */
    container: HTMLElement;
    /** The renderer to wire pointer events to. */
    renderer: Renderer;
    /** Returns the current game state (must be a live reference). */
    getState: () => GameState;
    /** Called after each state mutation to re-render. */
    onStateChanged: () => void;
    /** Called when a group is dropped (for merge detection). */
    onDrop: (groupId: number) => void;
    /**
     * Convert a screen-space delta to world-space.
     * Needed when a viewport transform (zoom) is active.
     */
    screenDeltaToWorld?: ScreenDeltaToWorld;
    /**
     * Pan the viewport by a screen-space delta.
     * Required for auto-pan when dragging to viewport edges.
     */
    panViewport?: (screenDelta: Point) => void;
    /**
     * Selection manager for multi-select tool.
     * When provided and the tool is active, clicking toggles selection
     * and dragging a selected piece moves all selected groups.
     */
    selectionManager?: SelectionManager;
}

/**
 * Find a group by its id in the game state.
 * Throws if the group is not found.
 */
function findGroup(groupId: number, state: GameState) {
    const group = state.groups.find((g) => g.id === groupId);

    if (!group) {
        throw new Error(`Group ${groupId} not found`);
    }

    return group;
}

/** Minimal subset of PointerEvent fields the promotion path needs. */
type PromotablePointerEvent = Pick<
    PointerEvent,
    'pointerId' | 'clientX' | 'clientY' | 'pointerType'
>;

/**
 * Set up drag handling for the puzzle.
 *
 * Returns a cleanup function that removes all event listeners.
 */
export function setupDragHandling(options: DragSetupOptions): () => void {
    const { container, renderer, getState, onStateChanged, onDrop, screenDeltaToWorld, panViewport, selectionManager } = options;

    const deltaToWorld = screenDeltaToWorld ?? ((d: Point) => d);

    const expandToSelection = (groupId: number): readonly number[] =>
        selectionManager?.expandToSelectionIfActive(groupId) ?? [groupId];

    // Auto-pan controller: pans viewport when dragging near edges
    const autoPan = panViewport
        ? new AutoPanController({
            panViewport,
            moveGroup(groupId: number, worldDelta: Point) {
                // Compensate the dragged group AND every other selected
                // group when the multi-select tool is active.
                for (const id of expandToSelection(groupId)) {
                    const group = getState().groups.find(g => g.id === id);
                    if (group) moveGroup(group, worldDelta);
                }
            },
            screenDeltaToWorld: deltaToWorld,
            requestRender: onStateChanged,
            getViewportSize: () => ({
                width: window.visualViewport?.width ?? window.innerWidth,
                height: window.visualViewport?.height ?? window.innerHeight,
            }),
        })
        : null;

    const controller = new DragController(
        () => getState().groups,
        {
            moveGroup(groupId: number, delta: Point) {
                // Move the dragged group AND every other selected group
                // when the multi-select tool is active.
                for (const id of expandToSelection(groupId)) {
                    const group = getState().groups.find(g => g.id === id);
                    if (group) moveGroup(group, delta);
                }
            },
            bringToFront(groupId: number) {
                // Bring every selected group to the front, dragged last so
                // it ends up visually on top (DOM appendChild = on top).
                const ids = expandToSelection(groupId);
                for (let i = ids.length - 1; i >= 0; i--) {
                    renderer.bringGroupToFront(ids[i]);
                    renderer.setGroupDragging(ids[i], true);
                }
            },
            onDrop(groupId: number) {
                autoPan?.stop();
                // Clear dragging visual from every selected group.
                for (const id of expandToSelection(groupId)) {
                    renderer.setGroupDragging(id, false);
                }
                onDrop(groupId);
            },
            onCancel(groupId: number) {
                // Mirror onDrop's teardown for everything except the
                // merge-detection (a cancelled drag has already been
                // restored to its starting position, so there's nothing
                // to merge).
                autoPan?.stop();
                for (const id of expandToSelection(groupId)) {
                    renderer.setGroupDragging(id, false);
                }
            },
            requestRender() {
                onStateChanged();
            },
        },
        undefined, // getViewportSize — use default
        screenDeltaToWorld,
    );

    // Movement threshold for promoting a candidate to an actual drag.
    // Pointer-up before this threshold is crossed = tap.
    const TAP_THRESHOLD_PX = 8;

    /**
     * A pointer is down on a piece, but we haven't decided whether the
     * user wants to drag or tap. Promoted to a drag on first move past
     * `TAP_THRESHOLD_PX`; classified as a tap on pointerup.
     */
    let dragCandidate:
        | { pieceId: number; x: number; y: number; pointerId: number }
        | null = null;

    /**
     * Promote the current candidate to a real drag. Returns true when
     * the controller accepted the start (i.e. we now own pointer capture
     * and a drag is in progress), false when it was rejected (e.g. a 2nd
     * finger had already landed and the controller's pinch gate fired).
     */
    function promoteCandidateToDrag(event: PromotablePointerEvent): boolean {
        if (!dragCandidate) return false;

        const { pieceId } = dragCandidate;
        // Synthesize the minimum subset of PointerEvent the controller
        // touches. Using the live move event means lastPointer is seeded
        // at the promotion point, so the first 8px don't get applied
        // retroactively — the piece picks up from the finger's current
        // location, not the original pointerdown.
        const synthetic = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerType: event.pointerType,
        } as PointerEvent;

        const startedNewDrag = controller.handlePointerDown(pieceId, synthetic);

        if (!startedNewDrag) {
            // Controller rejected (2nd-finger / pinch case). Drop the
            // candidate; it can't become a drag this gesture.
            dragCandidate = null;
            return false;
        }

        const drag = controller.getActiveDrag();
        if (!drag) {
            dragCandidate = null;
            return false;
        }

        // Offset drag: shift single pieces upward so the finger doesn't
        // block the view. The offset is in screen pixels, converted to
        // world space so it stays consistent regardless of zoom level.
        const group = findGroup(drag.groupId, getState());
        if (group.pieces.size === 1 && loadOffsetDragPreference()) {
            const OFFSET_SCREEN_PX = 50;
            const worldOffset = deltaToWorld({ x: 0, y: -OFFSET_SCREEN_PX });
            moveGroup(group, worldOffset);
            onStateChanged();
        }

        if (autoPan) {
            autoPan.start(drag.groupId);
            autoPan.updatePointer({ x: event.clientX, y: event.clientY });
        }

        container.setPointerCapture(event.pointerId);
        dragCandidate = null;
        return true;
    }

    // Container-level pointerdown: keeps the controller's downPointers
    // set in sync with what's physically down. Required so multi-touch
    // is detected the moment a 2nd finger lands and so the controller's
    // 2nd-finger gate can reject piece pointerdowns from other fingers.
    const onAnyPointerDown = (e: PointerEvent) => {
        controller.handleAnyPointerDown(e);

        // 2nd finger landed while a candidate is held but not promoted.
        // Discard the candidate — the held finger is now part of a
        // pinch (handled by ViewportController), not a drag.
        if (
            dragCandidate &&
            e.pointerId !== dragCandidate.pointerId
        ) {
            dragCandidate = null;
        }
    };

    // Wire renderer's piece pointerdown to record a candidate. We do
    // NOT start a drag here — that's deferred until the pointer moves
    // past TAP_THRESHOLD_PX (or a 2nd finger lands and discards the
    // candidate, or pointerup happens and it's classified as a tap).
    renderer.onPiecePointerDown((pieceId, event) => {
        // 2nd-finger piece touches are reserved for pinch — never start
        // a candidate from a finger that arrives while another is down.
        if (controller.hasOtherPointerActive(event.pointerId)) {
            return;
        }

        dragCandidate = {
            pieceId,
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
        };
    });

    const onPointerMove = (e: PointerEvent) => {
        // Candidate path: check for promotion. Only the candidate's
        // own pointer is allowed to promote it (other moves are
        // unrelated — e.g. a 2nd finger that hasn't been classified yet).
        if (dragCandidate && e.pointerId === dragCandidate.pointerId) {
            const dx = e.clientX - dragCandidate.x;
            const dy = e.clientY - dragCandidate.y;
            if (dx * dx + dy * dy >= TAP_THRESHOLD_PX * TAP_THRESHOLD_PX) {
                const promoted = promoteCandidateToDrag(e);
                if (promoted) {
                    // Feed the same move into the controller so the piece
                    // tracks the finger from this point on. Without this,
                    // the next move would be the first the controller
                    // sees — fine in practice, but the explicit call
                    // keeps the lastPointer/move loop tight.
                    controller.handlePointerMove(e);
                    if (autoPan) autoPan.updatePointer({ x: e.clientX, y: e.clientY });
                }
                return;
            }
            // Sub-threshold movement: stay a candidate.
            return;
        }

        // Active-drag path
        controller.handlePointerMove(e);

        if (controller.getActiveDrag() && autoPan) {
            autoPan.updatePointer({ x: e.clientX, y: e.clientY });
        } else if (autoPan?.isActive()) {
            // Drag was cancelled (e.g. pinch-to-zoom) — stop auto-pan
            autoPan.stop();
        }
    };

    const onPointerUp = (e: PointerEvent) => {
        // Always release the pointer from the controller's active set so it
        // mirrors what's physically on the screen, even for non-piece events.
        controller.handleAnyPointerUp(e);

        // Candidate path: pointerup before the threshold was crossed = tap.
        // No rollback needed — nothing was started. Just classify and
        // dispatch, then we're done.
        if (dragCandidate && e.pointerId === dragCandidate.pointerId) {
            const { pieceId } = dragCandidate;
            dragCandidate = null;

            if (selectionManager?.toolActive) {
                const group = findGroupForPiece(pieceId, getState().groups);
                selectionManager.toggle(group.id);
                renderer.setGroupSelected(group.id, selectionManager.isSelected(group.id));
                onStateChanged();
            }
            // Outside select-mode, taps are no-ops in this spike.
            return;
        }

        // Active-drag path
        controller.handlePointerUp(e);

        if (!controller.getActiveDrag() && autoPan?.isActive()) {
            autoPan.stop();
        }

        if (container.hasPointerCapture(e.pointerId)) {
            container.releasePointerCapture(e.pointerId);
        }
    };

    container.addEventListener('pointerdown', onAnyPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    // Return cleanup function
    return () => {
        autoPan?.stop();
        container.removeEventListener('pointerdown', onAnyPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);
    };
}
