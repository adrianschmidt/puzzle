/**
 * Deselect-all floating button — appears at bottom-center when
 * pieces are selected. Round, semi-transparent, with an ✕ icon.
 *
 * Pressing it clears the selection but does NOT deactivate the tool.
 */

import type { SelectionManager } from '../interaction/selection-manager.js';

export interface DeselectButtonOptions {
    container: HTMLElement;
    selectionManager: SelectionManager;
}

/**
 * Create the deselect-all button (hidden by default).
 * Returns a cleanup function.
 */
export function createDeselectButton(
    options: DeselectButtonOptions,
): () => void {
    const { container, selectionManager } = options;

    const button = document.createElement('button');
    button.className = 'deselect-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Deselect all pieces');

    // ✕ icon
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;

    // Start hidden
    button.style.display = 'none';

    function updateVisibility(): void {
        if (selectionManager.hasSelection) {
            button.style.display = '';
        } else {
            button.style.display = 'none';
        }
    }

    function handleClick(): void {
        selectionManager.clearAll();
        // updateVisibility will be called via the onChange listener
    }

    button.addEventListener('click', handleClick);

    const removeListener = selectionManager.onChange(() => {
        updateVisibility();
    });

    container.appendChild(button);

    return () => {
        button.removeEventListener('click', handleClick);
        removeListener();
        button.remove();
    };
}
