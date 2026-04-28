/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the generic toolbar button helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolbarButton } from './toolbar-button.js';

describe('createToolbarButton', () => {
    let container: HTMLElement;
    let onClick: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        onClick = vi.fn<() => void>();
    });

    it('should append a button to the container', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
    });

    it('should set the className', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button')!;
        expect(button.className).toBe('demo-button');
    });

    it('should set textContent from label', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo Label',
            onClick,
        });

        const button = container.querySelector('button')!;
        expect(button.textContent).toBe('Demo Label');
    });

    it('should set type="button"', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button')!;
        expect(button.type).toBe('button');
    });

    it('should set the title when provided', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            title: 'Demo tooltip',
            onClick,
        });

        const button = container.querySelector('button')!;
        expect(button.title).toBe('Demo tooltip');
    });

    it('should leave title empty when not provided', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button')!;
        expect(button.title).toBe('');
    });

    it('should call onClick when clicked', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button')!;
        button.click();

        expect(onClick).toHaveBeenCalledOnce();
    });

    it('should call onClick on each click', () => {
        createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button')!;
        button.click();
        button.click();
        button.click();

        expect(onClick).toHaveBeenCalledTimes(3);
    });

    it('should remove button on cleanup', () => {
        const cleanup = createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        expect(container.querySelector('button')).not.toBeNull();

        cleanup();

        expect(container.querySelector('button')).toBeNull();
    });

    it('should not respond to clicks after cleanup', () => {
        const cleanup = createToolbarButton({
            container,
            className: 'demo-button',
            label: 'Demo',
            onClick,
        });

        const button = container.querySelector('button')!;
        cleanup();

        // Button is detached but click would still fire if listener remained
        button.click();

        expect(onClick).not.toHaveBeenCalled();
    });
});
