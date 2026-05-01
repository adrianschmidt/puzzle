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

/**
 * Grace window after the first pointer-down during which a 2nd touch
 * is treated as the start of a pinch and cancels the active drag. After
 * this window, a 2nd touch is assumed to be an intentional "hold piece
 * while zooming" gesture and the drag is preserved. Either way, the 2nd
 * touch never starts a drag of its own.
 */
const PINCH_CANCEL_WINDOW_MS = 250;

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
    /**
     * Called when an in-progress drag is cancelled (e.g. pinch-to-zoom).
     * Symmetric counterpart to `bringToFront` for tearing down any visual
     * "being dragged" state. The group's position has already been
     * restored by the time this fires.
     */
    onCancel(groupId: number): void;
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
 * Also attach `handleAnyPointerDown`/`handleAnyPointerUp` to the container's
 * `pointerdown`/`pointerup` so the controller sees every pointer (not just
 * piece hits) and can cancel a drag the moment a 2nd finger lands.
 */
export class DragController {
    private drag: DragState | null = null;
    private groups: () => PieceGroup[];
    private callbacks: DragCallbacks;
    private getViewportSize: () => { width: number; height: number };
    private screenDeltaToWorld: ScreenDeltaToWorld;
    private now: () => number;
    /**
     * Pointers currently down on the document. Owned exclusively by
     * `handleAnyPointerDown` (adds) and `handleAnyPointerUp` (removes) —
     * the piece-level `handlePointerDown`/`handlePointerUp` handlers must
     * not mutate this set, so the two paths can't disagree on what's down.
     * Used to detect multi-touch (size > 1) and to gate 2nd-finger piece
     * touches in `handlePointerDown`.
     */
    private downPointers: Set<number> = new Set();
    /**
     * Timestamp (ms) of the pointer-down that started the current touch
     * sequence — i.e. when `downPointers` went from empty to non-empty.
     * Used to decide whether a later 2nd touch is a pinch (cancel drag)
     * or a "hold-while-zooming" gesture (preserve drag). Reset to null
     * once all pointers lift.
     */
    private firstPointerDownTime: number | null = null;

    constructor(
        groups: () => PieceGroup[],
        callbacks: DragCallbacks,
        getViewportSize?: () => { width: number; height: number },
        screenDeltaToWorld?: ScreenDeltaToWorld,
        now?: () => number,
    ) {
        this.groups = groups;
        this.callbacks = callbacks;
        this.getViewportSize = getViewportSize ?? (() => ({
            width: window.visualViewport?.width ?? window.innerWidth,
            height: window.visualViewport?.height ?? window.innerHeight,
        }));
        this.screenDeltaToWorld = screenDeltaToWorld ?? ((d) => d);
        this.now = now ?? (() => performance.now());
    }

    /** Returns the current drag state (for testing / inspection). */
    getActiveDrag(): DragState | null {
        return this.drag;
    }

    /**
     * Handle pointer-down on a piece.
     *
     * Identifies the group, starts tracking, and brings the group to front.
     * Returns `true` when a new drag was started, `false` when the call was
     * ignored — e.g. a 2nd finger touched a piece while another pointer is
     * already down. (Multi-touch is reserved for pinch; only the first
     * pointer can grab a piece.)
     */
    handlePointerDown(pieceId: number, event: PointerEvent): boolean {
        // Ignore 2nd-finger piece touches: those are pinch gestures, not
        // a request to drag another piece. Note this check relies on
        // `handleAnyPointerDown` having already added the first pointer
        // for the active touch sequence.
        if (this.downPointers.size > 0 && !this.downPointers.has(event.pointerId)) {
            return false;
        }

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
        return true;
    }

    /**
     * Handle pointer-move on the table container.
     *
     * Computes delta from last pointer position and moves the group.
     * Multi-touch detection lives in `handleAnyPointerDown` (not here)
     * so a 2nd finger cancels the drag the instant it lands.
     */
    handlePointerMove(event: PointerEvent): void {
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
        if (!this.drag) return;
        if (event.pointerId !== this.drag.pointerId) return;

        const groupId = this.drag.groupId;
        this.drag = null;

        this.callbacks.onDrop(groupId);
    }

    /**
     * Handle any pointer-down event to track active pointers.
     * Should be called for all pointerdown events, not just piece hits.
     * Sole writer of additions to `downPointers`.
     */
    handleAnyPointerDown(event: PointerEvent): void {
        const wasEmpty = this.downPointers.size === 0;
        this.downPointers.add(event.pointerId);
        if (wasEmpty) this.firstPointerDownTime = this.now();

        // 2nd finger landed during an active drag. Only cancel if we're
        // still inside the pinch grace window after the first pointer-down
        // — outside it, the user is intentionally holding the piece while
        // adding a 2nd finger to zoom, and we keep the drag.
        if (this.drag && this.downPointers.size > 1 && event.pointerId !== this.drag.pointerId) {
            const elapsed = this.now() - (this.firstPointerDownTime ?? 0);
            if (elapsed < PINCH_CANCEL_WINDOW_MS) {
                this.cancelDragAndRestore();
            }
        }
    }

    /**
     * Handle any pointer-up event to track active pointers.
     * Should be called for all pointerup events.
     * Sole writer of removals from `downPointers`.
     */
    handleAnyPointerUp(event: PointerEvent): void {
        this.downPointers.delete(event.pointerId);
        if (this.downPointers.size === 0) this.firstPointerDownTime = null;
    }

    /**
     * Cancel the current drag and restore the dragged group to its
     * starting position. No-op if no drag is active. Fires the
     * `onCancel` callback so consumers can tear down visual state
     * symmetric to `bringToFront`.
     *
     * Used internally on pinch-to-zoom, and externally by setup-drag
     * when a tap-to-toggle-selection gesture needs to undo the
     * speculative drag started at pointerdown.
     */
    cancelDragAndRestore(): void {
        if (!this.drag) return;

        const cancelledGroupId = this.drag.groupId;

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

        // Clear drag state before notifying so the callback sees a
        // post-cancel controller (e.g. getActiveDrag() returns null).
        this.drag = null;
        this.callbacks.onCancel(cancelledGroupId);
    }
}
