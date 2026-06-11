/**
 * Marquee tool toggle button — placed below the multi-select button.
 *
 * Toggles the marquee (drag-box) gesture. Enabling it also enables
 * multi-select, since a marquee builds a multi-select selection (see
 * SelectionManager.toggleMarquee). While the desktop Shift key is held the
 * button lights up to show that the Shift+drag shortcut will marquee, even
 * when the toggle itself is off; the hint clears when Shift is released.
 */

import type { SelectionManager } from '../interaction/selection-manager.js';

export interface MarqueeToolButtonOptions {
    container: HTMLElement;
    selectionManager: SelectionManager;
}

/**
 * Create and attach the marquee-tool toggle button.
 * Returns a cleanup function.
 */
export function createMarqueeToolButton(
    options: MarqueeToolButtonOptions,
): () => void {
    const { container, selectionManager } = options;

    const button = document.createElement('button');
    button.className = 'marquee-tool-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Marquee selection tool');
    button.setAttribute('aria-pressed', 'false');

    // Dashed selection-rectangle icon (SVG)
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 3">
      <rect x="3" y="3" width="18" height="18" rx="1.5"/>
    </svg>`;

    // True while Shift is held — a transient hint that the Shift+drag
    // shortcut will marquee, shown even when the toggle is off.
    let shiftHint = false;

    function updateVisuals(): void {
        const active = selectionManager.marqueeActive;
        button.classList.toggle('marquee-tool-button--active', active || shiftHint);
        // aria-pressed reflects the real persistent toggle, not the
        // transient Shift hint.
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function handleClick(): void {
        selectionManager.toggleMarquee();
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'Shift' || shiftHint) return;
        shiftHint = true;
        updateVisuals();
    }

    function handleKeyUp(e: KeyboardEvent): void {
        if (e.key !== 'Shift' || !shiftHint) return;
        shiftHint = false;
        updateVisuals();
    }

    function handleBlur(): void {
        // A focus loss (e.g. Cmd+Tab) can swallow the keyup; clear the hint
        // so the button doesn't stay falsely lit.
        if (!shiftHint) return;
        shiftHint = false;
        updateVisuals();
    }

    button.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    const unsubscribe = selectionManager.onMarqueeActiveChange(updateVisuals);
    updateVisuals();
    container.appendChild(button);

    return () => {
        unsubscribe();
        button.removeEventListener('click', handleClick);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('blur', handleBlur);
        button.remove();
    };
}
