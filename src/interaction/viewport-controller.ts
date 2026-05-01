/**
 * Viewport controller — handles zoom and pan gestures.
 *
 * - Scroll wheel: zoom in/out at cursor position
 * - Pinch-to-zoom: two-finger zoom on touch devices
 * - Pan: drag on empty space (not on a puzzle piece)
 *
 * Event listeners are owned by PointerRouter. This class only contains
 * the gesture math and is invoked via its public handler methods.
 */

import type { Point } from '../model/types.js';
import { ViewportTransform } from './viewport-transform.js';

/** Tracks a single active touch point for gesture detection. */
interface TouchPoint {
    id: number;
    x: number;
    y: number;
}

/**
 * Computes the distance between two touch points.
 */
export function touchDistance(a: TouchPoint, b: TouchPoint): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Computes the midpoint between two touch points.
 */
export function touchMidpoint(a: TouchPoint, b: TouchPoint): Point {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
    };
}

export class ViewportController {
    private transform: ViewportTransform;
    private onViewportChanged: () => void;

    // Pan state (single pointer on empty space)
    private panLastPoint: Point | null = null;

    // Pinch state (two-finger gesture)
    private lastPinchDist: number | null = null;
    private lastPinchMidpoint: Point | null = null;

    constructor(transform: ViewportTransform, onViewportChanged: () => void) {
        this.transform = transform;
        this.onViewportChanged = onViewportChanged;
    }

    // --- Public gesture handlers (called by PointerRouter) ---

    handlePanStart(evt: PointerEvent): void {
        this.panLastPoint = { x: evt.clientX, y: evt.clientY };
    }

    /** Apply a pan delta from the previous pointer position to the current one. */
    handlePanMove(evt: PointerEvent): void {
        if (!this.panLastPoint) return;
        const dx = evt.clientX - this.panLastPoint.x;
        const dy = evt.clientY - this.panLastPoint.y;
        this.panLastPoint = { x: evt.clientX, y: evt.clientY };
        this.transform.pan({ x: dx, y: dy });
        this.onViewportChanged();
    }

    handlePanEnd(): void {
        this.panLastPoint = null;
    }

    handlePinchStart(a: PointerEvent, b: PointerEvent): void {
        const ta = { id: a.pointerId, x: a.clientX, y: a.clientY };
        const tb = { id: b.pointerId, x: b.clientX, y: b.clientY };
        this.lastPinchDist = touchDistance(ta, tb);
        this.lastPinchMidpoint = touchMidpoint(ta, tb);
    }

    /** Update pinch state from the new positions of the locked pair; fires onViewportChanged. */
    handlePinchMove(a: PointerEvent, b: PointerEvent): void {
        if (this.lastPinchDist === null || this.lastPinchMidpoint === null) return;
        const ta = { id: a.pointerId, x: a.clientX, y: a.clientY };
        const tb = { id: b.pointerId, x: b.clientX, y: b.clientY };
        const newDist = touchDistance(ta, tb);
        const newMidpoint = touchMidpoint(ta, tb);

        const factor = newDist / this.lastPinchDist;
        if (factor !== 0 && isFinite(factor)) this.transform.zoom(factor, newMidpoint);

        const panDx = newMidpoint.x - this.lastPinchMidpoint.x;
        const panDy = newMidpoint.y - this.lastPinchMidpoint.y;
        this.transform.pan({ x: panDx, y: panDy });

        this.lastPinchDist = newDist;
        this.lastPinchMidpoint = newMidpoint;
        this.onViewportChanged();
    }

    /** Reset pinch tracking; safe to call regardless of state. */
    handlePinchEnd(): void {
        this.lastPinchDist = null;
        this.lastPinchMidpoint = null;
    }

    handleWheel(evt: WheelEvent): void {
        evt.preventDefault();
        const delta = Math.max(-50, Math.min(50, evt.deltaY));
        const factor = 1 - delta * 0.005;
        this.transform.zoom(factor, { x: evt.clientX, y: evt.clientY });
        this.onViewportChanged();
    }
}
