/**
 * Auto-pan controller — automatically pans the viewport when dragging
 * a piece near the edge of the screen.
 *
 * When the pointer enters an edge zone during a drag, the viewport
 * pans in that direction. Pan speed is proportional to how deep into
 * the edge zone the pointer is (0 at inner boundary, max at screen edge).
 *
 * Pure logic with a thin RAF layer. The core `computeAutoPanVelocity`
 * function is fully testable without DOM/timers.
 */

import type { Point } from '../model/types.js';

/** Width of the edge zone in pixels. */
export const EDGE_ZONE_PX = 50;

/**
 * Maximum pan speed in screen pixels per second.
 * At the very edge of the viewport, this is the speed.
 */
export const MAX_PAN_SPEED_PX_PER_SEC = 600;

/**
 * Compute the auto-pan velocity (in screen pixels/second) for a given
 * pointer position within a viewport.
 *
 * Returns {x, y} velocity where positive x = pan right (viewport moves
 * left in world space, so the pointer effectively moves right on the table),
 * etc. Returns {0,0} if the pointer is not in any edge zone.
 *
 * @param pointer - Pointer position in client/screen coordinates
 * @param viewportWidth - Width of the viewport in pixels
 * @param viewportHeight - Height of the viewport in pixels
 * @param edgeZone - Width of the activation zone in pixels
 * @param maxSpeed - Maximum pan speed in px/sec
 */
export function computeAutoPanVelocity(
    pointer: Point,
    viewportWidth: number,
    viewportHeight: number,
    edgeZone: number = EDGE_ZONE_PX,
    maxSpeed: number = MAX_PAN_SPEED_PX_PER_SEC,
): Point {
    let vx = 0;
    let vy = 0;

    // Left edge
    if (pointer.x < edgeZone) {
        const depth = 1 - pointer.x / edgeZone; // 0 at inner boundary, 1 at screen edge
        vx = -maxSpeed * depth;
    }
    // Right edge
    else if (pointer.x > viewportWidth - edgeZone) {
        const depth = 1 - (viewportWidth - pointer.x) / edgeZone;
        vx = maxSpeed * depth;
    }

    // Top edge
    if (pointer.y < edgeZone) {
        const depth = 1 - pointer.y / edgeZone;
        vy = -maxSpeed * depth;
    }
    // Bottom edge
    else if (pointer.y > viewportHeight - edgeZone) {
        const depth = 1 - (viewportHeight - pointer.y) / edgeZone;
        vy = maxSpeed * depth;
    }

    return { x: vx, y: vy };
}

/** Callbacks the auto-pan controller needs. */
export interface AutoPanCallbacks {
    /** Pan the viewport by screen-space delta. */
    panViewport(screenDelta: Point): void;
    /** Move the dragged group by world-space delta. */
    moveGroup(groupId: number, worldDelta: Point): void;
    /** Convert screen delta to world delta. */
    screenDeltaToWorld(delta: Point): Point;
    /** Re-render after changes. */
    requestRender(): void;
    /** Get viewport dimensions. */
    getViewportSize(): { width: number; height: number };
}

/**
 * Auto-pan controller that runs during piece drags.
 *
 * Usage:
 * - Call `start(groupId)` when a drag begins.
 * - Call `updatePointer(point)` on each pointer move.
 * - Call `stop()` when the drag ends or is cancelled.
 */
export class AutoPanController {
    private callbacks: AutoPanCallbacks;
    private animFrameId: number | null = null;
    private lastTimestamp: number | null = null;
    private currentPointer: Point | null = null;
    private activeGroupId: number | null = null;

    constructor(callbacks: AutoPanCallbacks) {
        this.callbacks = callbacks;
    }

    /** Start auto-panning for a drag on the given group. */
    start(groupId: number): void {
        this.activeGroupId = groupId;
        this.lastTimestamp = null;
        // Don't start the loop yet — wait for first pointer update
    }

    /** Update the pointer position (call on every pointer move during drag). */
    updatePointer(pointer: Point): void {
        this.currentPointer = pointer;

        // Start the animation loop if not already running
        if (this.animFrameId === null && this.activeGroupId !== null) {
            this.lastTimestamp = null;
            this.animFrameId = requestAnimationFrame(this.tick);
        }
    }

    /** Stop auto-panning (call when drag ends or is cancelled). */
    stop(): void {
        this.activeGroupId = null;
        this.currentPointer = null;
        this.lastTimestamp = null;

        if (this.animFrameId !== null) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    /** Whether auto-pan is currently active. */
    isActive(): boolean {
        return this.activeGroupId !== null;
    }

    /** The RAF tick — bound as arrow function for stable reference. */
    private tick = (timestamp: number): void => {
        this.animFrameId = null;

        if (this.activeGroupId === null || this.currentPointer === null) {
            return;
        }

        const vp = this.callbacks.getViewportSize();
        const velocity = computeAutoPanVelocity(
            this.currentPointer,
            vp.width,
            vp.height,
        );

        if (velocity.x === 0 && velocity.y === 0) {
            // Pointer is outside every edge zone — stop the loop.
            // updatePointer() will restart it if the pointer re-enters one.
            this.lastTimestamp = null;
            return;
        }

        // Compute elapsed time for frame-rate-independent movement
        const dt = this.lastTimestamp !== null
            ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.1) // cap at 100ms to avoid jumps
            : 0;

        if (dt > 0) {
            const screenDelta: Point = {
                x: -velocity.x * dt, // negate: positive velocity = pointer wants to go right
                y: -velocity.y * dt, // = viewport pans left (negative screen delta)
            };

            // Pan the viewport
            this.callbacks.panViewport(screenDelta);

            // Also move the group in world space so the piece stays
            // under the pointer. The viewport moved, but the pointer
            // didn't, so without this the piece would appear to drift.
            const worldDelta = this.callbacks.screenDeltaToWorld({
                x: -screenDelta.x,
                y: -screenDelta.y,
            });
            this.callbacks.moveGroup(this.activeGroupId, worldDelta);

            this.callbacks.requestRender();
        }

        this.lastTimestamp = timestamp;
        this.animFrameId = requestAnimationFrame(this.tick);
    };
}
