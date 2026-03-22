/**
 * Wire up the DragController to a Renderer and the DOM container.
 *
 * This is the glue between the pure-logic DragController and the
 * browser APIs (pointer capture, DOM events). Separated from the
 * controller to keep it testable.
 */

import type { GameState, Point } from '../model/types.js';
import { moveGroup } from '../model/helpers.js';
import type { Renderer } from '../renderer/types.js';
import { DragController } from './drag-controller.js';
import type { ScreenDeltaToWorld } from './drag-controller.js';

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

/**
 * Set up drag handling for the puzzle.
 *
 * Returns a cleanup function that removes all event listeners.
 */
export function setupDragHandling(options: DragSetupOptions): () => void {
    const { container, renderer, getState, onStateChanged, onDrop, screenDeltaToWorld } = options;

    const controller = new DragController(
        () => getState().groups,
        {
            moveGroup(groupId: number, delta: Point) {
                const group = findGroup(groupId, getState());
                moveGroup(group, delta);
            },
            bringToFront(groupId: number) {
                renderer.bringGroupToFront(groupId);
                renderer.setGroupDragging(groupId, true);
            },
            onDrop(groupId: number) {
                renderer.setGroupDragging(groupId, false);
                onDrop(groupId);
            },
            requestRender() {
                onStateChanged();
            },
        },
        undefined, // getViewportSize — use default
        screenDeltaToWorld,
    );

    // Wire renderer's piece pointerdown to the controller.
    // The renderer calls this when any piece is clicked/touched.
    renderer.onPiecePointerDown((pieceId, event) => {
        controller.handlePointerDown(pieceId, event);

        // Capture pointer on the container so we get move/up even
        // if the pointer leaves the piece element.
        container.setPointerCapture(event.pointerId);
    });

    // Attach move and up handlers to the container.
    const onPointerMove = (e: PointerEvent) =>
        controller.handlePointerMove(e);

    const onPointerUp = (e: PointerEvent) => {
        controller.handlePointerUp(e);

        if (container.hasPointerCapture(e.pointerId)) {
            container.releasePointerCapture(e.pointerId);
        }
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    // Return cleanup function
    return () => {
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);
    };
}
