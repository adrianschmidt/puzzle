/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from './toast.js';

describe('showToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.replaceChildren();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('appends a toast element to the document body', () => {
        showToast('Hello');
        const toast = document.querySelector('.app-toast');
        expect(toast).not.toBeNull();
        expect(toast!.textContent).toBe('Hello');
    });

    it('auto-dismisses after the default timeout', () => {
        showToast('Bye');
        vi.advanceTimersByTime(1_900);
        expect(document.querySelector('.app-toast')).not.toBeNull();
        vi.advanceTimersByTime(500);
        expect(document.querySelector('.app-toast')).toBeNull();
    });

    it('replaces any existing toast so two calls stack cleanly', () => {
        showToast('First');
        showToast('Second');
        const toasts = document.querySelectorAll('.app-toast');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toBe('Second');
    });
});
