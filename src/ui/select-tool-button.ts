import type { SelectionManager } from '../interaction/selection-manager.js';
import { createSelectToolIcon } from './tool-icons.js';

export interface SelectToolButtonOptions {
    container: HTMLElement;
    selectionManager: SelectionManager;
}

export function createSelectToolButton(
    options: SelectToolButtonOptions,
): () => void {
    const { container, selectionManager } = options;

    const button = document.createElement('button');
    button.className = 'select-tool-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Multi-select tool');
    button.setAttribute('aria-pressed', 'false');

    button.appendChild(createSelectToolIcon());

    function updateVisuals(): void {
        if (selectionManager.toolActive) {
            button.classList.add('select-tool-button--active');
            button.setAttribute('aria-pressed', 'true');
        } else {
            button.classList.remove('select-tool-button--active');
            button.setAttribute('aria-pressed', 'false');
        }
    }

    function handleClick(): void {
        selectionManager.toggleTool();
    }

    button.addEventListener('click', handleClick);
    const unsubscribe = selectionManager.onToolActiveChange(updateVisuals);
    updateVisuals();
    container.appendChild(button);

    return () => {
        unsubscribe();
        button.removeEventListener('click', handleClick);
        button.remove();
    };
}
