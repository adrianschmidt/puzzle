/**
 * Maps world coordinates (where pieces live) to screen coordinates:
 *   Screen = World × scale + offset
 *   World  = (Screen - offset) / scale
 */

import type { Point } from '../model/types.js';

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 5.0;

/** Scroll-wheel zoom step (multiplier per tick). */
export const WHEEL_ZOOM_FACTOR = 1.1;

export interface ViewportState {
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

    getState(): Readonly<ViewportState> {
        return { ...this.state, offset: { ...this.state.offset } };
    }

    getScale(): number {
        return this.state.scale;
    }

    getOffset(): Readonly<Point> {
        return { ...this.state.offset };
    }

    screenToWorld(screen: Point): Point {
        return {
            x: (screen.x - this.state.offset.x) / this.state.scale,
            y: (screen.y - this.state.offset.y) / this.state.scale,
        };
    }

    worldToScreen(world: Point): Point {
        return {
            x: world.x * this.state.scale + this.state.offset.x,
            y: world.y * this.state.scale + this.state.offset.y,
        };
    }

    screenDeltaToWorld(delta: Point): Point {
        return {
            x: delta.x / this.state.scale,
            y: delta.y / this.state.scale,
        };
    }

    pan(screenDelta: Point): void {
        this.state.offset = {
            x: this.state.offset.x + screenDelta.x,
            y: this.state.offset.y + screenDelta.y,
        };
    }

    /** The focus point stays fixed on screen while the scale changes. */
    zoom(factor: number, focusScreen: Point): void {
        const newScale = clampScale(this.state.scale * factor);
        const actualFactor = newScale / this.state.scale;

        this.state.offset = {
            x: focusScreen.x - (focusScreen.x - this.state.offset.x) * actualFactor,
            y: focusScreen.y - (focusScreen.y - this.state.offset.y) * actualFactor,
        };

        this.state.scale = newScale;
    }

    setState(newState: ViewportState): void {
        this.state = {
            scale: clampScale(newState.scale),
            offset: { ...newState.offset },
        };
    }

    reset(): void {
        this.state = { scale: 1, offset: { x: 0, y: 0 } };
    }
}

export function clampScale(scale: number): number {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}
