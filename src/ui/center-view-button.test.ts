/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Center View button DOM integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCenterViewButton } from './center-view-button.js';

describe('createCenterViewButton', () => {
    let container: HTMLElement;
    let onCenterView: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        onCenterView = vi.fn<() => void>();
    });

    it('should add a button to the container', () => {
        createCenterViewButton({ container, onCenterView });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe('Centre View');
    });

    it('should have the correct class name', () => {
        createCenterViewButton({ container, onCenterView });

        const button = container.querySelector('button');
        expect(button!.className).toBe('center-view-button');
    });

    it('should call onCenterView when clicked', () => {
        createCenterViewButton({ container, onCenterView });

        const button = container.querySelector('button')!;
        button.click();

        expect(onCenterView).toHaveBeenCalledOnce();
    });

    it('should call onCenterView on each click', () => {
        createCenterViewButton({ container, onCenterView });

        const button = container.querySelector('button')!;
        button.click();
        button.click();
        button.click();

        expect(onCenterView).toHaveBeenCalledTimes(3);
    });

    it('should remove button on cleanup', () => {
        const cleanup = createCenterViewButton({ container, onCenterView });

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should not respond to clicks after cleanup', () => {
        const cleanup = createCenterViewButton({ container, onCenterView });

        const button = container.querySelector('button')!;
        cleanup();

        // Button was removed, but simulate a click on the detached element
        button.click();

        expect(onCenterView).not.toHaveBeenCalled();
    });
});
