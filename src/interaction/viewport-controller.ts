/**
 * Viewport controller — handles DOM events for zoom and pan.
 *
 * - Scroll wheel: zoom in/out at cursor position
 * - Pinch-to-zoom: two-finger zoom on touch devices
 * - Pan: drag on empty space (not on a puzzle piece)
 *
 * Works alongside the DragController: when a pointer lands on a piece,
 * DragController handles it. When it lands on empty table space,
 * ViewportController handles panning.
 */

import type { Point } from '../model/types.js';
import { ViewportTransform } from './viewport-transform.js';

export interface ViewportControllerOptions {
    /** The DOM container for the puzzle table. */
    container: HTMLElement;
    /** The viewport transform to manipulate. */
    transform: ViewportTransform;
    /** Called whenever the viewport changes (zoom/pan). */
    onViewportChanged: () => void;
    /**
     * Check if a pointer event hit a puzzle piece.
     * Returns true if the event target is a piece (not empty table).
     */
    isPieceElement: (target: EventTarget | null) => boolean;
}

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
    private container: HTMLElement;
    private transform: ViewportTransform;
    private onViewportChanged: () => void;
    private isPieceElement: (target: EventTarget | null) => boolean;

    // Pan state (single pointer on empty space)
    private panPointerId: number | null = null;
    private panLastPoint: Point | null = null;

    // Pinch state (two-finger gesture)
    private activeTouches: Map<number, TouchPoint> = new Map();
    private lastPinchDist: number | null = null;
    private lastPinchMidpoint: Point | null = null;

    // Bound event handlers (for cleanup)
    private boundWheel: (e: WheelEvent) => void;
    private boundPointerDown: (e: PointerEvent) => void;
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;

    constructor(options: ViewportControllerOptions) {
        this.container = options.container;
        this.isPieceElement = options.isPieceElement;
        this.transform = options.transform;
        this.onViewportChanged = options.onViewportChanged;


        this.boundWheel = this.handleWheel.bind(this);
        this.boundPointerDown = this.handlePointerDown.bind(this);
        this.boundPointerMove = this.handlePointerMove.bind(this);
        this.boundPointerUp = this.handlePointerUp.bind(this);

        this.container.addEventListener('wheel', this.boundWheel, { passive: false });
        this.container.addEventListener('pointerdown', this.boundPointerDown);
        this.container.addEventListener('pointermove', this.boundPointerMove);
        this.container.addEventListener('pointerup', this.boundPointerUp);
        this.container.addEventListener('pointercancel', this.boundPointerUp);
    }

    /**
     * Clean up all event listeners.
     */
    destroy(): void {
        this.container.removeEventListener('wheel', this.boundWheel);
        this.container.removeEventListener('pointerdown', this.boundPointerDown);
        this.container.removeEventListener('pointermove', this.boundPointerMove);
        this.container.removeEventListener('pointerup', this.boundPointerUp);
        this.container.removeEventListener('pointercancel', this.boundPointerUp);
    }

    // --- Wheel zoom ---

    private handleWheel(e: WheelEvent): void {
        // Don't zoom when scrolling inside a UI element (e.g. info modal)
        if (!this.isBackgroundElement(e.target) && !this.isPieceElement(e.target)) {
            return;
        }

        e.preventDefault();

        // Scale zoom factor based on deltaY magnitude for smooth trackpad/scroll experience.
        // Trackpad pinch-to-zoom sends small deltaY values; mouse wheel sends larger ones.
        // Clamp to prevent extreme jumps.
        const delta = Math.max(-50, Math.min(50, e.deltaY));
        const factor = 1 - delta * 0.005;
        this.transform.zoom(factor, { x: e.clientX, y: e.clientY });
        this.onViewportChanged();
    }

    // --- Pointer events for pan and pinch ---

    private handlePointerDown(e: PointerEvent): void {
        // Track all touch points for pinch detection
        if (e.pointerType === 'touch') {
            this.activeTouches.set(e.pointerId, {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
            });

            // If we now have 2 touches, start pinch mode
            if (this.activeTouches.size === 2) {
                this.startPinch();

                // Cancel any active pan — pinch takes over
                this.panPointerId = null;
                this.panLastPoint = null;

                return;
            }
        }

        // Only start pan if the pointer landed on the background — either
        // the container itself or its direct puzzle table child (empty space).
        // This prevents pan from stealing clicks on buttons, overlays, etc.
        if (!this.isBackgroundElement(e.target)) {
            return;
        }

        // Start panning (single pointer on empty space)
        if (this.panPointerId === null && this.activeTouches.size < 2) {
            this.panPointerId = e.pointerId;
            this.panLastPoint = { x: e.clientX, y: e.clientY };
            this.container.setPointerCapture(e.pointerId);
        }
    }

    private handlePointerMove(e: PointerEvent): void {
        // Update tracked touch position
        if (e.pointerType === 'touch' && this.activeTouches.has(e.pointerId)) {
            this.activeTouches.set(e.pointerId, {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
            });

            // Handle pinch if 2 touches are active
            if (this.activeTouches.size === 2) {
                this.handlePinchMove();

                return;
            }
        }

        // Handle pan
        if (this.panPointerId === e.pointerId && this.panLastPoint) {
            const dx = e.clientX - this.panLastPoint.x;
            const dy = e.clientY - this.panLastPoint.y;
            this.panLastPoint = { x: e.clientX, y: e.clientY };

            this.transform.pan({ x: dx, y: dy });
            this.onViewportChanged();
        }
    }

    private handlePointerUp(e: PointerEvent): void {
        // Remove from active touches
        if (e.pointerType === 'touch') {
            this.activeTouches.delete(e.pointerId);

            // If we were in pinch mode and now have <2 fingers, end pinch
            if (this.lastPinchDist !== null) {
                this.lastPinchDist = null;
                this.lastPinchMidpoint = null;
            }
        }

        // End pan
        if (this.panPointerId === e.pointerId) {
            if (this.container.hasPointerCapture(e.pointerId)) {
                this.container.releasePointerCapture(e.pointerId);
            }

            this.panPointerId = null;
            this.panLastPoint = null;
        }
    }

    /**
     * Check if the event target is the puzzle background (empty space).
     * Only these elements should trigger pan — everything else (pieces,
     * buttons, overlays) should receive its own click/pointer events.
     */
    private isBackgroundElement(target: EventTarget | null): boolean {
        if (!target || !(target instanceof Element)) {
            return false;
        }

        // The container itself (app background)
        if (target === this.container) {
            return true;
        }

        // The puzzle table (renderer's container div, tagged with data-puzzle-table)
        if ((target as HTMLElement).dataset?.puzzleTable === 'true') {
            return true;
        }

        return false;
    }

    // --- Pinch-to-zoom ---

    private startPinch(): void {
        const touches = Array.from(this.activeTouches.values());
        this.lastPinchDist = touchDistance(touches[0], touches[1]);
        this.lastPinchMidpoint = touchMidpoint(touches[0], touches[1]);
    }

    private handlePinchMove(): void {
        if (this.lastPinchDist === null || this.lastPinchMidpoint === null) {
            return;
        }

        const touches = Array.from(this.activeTouches.values());
        const newDist = touchDistance(touches[0], touches[1]);
        const newMidpoint = touchMidpoint(touches[0], touches[1]);

        // Zoom by the ratio of distances
        const factor = newDist / this.lastPinchDist;

        if (factor !== 0 && isFinite(factor)) {
            this.transform.zoom(factor, newMidpoint);
        }

        // Pan by midpoint movement
        const panDx = newMidpoint.x - this.lastPinchMidpoint.x;
        const panDy = newMidpoint.y - this.lastPinchMidpoint.y;
        this.transform.pan({ x: panDx, y: panDy });

        this.lastPinchDist = newDist;
        this.lastPinchMidpoint = newMidpoint;

        this.onViewportChanged();
    }
}
