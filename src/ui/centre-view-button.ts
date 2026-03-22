/**
 * Centre View button — resets the viewport to the default
 * centred view (no pan, no zoom).
 *
 * Useful after zooming/panning around to quickly get back
 * to a known orientation.
 */

export interface CentreViewButtonOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Called when the user clicks the button. */
    onCentreView: () => void;
}

/**
 * Create and attach the Centre View button.
 *
 * Returns a cleanup function that removes the button from the DOM.
 */
export function createCentreViewButton(
    options: CentreViewButtonOptions,
): () => void {
    const { container, onCentreView } = options;

    const button = document.createElement('button');
    button.className = 'centre-view-button';
    button.textContent = 'Centre View';
    button.type = 'button';

    function handleClick(): void {
        onCentreView();
    }

    button.addEventListener('click', handleClick);
    container.appendChild(button);

    return () => {
        button.removeEventListener('click', handleClick);
        button.remove();
    };
}
