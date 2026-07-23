/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the new-game dialog's image picker section.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createImagePicker, type CandidateImage } from './image-picker.js';

function makeCandidate(n: number): CandidateImage {
    return {
        imageUrl: `https://images.unsplash.com/photo-${n}?w=1080`,
        thumbUrl: `https://images.unsplash.com/photo-${n}?w=400`,
        imageSize: { width: 1080, height: 720 },
        attribution: {
            photographerName: `Photographer ${n}`,
            photographerUrl: `https://unsplash.com/@p${n}`,
            photoUrl: `https://unsplash.com/photos/${n}`,
        },
        downloadLocation: `https://api.unsplash.com/photos/${n}/download`,
        description: `photo ${n}`,
    };
}

/** Flush pending microtasks so a resolved fetch promise applies. */
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('createImagePicker', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('renders heading, four tiles, refresh, and both action buttons', () => {
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue([]),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);

        expect(container.querySelector('.size-picker-subtitle')?.textContent)
            .toBe('Pick an image to start');
        expect(container.querySelectorAll('[data-testid="image-picker-tile"]')).toHaveLength(4);
        expect(container.querySelector('[data-testid="image-picker-refresh"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="image-picker-surprise"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="image-picker-blank"]')).not.toBeNull();
    });

    it('fetches candidates on creation and shows loading tiles meanwhile', () => {
        const fetchCandidates = vi.fn().mockReturnValue(new Promise(() => {}));
        const picker = createImagePicker({ fetchCandidates, onPick: vi.fn() });
        container.appendChild(picker.element);

        expect(fetchCandidates).toHaveBeenCalledOnce();
        const tiles = container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]');
        for (const tile of tiles) {
            expect(tile.disabled).toBe(true);
            expect(tile.classList.contains('image-picker-tile--loading')).toBe(true);
        }
    });

    it('renders thumbnails and enables tiles once candidates arrive', async () => {
        const candidates = [1, 2, 3, 4].map(makeCandidate);
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue(candidates),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);
        await flush();

        const imgs = container.querySelectorAll<HTMLImageElement>('.image-picker-thumb');
        expect(imgs).toHaveLength(4);
        expect(imgs[0].src).toBe('https://images.unsplash.com/photo-1?w=400');
        expect(imgs[0].alt).toBe('photo 1');
        const tiles = container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]');
        expect(tiles[0].disabled).toBe(false);
    });

    it('hides surplus tiles when fewer candidates than tiles arrive', async () => {
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue([makeCandidate(1), makeCandidate(2)]),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);
        await flush();

        const tiles = container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]');
        expect(tiles[1].hidden).toBe(false);
        expect(tiles[2].hidden).toBe(true);
        expect(tiles[3].hidden).toBe(true);
    });

    it('reports a photo pick with the full candidate', async () => {
        const onPick = vi.fn();
        const candidates = [1, 2, 3, 4].map(makeCandidate);
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockResolvedValue(candidates),
            onPick,
        });
        container.appendChild(picker.element);
        await flush();

        container.querySelectorAll<HTMLButtonElement>('[data-testid="image-picker-tile"]')[2].click();

        expect(onPick).toHaveBeenCalledWith({ kind: 'photo', photo: candidates[2] });
    });

    it('reports surprise and blank picks without any fetch dependency', () => {
        const onPick = vi.fn();
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockReturnValue(new Promise(() => {})),
            onPick,
        });
        container.appendChild(picker.element);

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-surprise"]')!.click();
        expect(onPick).toHaveBeenCalledWith({ kind: 'surprise' });

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-blank"]')!.click();
        expect(onPick).toHaveBeenCalledWith({ kind: 'blank' });
    });

    it('shows the error message when the fetch resolves null and retries on refresh', async () => {
        const fetchCandidates = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce([1, 2, 3, 4].map(makeCandidate));
        const picker = createImagePicker({ fetchCandidates, onPick: vi.fn() });
        container.appendChild(picker.element);
        await flush();

        const error = container.querySelector<HTMLElement>('.image-picker-error')!;
        expect(error.hidden).toBe(false);

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-refresh"]')!.click();
        await flush();

        expect(error.hidden).toBe(true);
        expect(container.querySelectorAll('.image-picker-thumb')).toHaveLength(4);
    });

    it('shows the error message when the fetch rejects', async () => {
        const picker = createImagePicker({
            fetchCandidates: vi.fn().mockRejectedValue(new Error('boom')),
            onPick: vi.fn(),
        });
        container.appendChild(picker.element);
        await flush();

        expect(container.querySelector<HTMLElement>('.image-picker-error')!.hidden).toBe(false);
    });

    it('ignores a stale response that resolves after a newer refresh', async () => {
        let resolveFirst!: (v: CandidateImage[] | null) => void;
        const first = new Promise<CandidateImage[] | null>((r) => { resolveFirst = r; });
        const second = [1, 2, 3, 4].map(makeCandidate);
        const fetchCandidates = vi.fn()
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce(second);

        const picker = createImagePicker({ fetchCandidates, onPick: vi.fn() });
        container.appendChild(picker.element);

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-refresh"]')!.click();
        await flush();
        expect(container.querySelectorAll('.image-picker-thumb')).toHaveLength(4);

        // The stale first fetch finally resolves with different (old) data —
        // it must not clobber the newer result.
        resolveFirst([makeCandidate(9)]);
        await flush();

        const imgs = container.querySelectorAll<HTMLImageElement>('.image-picker-thumb');
        expect(imgs).toHaveLength(4);
        expect(imgs[0].src).toBe('https://images.unsplash.com/photo-1?w=400');
    });

    it('hides the grid and refresh button when no fetchCandidates is provided', () => {
        const picker = createImagePicker({ onPick: vi.fn() });
        container.appendChild(picker.element);

        expect(container.querySelector<HTMLElement>('.image-picker-grid')!.hidden).toBe(true);
        expect(container.querySelector<HTMLElement>('[data-testid="image-picker-refresh"]')!.hidden).toBe(true);
        expect(container.querySelector('[data-testid="image-picker-surprise"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="image-picker-blank"]')).not.toBeNull();
    });
});
