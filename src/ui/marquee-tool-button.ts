/**
 * Enabling the marquee also enables multi-select (a marquee builds a
 * multi-select selection; see SelectionManager.toggleMarquee).
 */

import type { SelectionManager } from '../interaction/selection-manager.js';
import { createMarqueeToolIcon } from './tool-icons.js';

export interface MarqueeToolButtonOptions {
    container: HTMLElement;
    selectionManager: SelectionManager;
}

export function createMarqueeToolButton(
    options: MarqueeToolButtonOptions,
): () => void {
    const { container, selectionManager } = options;

    const button = document.createElement('button');
    button.className = 'marquee-tool-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Marquee selection tool');
    button.setAttribute('aria-pressed', 'false');

    button.appendChild(createMarqueeToolIcon());

    // Purely cosmetic Shift observation, deliberately independent of the
    // authoritative gesture read (evt.shiftKey in setupInteraction). The two can
    // momentarily disagree (harmless: the gesture decides, this only lights it).
    let shiftHint = false;

    function updateVisuals(): void {
        const active = selectionManager.marqueeActive;
        button.classList.toggle('marquee-tool-button--active', active || shiftHint);
        // aria-pressed reflects the real persistent toggle, not the transient Shift hint.
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
