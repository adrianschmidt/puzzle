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

/**
 * Minimum number of pixels of a group that must remain visible
 * inside the viewport on each axis. Prevents pieces from being
 * dragged entirely off-screen.
 */
const MIN_VISIBLE_PX = 40;

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
 * Clamp a group's position so that at least MIN_VISIBLE_PX pixels
 * of the group anchor remain inside the viewport. Uses visualViewport
 * when available (accurate on mobile with browser chrome) and
 * falls back to container dimensions.
 *
 * This doesn't account for group size (which would require knowing
 * piece dimensions), but ensures the anchor point — and thus at
 * least one piece — stays reachable.
 */
function clampGroupToViewport(
    group: { position: Point },
    container: HTMLElement,
): void {
    const vw = window.visualViewport?.width ?? container.clientWidth;
    const vh = window.visualViewport?.height ?? container.clientHeight;

    group.position.x = Math.max(-MIN_VISIBLE_PX, Math.min(vw - MIN_VISIBLE_PX, group.position.x));
    group.position.y = Math.max(-MIN_VISIBLE_PX, Math.min(vh - MIN_VISIBLE_PX, group.position.y));
}

/**
 * Set up drag handling for the puzzle.
 *
 * Returns a cleanup function that removes all event listeners.
 */
export function setupDragHandling(options: DragSetupOptions): () => void {
    const { container, renderer, getState, onStateChanged, onDrop } = options;

    const controller = new DragController(
        () => getState().groups,
        {
            moveGroup(groupId: number, delta: Point) {
                const group = findGroup(groupId, getState());
                moveGroup(group, delta);
                clampGroupToViewport(group, container);
            },
            bringToFront(groupId: number) {
                renderer.bringGroupToFront(groupId);
            },
            onDrop(groupId: number) {
                onDrop(groupId);
            },
            requestRender() {
                onStateChanged();
            },
        },
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
