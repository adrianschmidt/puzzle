/**
 * Gather Pieces button — brings all groups together to the centre
 * of the visible play area.
 *
 * When pieces are scattered widely (especially after zooming out),
 * this collects them into a manageable area without changing their
 * groupings.
 */

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
    const { container, onGatherPieces } = options;

    const button = document.createElement('button');
    button.className = 'gather-pieces-button';
    button.textContent = 'Gather Pieces';
    button.type = 'button';

    function handleClick(): void {
        onGatherPieces();
    }

    button.addEventListener('click', handleClick);
    container.appendChild(button);

    return () => {
        button.removeEventListener('click', handleClick);
        button.remove();
    };
}
