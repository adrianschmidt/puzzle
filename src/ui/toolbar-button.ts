/**
 * Buttons that own their own state (selection-driven visibility, paired
 * controls, confirm dialogs, etc.) should not use this helper — they
 * have responsibilities beyond what it covers.
 */

export interface ToolbarButtonOptions {
    container: HTMLElement;
    className: string;
    label: string;
    title?: string;
    onClick: () => void;
}

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
