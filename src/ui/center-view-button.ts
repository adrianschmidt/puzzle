/**
 * Center View button — resets the viewport to the default
 * centered view (no pan, no zoom).
 *
 * Useful after zooming/panning around to quickly get back
 * to a known orientation.
 */

import { createToolbarButton } from './toolbar-button.js';

export interface CenterViewButtonOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Called when the user clicks the button. */
    onCenterView: () => void;
}

/**
 * Create and attach the Center View button.
 *
 * Returns a cleanup function that removes the button from the DOM.
 */
export function createCenterViewButton(
    options: CenterViewButtonOptions,
): () => void {
    return createToolbarButton({
        container: options.container,
        className: 'center-view-button',
        label: 'Centre View',
        onClick: options.onCenterView,
    });
}
