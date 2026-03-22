/**
 * Viewport transform — manages zoom and pan state.
 *
 * Pure logic, no DOM dependency. The transform defines a mapping
 * from world coordinates (where puzzle pieces live) to screen
 * coordinates (what the user sees).
 *
 * Screen = World × scale + offset
 * World = (Screen - offset) / scale
 */

import type { Point } from '../model/types.js';

/** Zoom limits to prevent extreme zoom levels. */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 5.0;

/** Default zoom step for scroll wheel (multiplier per tick). */
export const WHEEL_ZOOM_FACTOR = 1.1;

export interface ViewportState {
    /** Current scale factor. 1.0 = no zoom. */
    scale: number;
    /** Translation offset in screen pixels. */
    offset: Point;
}

export class ViewportTransform {
    private state: ViewportState;

    constructor(initial?: Partial<ViewportState>) {
        this.state = {
            scale: initial?.scale ?? 1,
            offset: initial?.offset ?? { x: 0, y: 0 },
        };
    }

    /** Get the current viewport state (read-only snapshot). */
    getState(): Readonly<ViewportState> {
        return { ...this.state, offset: { ...this.state.offset } };
    }

    /** Get the current scale. */
    getScale(): number {
        return this.state.scale;
    }

    /** Get the current offset. */
    getOffset(): Readonly<Point> {
        return { ...this.state.offset };
    }

    /**
     * Convert a screen-space point to world-space.
     * World = (Screen - offset) / scale
     */
    screenToWorld(screen: Point): Point {
        return {
            x: (screen.x - this.state.offset.x) / this.state.scale,
            y: (screen.y - this.state.offset.y) / this.state.scale,
        };
    }

    /**
     * Convert a world-space point to screen-space.
     * Screen = World × scale + offset
     */
    worldToScreen(world: Point): Point {
        return {
            x: world.x * this.state.scale + this.state.offset.x,
            y: world.y * this.state.scale + this.state.offset.y,
        };
    }

    /**
     * Convert a screen-space distance/delta to world-space.
     * Pure scaling, no translation.
     */
    screenDeltaToWorld(delta: Point): Point {
        return {
            x: delta.x / this.state.scale,
            y: delta.y / this.state.scale,
        };
    }

    /**
     * Pan the viewport by a screen-space delta.
     */
    pan(screenDelta: Point): void {
        this.state.offset = {
            x: this.state.offset.x + screenDelta.x,
            y: this.state.offset.y + screenDelta.y,
        };
    }

    /**
     * Zoom around a focus point (in screen coordinates).
     *
     * The focus point stays fixed on screen while the scale changes.
     * This gives natural zoom-to-cursor behavior.
     *
     * @param factor - Zoom multiplier (>1 to zoom in, <1 to zoom out)
     * @param focusScreen - The screen point to zoom around
     */
    zoom(factor: number, focusScreen: Point): void {
        const newScale = clampScale(this.state.scale * factor);
        const actualFactor = newScale / this.state.scale;

        // Adjust offset so the focus point stays in place:
        // newOffset = focusScreen - (focusScreen - oldOffset) * actualFactor
        this.state.offset = {
            x: focusScreen.x - (focusScreen.x - this.state.offset.x) * actualFactor,
            y: focusScreen.y - (focusScreen.y - this.state.offset.y) * actualFactor,
        };

        this.state.scale = newScale;
    }

    /**
     * Set scale and offset directly (e.g. for restoring saved state).
     */
    setState(newState: ViewportState): void {
        this.state = {
            scale: clampScale(newState.scale),
            offset: { ...newState.offset },
        };
    }

    /**
     * Reset to identity transform (no zoom, no pan).
     */
    reset(): void {
        this.state = { scale: 1, offset: { x: 0, y: 0 } };
    }
}

/**
 * Clamp a scale value within the allowed zoom range.
 */
export function clampScale(scale: number): number {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}
