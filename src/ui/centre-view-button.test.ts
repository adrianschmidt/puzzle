/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Centre View button DOM integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCentreViewButton } from './centre-view-button.js';

describe('createCentreViewButton', () => {
    let container: HTMLElement;
    let onCentreView: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        onCentreView = vi.fn<() => void>();
    });

    it('should add a button to the container', () => {
        createCentreViewButton({ container, onCentreView });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe('Centre View');
    });

    it('should have the correct class name', () => {
        createCentreViewButton({ container, onCentreView });

        const button = container.querySelector('button');
        expect(button!.className).toBe('centre-view-button');
    });

    it('should call onCentreView when clicked', () => {
        createCentreViewButton({ container, onCentreView });

        const button = container.querySelector('button')!;
        button.click();

        expect(onCentreView).toHaveBeenCalledOnce();
    });

    it('should call onCentreView on each click', () => {
        createCentreViewButton({ container, onCentreView });

        const button = container.querySelector('button')!;
        button.click();
        button.click();
        button.click();

        expect(onCentreView).toHaveBeenCalledTimes(3);
    });

    it('should remove button on cleanup', () => {
        const cleanup = createCentreViewButton({ container, onCentreView });

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should not respond to clicks after cleanup', () => {
        const cleanup = createCentreViewButton({ container, onCentreView });

        const button = container.querySelector('button')!;
        cleanup();

        // Button was removed, but simulate a click on the detached element
        button.click();

        expect(onCentreView).not.toHaveBeenCalled();
    });
});
