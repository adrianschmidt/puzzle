/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Deselect-all button DOM integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDeselectButton } from './deselect-button.js';
import { SelectionManager } from '../interaction/selection-manager.js';

describe('createDeselectButton', () => {
    let container: HTMLElement;
    let selectionManager: SelectionManager;

    beforeEach(() => {
        container = document.createElement('div');
        selectionManager = new SelectionManager();
    });

    it('should add a button to the container', () => {
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
    });

    it('should have the correct class name', () => {
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button');
        expect(button!.className).toBe('deselect-button');
    });

    it('should have type="button"', () => {
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.type).toBe('button');
    });

    it('should be hidden when nothing is selected', () => {
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        expect(button.style.display).toBe('none');
    });

    it('should become visible when a group is selected', () => {
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        selectionManager.select(1);

        expect(button.style.display).toBe('');
    });

    it('should hide again when selection is cleared', () => {
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        selectionManager.select(1);
        expect(button.style.display).toBe('');

        selectionManager.clearAll();
        expect(button.style.display).toBe('none');
    });

    it('should clear the selection when clicked', () => {
        selectionManager.select(1);
        selectionManager.select(2);
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        button.click();

        expect(selectionManager.hasSelection).toBe(false);
    });

    it('should not deactivate the tool when clicked', () => {
        selectionManager.toolActive = true;
        selectionManager.select(1);
        createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        button.click();

        expect(selectionManager.toolActive).toBe(true);
    });

    it('should remove button on cleanup', () => {
        const cleanup = createDeselectButton({ container, selectionManager });

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should unsubscribe from selection changes on cleanup', () => {
        const cleanup = createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        cleanup();

        // Subsequent changes must not re-style the detached button.
        selectionManager.select(1);

        expect(button.style.display).toBe('none');
    });

    it('should not clear selection after cleanup', () => {
        selectionManager.select(1);
        const cleanup = createDeselectButton({ container, selectionManager });

        const button = container.querySelector('button')!;
        cleanup();

        button.click();

        expect(selectionManager.hasSelection).toBe(true);
    });
});
