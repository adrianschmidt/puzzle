/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    showLoadingOverlay,
    hideLoadingOverlay,
    yieldForPaint,
} from './loading-overlay.js';

describe('loading-overlay', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('showLoadingOverlay appends an overlay with the given text', () => {
        showLoadingOverlay('Building puzzle…');
        const overlay = document.body.querySelector('.loading-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay!.querySelector('.loading-overlay__text')!.textContent).toBe('Building puzzle…');
    });

    it('showLoadingOverlay is idempotent — only one overlay, text updated on repeat calls', () => {
        showLoadingOverlay('First');
        showLoadingOverlay('Second');
        const overlays = document.body.querySelectorAll('.loading-overlay');
        expect(overlays.length).toBe(1);
        expect(overlays[0].querySelector('.loading-overlay__text')!.textContent).toBe('Second');
    });

    it('showLoadingOverlay adopts a pre-rendered overlay from the HTML template', () => {
        const existing = document.createElement('div');
        existing.className = 'loading-overlay';
        const spinner = document.createElement('div');
        spinner.className = 'loading-overlay__spinner';
        const text = document.createElement('div');
        text.className = 'loading-overlay__text';
        text.textContent = 'From template';
        existing.appendChild(spinner);
        existing.appendChild(text);
        document.body.appendChild(existing);

        showLoadingOverlay('Updated');
        const overlays = document.body.querySelectorAll('.loading-overlay');
        expect(overlays.length).toBe(1);
        expect(overlays[0].querySelector('.loading-overlay__text')!.textContent).toBe('Updated');
    });

    it('hideLoadingOverlay removes the overlay from the DOM', () => {
        showLoadingOverlay('x');
        hideLoadingOverlay();
        expect(document.body.querySelector('.loading-overlay')).toBeNull();
    });

    it('hideLoadingOverlay is a no-op when no overlay exists', () => {
        expect(() => hideLoadingOverlay()).not.toThrow();
    });

    it('yieldForPaint resolves', async () => {
        await expect(yieldForPaint()).resolves.toBeUndefined();
    });
});
