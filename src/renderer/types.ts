/**
 * Renderer interface — abstraction layer between game logic and rendering.
 *
 * The game engine calls these methods; the implementation decides
 * whether to use DOM/SVG, Canvas, WebGL, etc.
 *
 * The port is not the interface alone: {@link VIEWPORT_TRANSITION_MS} is a
 * runtime value implementations are bound by, for the reason its own doc
 * gives — the caller cannot observe the animation, so the port has to state
 * how long it runs.
 */

import type { GameState, Point } from '../model/types.js';

/**
 * How long the animated viewport transition runs, in milliseconds.
 *
 * Part of the port rather than of one implementation: it is the missing half
 * of {@link Renderer.disableViewportTransition}'s "should be called once an
 * animation has completed". The caller that turns the transition back off
 * cannot see the animation, so the port has to say how long to wait — and
 * `app/viewport-fit.ts` arms a fallback timer against exactly this number.
 * An implementation that animates must animate for this long; one that
 * no-ops the transition (see {@link Renderer.enableViewportTransition}) just
 * settles at the deadline with nothing to wait for.
 *
 * Two literals — one in the CSS, one in the timer — would let the timer
 * silently start cutting the animation short the moment either side changed.
 *
 * A second animation is timed off it too: the completed-group spin in
 * `app/viewport-fit.ts` runs in lockstep with the viewport zoom, which is
 * what makes the two land together. The deadline is conceptually
 * `max(viewport transition, group spin) + grace`; sharing the number is what
 * keeps that max trivial.
 */
export const VIEWPORT_TRANSITION_MS = 800;

/**
 * Renderer interface.
 *
 * Implementations must handle:
 * - Rendering all pieces and groups from game state
 * - Z-order management (bring group to front)
 */
export interface Renderer {
    /** Initialize the renderer inside the given container element. */
    init(container: HTMLElement): void;

    /** Render (or re-render) the full game state. */
    renderState(gameState: GameState): void;

    /** Bring the given group's visual layer to the front (top z-order). */
    bringGroupToFront(groupId: number): void;

    /**
     * Apply a viewport transform (zoom + pan) to the rendering layer.
     * The scale and offset define: screen = world × scale + offset.
     */
    setViewportTransform(scale: number, offsetX: number, offsetY: number): void;

    /**
     * Enable smooth animation of subsequent {@link setViewportTransform}
     * changes. Used for choreographed transitions (e.g. zoom-to-fit on
     * completion). Implementations that animate must run for
     * {@link VIEWPORT_TRANSITION_MS}; those that cannot may no-op.
     */
    enableViewportTransition(): void;

    /**
     * Disable viewport transitions so subsequent transform changes apply
     * immediately. Should be called once an animation has completed — which
     * the caller cannot observe, so it waits {@link VIEWPORT_TRANSITION_MS}.
     */
    disableViewportTransition(): void;

    /**
     * Mark a group as being dragged (visual feedback like lifted shadow).
     * Pass `false` to remove the dragging state.
     */
    setGroupDragging(groupId: number, dragging: boolean): void;

    /**
     * Play a brief visual pulse on a group after a merge.
     * Used to give satisfying feedback when pieces snap together.
     */
    flashMergePulse(groupId: number): void;

    /**
     * Mark a group as selected (visual highlight for multi-select tool).
     * Pass `false` to remove the selection highlight.
     */
    setGroupSelected(groupId: number, selected: boolean): void;

    /**
     * Recover a piece id from a DOM event target. Returns null when the
     * target is not part of any rendered piece. Used by PointerRouter to
     * classify pointer events without per-piece listeners.
     */
    pieceIdFromTarget(target: EventTarget | null): number | null;

    /**
     * Recover the id of the piece rendered at a screen-space point, or null
     * when no piece is there. Lets the interaction layer probe for pieces
     * near a pointer without reaching into the DOM itself — keeping
     * hit-testing behind the renderer abstraction. Implementations that
     * cannot hit-test by point may return null.
     */
    pieceIdAtPoint(point: Point): number | null;

    /** Clean up all DOM/resources created by this renderer. */
    destroy(): void;
}
