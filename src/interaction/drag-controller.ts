/**
 * Drag controller — handles pointer-based dragging of piece groups.
 *
 * Pure interaction logic: tracks active drag state, computes position deltas,
 * and calls back into the game for state updates.
 *
 * Designed for testability: the controller itself doesn't touch the DOM.
 * It receives events and emits position updates via callbacks.
 */

import type { Point, PieceGroup } from '../model/types.js';
import { findGroupForPiece } from '../model/helpers.js';

/** Snapshot of an active drag operation. */
export interface DragState {
    /** The group being dragged. */
    groupId: number;
    /** Pointer position at drag start (or last move), in client coords. */
    lastPointer: Point;
    /** The pointerId for this drag (for pointer capture). */
    pointerId: number;
}

/** Callbacks the drag controller invokes to update the game. */
export interface DragCallbacks {
    /** Called to move a group by a delta. Returns the updated group. */
    moveGroup(groupId: number, delta: Point): void;
    /** Called to bring a group to the visual front. */
    bringToFront(groupId: number): void;
    /** Called when a drag ends (drop). Use for merge detection. */
    onDrop(groupId: number): void;
    /** Called to re-render after a state change. */
    requestRender(): void;
}

/**
 * Create a drag controller.
 *
 * Call `handlePointerDown` from the renderer's piece-pointerdown callback.
 * Attach `handlePointerMove` and `handlePointerUp` to the table/container element.
 */
export class DragController {
    private drag: DragState | null = null;
    private groups: () => PieceGroup[];
    private callbacks: DragCallbacks;

    constructor(groups: () => PieceGroup[], callbacks: DragCallbacks) {
        this.groups = groups;
        this.callbacks = callbacks;
    }

    /** Returns the current drag state (for testing / inspection). */
    getActiveDrag(): DragState | null {
        return this.drag;
    }

    /**
     * Handle pointer-down on a piece.
     *
     * Identifies the group, starts tracking, and brings the group to front.
     * Returns the element to call `setPointerCapture` on (the caller handles DOM).
     */
    handlePointerDown(pieceId: number, event: PointerEvent): void {
        const group = findGroupForPiece(pieceId, this.groups());

        this.drag = {
            groupId: group.id,
            lastPointer: { x: event.clientX, y: event.clientY },
            pointerId: event.pointerId,
        };

        this.callbacks.bringToFront(group.id);
        this.callbacks.requestRender();
    }

    /**
     * Handle pointer-move on the table container.
     *
     * Computes delta from last pointer position and moves the group.
     */
    handlePointerMove(event: PointerEvent): void {
        if (!this.drag) return;
        if (event.pointerId !== this.drag.pointerId) return;

        const dx = event.clientX - this.drag.lastPointer.x;
        const dy = event.clientY - this.drag.lastPointer.y;

        this.drag.lastPointer = { x: event.clientX, y: event.clientY };

        this.callbacks.moveGroup(this.drag.groupId, { x: dx, y: dy });
        this.callbacks.requestRender();
    }

    /**
     * Handle pointer-up on the table container.
     *
     * Ends the drag and triggers the drop callback (for merge detection).
     */
    handlePointerUp(event: PointerEvent): void {
        if (!this.drag) return;
        if (event.pointerId !== this.drag.pointerId) return;

        const groupId = this.drag.groupId;
        this.drag = null;

        this.callbacks.onDrop(groupId);
    }
}
