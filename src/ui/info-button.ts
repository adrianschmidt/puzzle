/**
 * Info/Help button — shows credits, project info, and brief help text.
 *
 * Renders a small floating button that, when clicked, opens a modal
 * overlay with credits, project link, license info, and help text.
 */

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
    const { container, onShowInfo } = options;

    const button = document.createElement('button');
    button.className = 'info-button';
    button.textContent = 'ℹ️';
    button.type = 'button';
    button.title = 'Info & Help';

    function handleClick(): void {
        onShowInfo();
    }

    button.addEventListener('click', handleClick);
    container.appendChild(button);

    return () => {
        button.removeEventListener('click', handleClick);
        button.remove();
    };
}