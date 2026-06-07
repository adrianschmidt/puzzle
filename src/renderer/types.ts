/**
 * Renderer interface — abstraction layer between game logic and rendering.
 *
 * The game engine calls these methods; the implementation decides
 * whether to use DOM/SVG, Canvas, WebGL, etc.
 */

import type { GameState, Point } from '../model/types.js';

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
     * completion). Implementations that cannot animate may no-op.
     */
    enableViewportTransition(): void;

    /**
     * Disable viewport transitions so subsequent transform changes apply
     * immediately. Should be called once an animation has completed.
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
