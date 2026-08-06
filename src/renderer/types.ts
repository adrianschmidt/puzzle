/**
 * The port is not the {@link Renderer} interface alone:
 * {@link VIEWPORT_TRANSITION_MS} is a runtime value implementations are
 * bound by.
 */

import type { GameState, Point } from '../model/types.js';

/**
 * How long the animated viewport transition runs, in milliseconds.
 *
 * Part of the port rather than of one implementation: the caller that turns
 * the transition back off cannot see the animation, so the port has to say
 * how long to wait — `app/viewport-fit.ts` arms a fallback timer against
 * exactly this number, and the completed-group spin there runs in lockstep
 * with the viewport zoom. Two literals — one in the CSS, one in the timer —
 * would let the timer silently start cutting the animation short the moment
 * either side changed.
 */
export const VIEWPORT_TRANSITION_MS = 800;

export interface Renderer {
    init(container: HTMLElement): void;

    renderState(gameState: GameState): void;

    bringGroupToFront(groupId: number): void;

    /** screen = world × scale + offset. */
    setViewportTransform(scale: number, offsetX: number, offsetY: number): void;

    /**
     * Implementations that animate must run for
     * {@link VIEWPORT_TRANSITION_MS}; those that cannot may no-op.
     */
    enableViewportTransition(): void;

    /**
     * Should be called once an animation has completed — which the caller
     * cannot observe, so it waits {@link VIEWPORT_TRANSITION_MS}.
     */
    disableViewportTransition(): void;

    setGroupDragging(groupId: number, dragging: boolean): void;

    flashMergePulse(groupId: number): void;

    setGroupSelected(groupId: number, selected: boolean): void;

    /**
     * Lets PointerRouter classify pointer events without per-piece
     * listeners.
     */
    pieceIdFromTarget(target: EventTarget | null): number | null;

    /**
     * `point` is screen-space. Keeps hit-testing behind the renderer
     * abstraction; implementations that cannot hit-test by point may
     * return null.
     */
    pieceIdAtPoint(point: Point): number | null;

    destroy(): void;
}
