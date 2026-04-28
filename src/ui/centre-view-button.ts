/**
 * Centre View button — resets the viewport to the default
 * centred view (no pan, no zoom).
 *
 * Useful after zooming/panning around to quickly get back
 * to a known orientation.
 */

import { createToolbarButton } from './toolbar-button.js';

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
    return createToolbarButton({
        container: options.container,
        className: 'centre-view-button',
        label: 'Centre View',
        onClick: options.onCentreView,
    });
}
