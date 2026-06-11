/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Marquee-tool toggle button DOM integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMarqueeToolButton } from './marquee-tool-button.js';
import { SelectionManager } from '../interaction/selection-manager.js';

function pressShift(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
}

function releaseShift(): void {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
}

describe('createMarqueeToolButton', () => {
    let container: HTMLElement;
    let selectionManager: SelectionManager;

    beforeEach(() => {
        container = document.createElement('div');
        selectionManager = new SelectionManager();
    });

    it('adds a button with the correct class and type', () => {
        createMarqueeToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button).not.toBeNull();
        expect(button.className).toBe('marquee-tool-button');
        expect(button.type).toBe('button');
    });

    it('starts inactive', () => {
        createMarqueeToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(button.classList.contains('marquee-tool-button--active')).toBe(false);
    });

    it('toggles the marquee (and multi-select) when clicked', () => {
        createMarqueeToolButton({ container, selectionManager });
        const button = container.querySelector('button')!;

        button.click();
        expect(selectionManager.marqueeActive).toBe(true);
        expect(selectionManager.toolActive).toBe(true);

        button.click();
        expect(selectionManager.marqueeActive).toBe(false);
        // Disabling the marquee leaves multi-select on.
        expect(selectionManager.toolActive).toBe(true);
    });

    it('reflects marquee-active state in aria-pressed and active class', () => {
        createMarqueeToolButton({ container, selectionManager });
        const button = container.querySelector('button')!;

        selectionManager.toggleMarquee();
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.classList.contains('marquee-tool-button--active')).toBe(true);

        selectionManager.toggleMarquee();
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(button.classList.contains('marquee-tool-button--active')).toBe(false);
    });

    it('reflects initial active state when marquee is already on', () => {
        selectionManager.toggleMarquee();
        createMarqueeToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.classList.contains('marquee-tool-button--active')).toBe(true);
    });

    it('lights up while Shift is held (toggle off), then goes dark on release', () => {
        createMarqueeToolButton({ container, selectionManager });
        const button = container.querySelector('button')!;

        pressShift();
        // Lit, but the real toggle is still off (aria-pressed stays false).
        expect(button.classList.contains('marquee-tool-button--active')).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('false');

        releaseShift();
        expect(button.classList.contains('marquee-tool-button--active')).toBe(false);
    });

    it('Shift makes no difference when the marquee is already on', () => {
        selectionManager.toggleMarquee();
        createMarqueeToolButton({ container, selectionManager });
        const button = container.querySelector('button')!;

        pressShift();
        expect(button.classList.contains('marquee-tool-button--active')).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('true');

        releaseShift();
        // Still lit — the toggle is on, independent of Shift.
        expect(button.classList.contains('marquee-tool-button--active')).toBe(true);
        expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('removes the button and stops responding after cleanup', () => {
        const cleanup = createMarqueeToolButton({ container, selectionManager });
        const button = container.querySelector('button')!;

        cleanup();
        expect(container.querySelector('button')).toBeNull();

        // Neither marquee-active changes nor Shift restyle the detached button.
        selectionManager.toggleMarquee();
        pressShift();
        expect(button.classList.contains('marquee-tool-button--active')).toBe(false);
    });
});
