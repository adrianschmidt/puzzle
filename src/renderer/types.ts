/**
 * Renderer interface — abstraction layer between game logic and rendering.
 *
 * The game engine calls these methods; the implementation decides
 * whether to use DOM/SVG, Canvas, WebGL, etc.
 */

import type { GameState } from '../model/types.js';

/** Callback fired when a piece receives a pointer-down event. */
export type PiecePointerDownCallback = (
    pieceId: number,
    event: PointerEvent,
) => void;

/**
 * Renderer interface.
 *
 * Implementations must handle:
 * - Rendering all pieces and groups from game state
 * - Forwarding pointer events on pieces to registered callbacks
 * - Z-order management (bring group to front)
 */
export interface Renderer {
    /** Initialize the renderer inside the given container element. */
    init(container: HTMLElement): void;

    /** Render (or re-render) the full game state. */
    renderState(gameState: GameState): void;

    /**
     * Register a callback for pointer-down events on pieces.
     * The callback receives the piece id and the original pointer event.
     */
    onPiecePointerDown(callback: PiecePointerDownCallback): void;

    /** Bring the given group's visual layer to the front (top z-order). */
    bringGroupToFront(groupId: number): void;

    /**
     * Apply a viewport transform (zoom + pan) to the rendering layer.
     * The scale and offset define: screen = world × scale + offset.
     */
    setViewportTransform(scale: number, offsetX: number, offsetY: number): void;

    /**
     * Returns the table element (the rendering surface).
     * Used by the viewport controller to check if pointer events
     * hit piece elements vs empty space.
     */
    getTableElement(): HTMLElement | null;

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

    /** Clean up all DOM/resources created by this renderer. */
    destroy(): void;
}
