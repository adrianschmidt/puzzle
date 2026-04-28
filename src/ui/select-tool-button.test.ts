/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Select-tool toggle button DOM integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSelectToolButton } from './select-tool-button.js';
import { SelectionManager } from '../interaction/selection-manager.js';

describe('createSelectToolButton', () => {
    let container: HTMLElement;
    let selectionManager: SelectionManager;

    beforeEach(() => {
        container = document.createElement('div');
        selectionManager = new SelectionManager();
    });

    it('should add a button to the container', () => {
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
    });

    it('should have the correct class name', () => {
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button');
        expect(button!.className).toBe('select-tool-button');
    });

    it('should have type="button"', () => {
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.type).toBe('button');
    });

    it('should start with aria-pressed="false" when tool is inactive', () => {
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(
            button.classList.contains('select-tool-button--active'),
        ).toBe(false);
    });

    it('should toggle the tool when clicked', () => {
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(selectionManager.toolActive).toBe(false);

        button.click();
        expect(selectionManager.toolActive).toBe(true);

        button.click();
        expect(selectionManager.toolActive).toBe(false);
    });

    it('should reflect tool-active state in aria-pressed and active class', () => {
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;

        selectionManager.toolActive = true;
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(
            button.classList.contains('select-tool-button--active'),
        ).toBe(true);

        selectionManager.toolActive = false;
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(
            button.classList.contains('select-tool-button--active'),
        ).toBe(false);
    });

    it('should reflect initial active state when tool is already on', () => {
        selectionManager.toolActive = true;
        createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(
            button.classList.contains('select-tool-button--active'),
        ).toBe(true);
    });

    it('should remove button on cleanup', () => {
        const cleanup = createSelectToolButton({ container, selectionManager });

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should unsubscribe from tool-active changes on cleanup', () => {
        const cleanup = createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        cleanup();

        // After cleanup, further state changes must not re-style the
        // (now detached) button.
        selectionManager.toolActive = true;

        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(
            button.classList.contains('select-tool-button--active'),
        ).toBe(false);
    });

    it('should not toggle the tool after cleanup', () => {
        const cleanup = createSelectToolButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        cleanup();

        button.click();

        expect(selectionManager.toolActive).toBe(false);
    });
});
