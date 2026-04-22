/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { attachShareSection } from './share-section.js';
import type { GameState } from '../model/types.js';

function state(overrides: Partial<GameState> = {}): GameState {
    return {
        pieces: [],
        groups: [
            { id: 0, pieces: new Map([[0, { x: 0, y: 0 }]]),
              position: { x: 0, y: 0 }, rotation: 0 },
        ],
        imageUrl: 'blank',
        imageSize: { width: 1080, height: 720 },
        gridSize: { cols: 4, rows: 3 },
        completed: false,
        seed: 1,
        cutStyle: 'classic',
        rotationMode: 'none',
        ...overrides,
    };
}

describe('attachShareSection', () => {
    let host: HTMLElement;
    beforeEach(() => {
        host = document.createElement('div');
        document.body.replaceChildren(host);
    });

    it('renders a heading, checkbox, primary button, and URL preview', () => {
        attachShareSection(host, state(), 'https://example.com/');
        expect(host.querySelector('h3')?.textContent).toBe('Share this puzzle');
        expect(host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')).not.toBeNull();
        expect(host.querySelector<HTMLButtonElement>('[data-testid="share-primary-btn"]')).not.toBeNull();
        expect(host.querySelector<HTMLElement>('[data-testid="share-url-preview"]')).not.toBeNull();
    });

    it('disables the progress checkbox when no pieces are merged', () => {
        attachShareSection(host, state(), 'https://example.com/');
        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        expect(cb.disabled).toBe(true);
        expect(host.querySelector('[data-testid="share-progress-hint"]')?.textContent)
            .toMatch(/Make some progress/i);
    });

    it('disables the progress checkbox when the puzzle is complete', () => {
        const s = state({ completed: true });
        attachShareSection(host, s, 'https://example.com/');
        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        expect(cb.disabled).toBe(true);
        expect(host.querySelector('[data-testid="share-progress-hint"]')?.textContent)
            .toMatch(/already complete/i);
    });

    it('enables the checkbox when there is progress', () => {
        const s = state({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
                { id: 2, pieces: new Map([[2, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        attachShareSection(host, s, 'https://example.com/');
        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        expect(cb.disabled).toBe(false);
    });

    it('updates the URL preview when the checkbox toggles', () => {
        const s = state({
            groups: [
                { id: 0, pieces: new Map([[0, { x: 0, y: 0 }], [1, { x: 0, y: 0 }]]),
                  position: { x: 0, y: 0 }, rotation: 0 },
            ],
        });
        attachShareSection(host, s, 'https://example.com/');
        const preview = host.querySelector<HTMLElement>('[data-testid="share-url-preview"]')!;
        const urlBefore = preview.textContent!;

        const cb = host.querySelector<HTMLInputElement>('[data-testid="share-include-progress"]')!;
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));

        const urlAfter = preview.textContent!;
        expect(urlAfter).not.toBe(urlBefore);
        expect(urlAfter.length).toBeGreaterThan(urlBefore.length);
    });

    it('primary button label is "Share…" if navigator.share is available, else "Copy link"', () => {
        const originalNav = globalThis.navigator;
        try {
            Object.defineProperty(globalThis, 'navigator', {
                value: { share: () => {} }, configurable: true,
            });
            attachShareSection(host, state(), 'https://example.com/');
            expect(host.querySelector<HTMLButtonElement>('[data-testid="share-primary-btn"]')!.textContent)
                .toMatch(/Share/);
        } finally {
            Object.defineProperty(globalThis, 'navigator', { value: originalNav, configurable: true });
        }
    });
});
