/**
 * Select tool toggle button — placed in the top-left corner.
 *
 * When active, tapping a piece selects/deselects its group.
 * The button stays active until pressed again.
 */

import type { SelectionManager } from '../interaction/selection-manager.js';

export interface SelectToolButtonOptions {
    container: HTMLElement;
    selectionManager: SelectionManager;
}

/**
 * Create and attach the select-tool toggle button.
 * Returns a cleanup function.
 */
export function createSelectToolButton(
    options: SelectToolButtonOptions,
): () => void {
    const { container, selectionManager } = options;

    const button = document.createElement('button');
    button.className = 'select-tool-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Multi-select tool');
    button.setAttribute('aria-pressed', 'false');

    // Lasso/selection icon (SVG)
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 3C4.239 3 2 5.216 2 8c0 2.784 2.239 5 5 5h10c2.761 0 5-2.216 5-5s-2.239-5-5-5H7z"/>
      <path d="M2 8v5c0 2.784 2.239 5 5 5"/>
      <line x1="7" y1="18" x2="7" y2="22"/>
      <line x1="5" y1="22" x2="9" y2="22"/>
    </svg>`;

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
        updateVisuals();
    }

    button.addEventListener('click', handleClick);
    container.appendChild(button);

    return () => {
        button.removeEventListener('click', handleClick);
        button.remove();
    };
}
