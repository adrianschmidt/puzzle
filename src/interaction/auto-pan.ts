import type { Point } from '../model/types.js';

export const EDGE_ZONE_PX = 50;

export const MAX_PAN_SPEED_PX_PER_SEC = 600;

/**
 * Velocity in screen pixels/second; positive x = pan right (viewport moves
 * left in world space). {0,0} if the pointer is in no edge zone.
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

    if (pointer.x < edgeZone) {
        const depth = 1 - pointer.x / edgeZone;
        vx = -maxSpeed * depth;
    }
    else if (pointer.x > viewportWidth - edgeZone) {
        const depth = 1 - (viewportWidth - pointer.x) / edgeZone;
        vx = maxSpeed * depth;
    }

    if (pointer.y < edgeZone) {
        const depth = 1 - pointer.y / edgeZone;
        vy = -maxSpeed * depth;
    }
    else if (pointer.y > viewportHeight - edgeZone) {
        const depth = 1 - (viewportHeight - pointer.y) / edgeZone;
        vy = maxSpeed * depth;
    }

    return { x: vx, y: vy };
}

export interface AutoPanCallbacks {
    panViewport(screenDelta: Point): void;
    moveGroup(groupId: number, worldDelta: Point): void;
    screenDeltaToWorld(delta: Point): Point;
    requestRender(): void;
    getViewportSize(): { width: number; height: number };
}

export class AutoPanController {
    private callbacks: AutoPanCallbacks;
    private animFrameId: number | null = null;
    private lastTimestamp: number | null = null;
    private currentPointer: Point | null = null;
    private activeGroupId: number | null = null;

    constructor(callbacks: AutoPanCallbacks) {
        this.callbacks = callbacks;
    }

    start(groupId: number): void {
        this.activeGroupId = groupId;
        this.lastTimestamp = null;
        // Loop starts on the first pointer update, not here.
    }

    updatePointer(pointer: Point): void {
        this.currentPointer = pointer;

        if (this.animFrameId === null && this.activeGroupId !== null) {
            this.lastTimestamp = null;
            this.animFrameId = requestAnimationFrame(this.tick);
        }
    }

    stop(): void {
        this.activeGroupId = null;
        this.currentPointer = null;
        this.lastTimestamp = null;

        if (this.animFrameId !== null) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    isActive(): boolean {
        return this.activeGroupId !== null;
    }

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
            // Outside every edge zone — stop the loop; updatePointer() restarts it.
            this.lastTimestamp = null;
            return;
        }

        const dt = this.lastTimestamp !== null
            ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.1) // cap at 100ms to avoid jumps
            : 0;

        if (dt > 0) {
            const screenDelta: Point = {
                x: -velocity.x * dt, // negate: +velocity = pointer wants right = viewport pans left
                y: -velocity.y * dt,
            };

            this.callbacks.panViewport(screenDelta);

            // Move the group in world space too, so the piece stays under the
            // pointer as the viewport pans (otherwise it drifts).
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
