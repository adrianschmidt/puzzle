/**
 * Generic helper for creating a floating toolbar button.
 *
 * Wraps the small amount of boilerplate shared by simple toolbar buttons:
 * create the element, set className/textContent/type/title, attach a click
 * listener, append to a container, and return a cleanup function that
 * removes both the listener and the element.
 *
 * Buttons that own their own state (selection-driven visibility, paired
 * controls, confirm dialogs, etc.) should not use this helper — they
 * have responsibilities beyond what it covers.
 */

export interface ToolbarButtonOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** CSS class name for the button. */
    className: string;
    /** Visible text inside the button (set as textContent). */
    label: string;
    /** Optional native tooltip (title attribute). */
    title?: string;
    /** Called when the user clicks the button. */
    onClick: () => void;
}

/**
 * Create and attach a toolbar button.
 *
 * Returns a cleanup function that removes the click listener and the
 * button from the DOM.
 */
export function createToolbarButton(options: ToolbarButtonOptions): () => void {
    const { container, className, label, title, onClick } = options;

    const button = document.createElement('button');
    button.className = className;
    button.textContent = label;
    button.type = 'button';
    if (title !== undefined) {
        button.title = title;
    }

    button.addEventListener('click', onClick);
    container.appendChild(button);

    return () => {
        button.removeEventListener('click', onClick);
        button.remove();
    };
}
