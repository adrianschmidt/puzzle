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

/**
 * Margin in pixels. The pointer position is clamped so it stays
 * at least this far inside the viewport. This means the point
 * where you are holding the group can't leave the visible area,
 * preventing pieces from being dragged out of reach.
 */
const POINTER_MARGIN_PX = 40;

/** Snapshot of an active drag operation. */
export interface DragState {
    /** The group being dragged. */
    groupId: number;
    /** Pointer position at drag start (or last move), in client coords. */
    lastPointer: Point;
    /** The pointerId for this drag (for pointer capture). */
    pointerId: number;
    /** The group's position at drag start (for cancellation). */
    startPosition: Point;
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
 * Optional function to convert a screen-space delta to world-space.
 * When a viewport transform is active (zoom/pan), pointer deltas are
 * in screen pixels but group positions are in world coordinates.
 * Defaults to identity (no transform).
 */
export type ScreenDeltaToWorld = (delta: Point) => Point;

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
    private getViewportSize: () => { width: number; height: number };
    private screenDeltaToWorld: ScreenDeltaToWorld;
    /** Track all active pointers to detect multi-touch during drag */
    private activePointers: Set<number> = new Set();

    constructor(
        groups: () => PieceGroup[],
        callbacks: DragCallbacks,
        getViewportSize?: () => { width: number; height: number },
        screenDeltaToWorld?: ScreenDeltaToWorld,
    ) {
        this.groups = groups;
        this.callbacks = callbacks;
        this.getViewportSize = getViewportSize ?? (() => ({
            width: window.visualViewport?.width ?? window.innerWidth,
            height: window.visualViewport?.height ?? window.innerHeight,
        }));
        this.screenDeltaToWorld = screenDeltaToWorld ?? ((d) => d);
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

        const vp = this.getViewportSize();
        this.drag = {
            groupId: group.id,
            lastPointer: {
                x: Math.max(POINTER_MARGIN_PX, Math.min(vp.width - POINTER_MARGIN_PX, event.clientX)),
                y: Math.max(POINTER_MARGIN_PX, Math.min(vp.height - POINTER_MARGIN_PX, event.clientY)),
            },
            pointerId: event.pointerId,
            startPosition: { x: group.position.x, y: group.position.y },
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
        // Track all pointers, even if we're not dragging with them
        this.activePointers.add(event.pointerId);

        // Cancel drag if we detect a second pointer (pinch-to-zoom gesture)
        if (this.drag && this.activePointers.size > 1) {
            this.cancelDrag();
            return;
        }

        if (!this.drag) return;
        if (event.pointerId !== this.drag.pointerId) return;

        // Clamp pointer to viewport so the held point can't leave
        // the visible area — prevents losing pieces behind browser chrome.
        const vw = this.getViewportSize().width;
        const vh = this.getViewportSize().height;
        const clampedX = Math.max(POINTER_MARGIN_PX, Math.min(vw - POINTER_MARGIN_PX, event.clientX));
        const clampedY = Math.max(POINTER_MARGIN_PX, Math.min(vh - POINTER_MARGIN_PX, event.clientY));

        const screenDx = clampedX - this.drag.lastPointer.x;
        const screenDy = clampedY - this.drag.lastPointer.y;

        this.drag.lastPointer = { x: clampedX, y: clampedY };

        // Convert screen-space delta to world-space for group positioning.
        // When zoomed in (scale > 1), a screen pixel is a smaller world distance.
        const worldDelta = this.screenDeltaToWorld({ x: screenDx, y: screenDy });

        this.callbacks.moveGroup(this.drag.groupId, worldDelta);
        this.callbacks.requestRender();
    }

    /**
     * Handle pointer-up on the table container.
     *
     * Ends the drag and triggers the drop callback (for merge detection).
     */
    handlePointerUp(event: PointerEvent): void {
        // Remove this pointer from tracking
        this.activePointers.delete(event.pointerId);

        if (!this.drag) return;
        if (event.pointerId !== this.drag.pointerId) return;

        const groupId = this.drag.groupId;
        this.drag = null;

        this.callbacks.onDrop(groupId);
    }

    /**
     * Handle any pointer-down event to track active pointers.
     * Should be called for all pointerdown events, not just piece hits.
     */
    handleAnyPointerDown(event: PointerEvent): void {
        this.activePointers.add(event.pointerId);

        // If we're currently dragging and this is a second pointer, cancel the drag
        if (this.drag && this.activePointers.size > 1 && event.pointerId !== this.drag.pointerId) {
            this.cancelDrag();
        }
    }

    /**
     * Handle any pointer-up event to track active pointers.
     * Should be called for all pointerup events.
     */
    handleAnyPointerUp(event: PointerEvent): void {
        this.activePointers.delete(event.pointerId);
    }

    /**
     * Cancel the current drag and restore the piece to its starting position.
     * Used when a second pointer is detected during drag (pinch-to-zoom).
     */
    private cancelDrag(): void {
        if (!this.drag) return;

        // Restore group to its starting position
        const group = this.groups().find(g => g.id === this.drag!.groupId);
        if (group) {
            // Calculate the delta needed to restore original position
            const restoreDelta = {
                x: this.drag.startPosition.x - group.position.x,
                y: this.drag.startPosition.y - group.position.y,
            };
            this.callbacks.moveGroup(this.drag.groupId, restoreDelta);
            this.callbacks.requestRender();
        }

        // Clear drag state
        this.drag = null;
    }
}
