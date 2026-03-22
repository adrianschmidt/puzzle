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

    /** Clean up all DOM/resources created by this renderer. */
    destroy(): void;
}
