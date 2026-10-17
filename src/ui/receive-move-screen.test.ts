/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createReceiveMoveScreen } from './receive-move-screen.js';

describe('createReceiveMoveScreen', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.replaceChildren(container);
    });

    it('shows a receiving message with no buttons', () => {
        createReceiveMoveScreen(container);
        expect(container.querySelector('.move-body')?.textContent).toBe('Receiving your puzzle…');
        expect(container.querySelectorAll('button')).toHaveLength(0);
    });

    it('cannot be dismissed with Escape', () => {
        createReceiveMoveScreen(container);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(container.querySelector('.move-dialog')).not.toBeNull();
    });

    it('showMessage replaces the text and offers Continue', () => {
        const onContinue = vi.fn();
        createReceiveMoveScreen(container).showMessage('Nothing arrived.', onContinue);
        expect(container.querySelector('.move-body')?.textContent).toBe('Nothing arrived.');
        const button = container.querySelector<HTMLButtonElement>('.move-btn--primary')!;
        expect(button.textContent).toBe('Continue to Puzzle');
        button.click();
        expect(onContinue).toHaveBeenCalledTimes(1);
    });
});
