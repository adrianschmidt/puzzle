/**
 * Info/Help button — shows credits, project info, and brief help text.
 *
 * Renders a small floating button that, when clicked, opens a modal
 * overlay with credits, project link, license info, and help text.
 */

import { createToolbarButton } from './toolbar-button.js';

export interface InfoButtonOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Called when the user clicks the info button. */
    onShowInfo: () => void;
}

/**
 * Create and attach the Info button.
 *
 * Returns a cleanup function that removes the button from the DOM.
 */
export function createInfoButton(options: InfoButtonOptions): () => void {
    return createToolbarButton({
        container: options.container,
        className: 'info-button',
        label: 'ℹ️',
        title: 'Info & Help',
        onClick: options.onShowInfo,
    });
}
