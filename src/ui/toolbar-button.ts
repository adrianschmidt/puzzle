/**
 * For simple stateless buttons only — buttons owning their own state (visibility,
 * paired controls, confirm dialogs) need more than this helper covers.
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
