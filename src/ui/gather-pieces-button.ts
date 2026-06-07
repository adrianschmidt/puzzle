/**
 * Gather Pieces button — brings all groups together to the center
 * of the visible play area.
 *
 * When pieces are scattered widely (especially after zooming out),
 * this collects them into a manageable area without changing their
 * groupings.
 */

import { createToolbarButton } from './toolbar-button.js';

export interface GatherPiecesButtonOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Called when the user clicks the button. */
    onGatherPieces: () => void;
}

/**
 * Create and attach the Gather Pieces button.
 *
 * Returns a cleanup function that removes the button from the DOM.
 */
export function createGatherPiecesButton(
    options: GatherPiecesButtonOptions,
): () => void {
    return createToolbarButton({
        container: options.container,
        className: 'gather-pieces-button',
        label: 'Gather Pieces',
        onClick: options.onGatherPieces,
    });
}
