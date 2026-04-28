/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the Info button DOM integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInfoButton } from './info-button.js';

describe('createInfoButton', () => {
    let container: HTMLElement;
    let onShowInfo: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        onShowInfo = vi.fn<() => void>();
    });

    it('should add a button to the container', () => {
        createInfoButton({ container, onShowInfo });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
    });

    it('should have the correct class name', () => {
        createInfoButton({ container, onShowInfo });

        const button = container.querySelector('button');
        expect(button!.className).toBe('info-button');
    });

    it('should have type="button"', () => {
        createInfoButton({ container, onShowInfo });

        const button = container.querySelector('button')!;
        expect(button.type).toBe('button');
    });

    it('should call onShowInfo when clicked', () => {
        createInfoButton({ container, onShowInfo });

        const button = container.querySelector('button')!;
        button.click();

        expect(onShowInfo).toHaveBeenCalledOnce();
    });

    it('should call onShowInfo on each click', () => {
        createInfoButton({ container, onShowInfo });

        const button = container.querySelector('button')!;
        button.click();
        button.click();
        button.click();

        expect(onShowInfo).toHaveBeenCalledTimes(3);
    });

    it('should remove button on cleanup', () => {
        const cleanup = createInfoButton({ container, onShowInfo });

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should not respond to clicks after cleanup', () => {
        const cleanup = createInfoButton({ container, onShowInfo });

        const button = container.querySelector('button')!;
        cleanup();

        button.click();

        expect(onShowInfo).not.toHaveBeenCalled();
    });
});
