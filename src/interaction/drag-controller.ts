/**
 * Designed for testability: the controller itself doesn't touch the DOM.
 * It receives events and emits position updates via callbacks.
 *
 * Integration model: called from PointerRouter via `handlePointerDown(pieceId, evt)`,
 * `handlePointerMove(evt)`, `handlePointerUp(evt)`, and `cancel()`. Multi-pointer /
 * pinch arbitration is owned entirely by PointerRouter; DragController only
 * sees the single drag pointer.
 */

import type { Point, PieceGroup } from '../model/types.js';

/**
 * The pointer position is clamped so it stays
 * at least this far inside the viewport. This means the point
 * where you are holding the group can't leave the visible area,
 * preventing pieces from being dragged out of reach.
 */
const POINTER_MARGIN_PX = 40;

export interface DragState {
    groupId: number;
    /** Pointer position at drag start (or last move), in client coords. */
    lastPointer: Point;
    pointerId: number;
    /** The group's position at drag start (for cancellation). */
    startPosition: Point;
}

export interface DragCallbacks {
    moveGroup(groupId: number, delta: Point): void;
    bringToFront(groupId: number): void;
    requestRender(): void;
}

/**
 * Backed by `state.pieceToGroup` and `state.groupsById` in production for
 * O(1) lookup.
 */
export interface DragGroupLookups {
    /** Throws if the piece is unknown. */
    getGroupForPiece(pieceId: number): PieceGroup;
    /** Returns `undefined` if the group is gone. */
    getGroupById(groupId: number): PieceGroup | undefined;
}

/**
 * When a viewport transform is active (zoom/pan), pointer deltas are
 * in screen pixels but group positions are in world coordinates.
 */
export type ScreenDeltaToWorld = (delta: Point) => Point;

export class DragController {
    private drag: DragState | null = null;
    private lookups: DragGroupLookups;
    private callbacks: DragCallbacks;
    private getViewportSize: () => { width: number; height: number };
    private screenDeltaToWorld: ScreenDeltaToWorld;

    constructor(
        lookups: DragGroupLookups,
        callbacks: DragCallbacks,
        getViewportSize?: () => { width: number; height: number },
        screenDeltaToWorld?: ScreenDeltaToWorld,
    ) {
        this.lookups = lookups;
        this.callbacks = callbacks;
        this.getViewportSize = getViewportSize ?? (() => ({
            width: window.visualViewport?.width ?? window.innerWidth,
            height: window.visualViewport?.height ?? window.innerHeight,
        }));
        this.screenDeltaToWorld = screenDeltaToWorld ?? ((d) => d);
    }

    getActiveDrag(): DragState | null {
        return this.drag;
    }

    handlePointerDown(pieceId: number, event: PointerEvent): void {
        const group = this.lookups.getGroupForPiece(pieceId);

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

        const worldDelta = this.screenDeltaToWorld({ x: screenDx, y: screenDy });

        this.callbacks.moveGroup(this.drag.groupId, worldDelta);
        this.callbacks.requestRender();
    }

    /**
     * The caller (PointerRouter hook) is responsible for triggering
     * drop/merge detection.
     */
    handlePointerUp(event: PointerEvent): void {
        if (!this.drag) return;
        if (event.pointerId !== this.drag.pointerId) return;

        this.drag = null;
    }

    /**
     * Called by the PointerRouter hook when a tap-to-toggle-selection
     * gesture needs to undo the speculative drag started at pointerdown,
     * or when a pinch cancels the drag.
     */
    cancel(): void {
        if (!this.drag) return;

        const group = this.lookups.getGroupById(this.drag.groupId);
        if (group) {
            const restoreDelta = {
                x: this.drag.startPosition.x - group.position.x,
                y: this.drag.startPosition.y - group.position.y,
            };
            this.callbacks.moveGroup(this.drag.groupId, restoreDelta);
            this.callbacks.requestRender();
        }

        this.drag = null;
    }
}
