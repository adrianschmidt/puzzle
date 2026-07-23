/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the new-game dialog.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNewGameDialog, type ComposableSliderConfig } from './new-game-dialog.js';
import { PUZZLE_SIZE_OPTIONS } from '../game/puzzle-sizes.js';

/** Start the game the way the new dialog does it: click "Surprise me". */
function pickSurprise(container: HTMLElement): void {
    container
        .querySelector<HTMLButtonElement>('[data-testid="image-picker-surprise"]')!
        .click();
}

describe('createNewGameDialog', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('adds an overlay to the container', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.size-picker-overlay')).not.toBeNull();
    });

    it('renders one select option per puzzle size', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        expect(select.options).toHaveLength(PUZZLE_SIZE_OPTIONS.length);
        expect(select.value).toBe('48');
        expect(select.options[0].textContent).toBe('24 pieces');
        expect(select.options[3].textContent).toBe('192 pieces');
    });

    it('shows approximate piece counts for triangles', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'triangles',
            onSelect: vi.fn(),
        });

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        expect(select.options[0].textContent).toBe('~24 pieces');
        expect(select.options[3].textContent).toBe('~192 pieces');
    });

    it('switches size labels to approximate when the cut style changes to fractal', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        container.querySelector<HTMLButtonElement>('[data-cut-style-id="fractal"]')!.click();

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        expect(select.options[1].textContent).toBe('~48 pieces');
    });

    it('calls onSelect with the correct id when a size is clicked', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect,
        });

        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        select.value = '192';
        select.dispatchEvent(new Event('change'));
        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '192',
            cutStyleId: 'classic',
            composableConfig: undefined,
            fractalConfig: undefined,
            rotationEnabled: false,
            imageChoice: { kind: 'surprise' },
            imageCategory: 'any',
            vibrant: false,
        });
    });

    it('removes the overlay after selection', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        pickSurprise(container);

        expect(container.querySelector('.size-picker-overlay')).toBeNull();
    });

    it('removes the overlay when clicking the backdrop', () => {
        const onCancel = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
            onCancel,
        });

        const overlay = container.querySelector<HTMLElement>('.size-picker-overlay')!;
        overlay.click(); // click on backdrop, not dialog

        expect(container.querySelector('.size-picker-overlay')).toBeNull();
        expect(onCancel).toHaveBeenCalled();
    });

    it('removes the overlay on Escape key', () => {
        const onCancel = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
            onCancel,
        });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(container.querySelector('.size-picker-overlay')).toBeNull();
        expect(onCancel).toHaveBeenCalled();
    });

    it('returns a cleanup function that removes the overlay', () => {
        const dismiss = createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.size-picker-overlay')).not.toBeNull();
        dismiss();
        expect(container.querySelector('.size-picker-overlay')).toBeNull();
    });

    it('fires onPreloadTracedTabs when opened with triangles selected', () => {
        const onPreloadTracedTabs = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'triangles',
            onSelect: vi.fn(),
            onPreloadTracedTabs,
        });
        expect(onPreloadTracedTabs).toHaveBeenCalled();
    });

    it('fires onPreloadTracedTabs when switching the cut style to wavy', () => {
        const onPreloadTracedTabs = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
            onPreloadTracedTabs,
        });
        expect(onPreloadTracedTabs).not.toHaveBeenCalled();

        container
            .querySelector<HTMLButtonElement>('[data-cut-style-id="wavy"]')!
            .click();
        expect(onPreloadTracedTabs).toHaveBeenCalled();
    });

    it('fires onPreloadTracedTabs when switching the cut style to triangles', () => {
        const onPreloadTracedTabs = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
            onPreloadTracedTabs,
        });
        expect(onPreloadTracedTabs).not.toHaveBeenCalled();

        container
            .querySelector<HTMLButtonElement>('[data-cut-style-id="triangles"]')!
            .click();
        expect(onPreloadTracedTabs).toHaveBeenCalled();
    });

    it('includes the cut style picker section', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.cut-style-section')).not.toBeNull();
    });

    it('passes the selected cut style id to onSelect', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'fractal',
            onSelect,
        });

        // Pick the '24' size.
        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        select.value = '24';
        select.dispatchEvent(new Event('change'));
        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '24',
            cutStyleId: 'fractal',
            composableConfig: undefined,
            fractalConfig: { borderless: false },
            rotationEnabled: false,
            imageChoice: { kind: 'surprise' },
            imageCategory: 'any',
            vibrant: false,
        });
    });

    it('updates the cut style when a different style is clicked before selecting size', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect,
        });

        // Switch to Fractal
        const fractalBtn = container.querySelector<HTMLButtonElement>(
            '[data-cut-style-id="fractal"]',
        )!;
        fractalBtn.click();

        // Then pick the '24' size and start the game.
        const select = container.querySelector<HTMLSelectElement>('[data-testid="size-select"]')!;
        select.value = '24';
        select.dispatchEvent(new Event('change'));
        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '24',
            cutStyleId: 'fractal',
            composableConfig: undefined,
            fractalConfig: { borderless: false },
            rotationEnabled: false,
            imageChoice: { kind: 'surprise' },
            imageCategory: 'any',
            vibrant: false,
        });
    });

    it('exposes the top-level "Enable rotation" checkbox by default', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(false);
    });

    it('renders no free-rotation sub-checkbox for any cut style', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'wavy',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.free-rotation-row')).toBeNull();
        const labels = Array.from(
            container.querySelectorAll<HTMLLabelElement>('label'),
        ).map((l) => l.textContent ?? '');
        expect(labels.some((t) => t.includes('Free rotation'))).toBe(false);
    });

    it('gives the rotation checkbox the shared form-checkbox accent class', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        );
        expect(checkbox!.classList.contains('form-checkbox')).toBe(true);
    });

    it('passes rotationEnabled: true when the top-level checkbox is ticked, regardless of cut style', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect,
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                cutStyleId: 'classic',
                rotationEnabled: true,
            }),
        );
    });

    it('initializes the top-level checkbox from savedRotationEnabled', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        );
        expect(checkbox?.checked).toBe(true);
    });

    it('reports a picked photo through onSelect and dismisses', async () => {
        const onSelect = vi.fn();
        const candidate = {
            imageUrl: 'https://images.unsplash.com/photo-1?w=1080',
            thumbUrl: 'https://images.unsplash.com/photo-1?w=400',
            imageSize: { width: 1080, height: 720 },
            attribution: {
                photographerName: 'P1',
                photographerUrl: 'https://unsplash.com/@p1',
                photoUrl: 'https://unsplash.com/photos/1',
            },
            downloadLocation: 'https://api.unsplash.com/photos/1/download',
        };
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect,
            fetchImageCandidates: vi.fn().mockResolvedValue([candidate]),
        });
        await Promise.resolve();
        await Promise.resolve();

        container.querySelector<HTMLButtonElement>('[data-testid="image-picker-tile"]')!.click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ imageChoice: { kind: 'photo', photo: candidate } }),
        );
        expect(container.querySelector('.size-picker-overlay')).toBeNull();
    });

    it('re-fetches candidates when the category or vibrant option changes', () => {
        const fetchImageCandidates = vi.fn().mockResolvedValue(null);
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
            fetchImageCandidates,
        });
        expect(fetchImageCandidates).toHaveBeenCalledTimes(1);
        expect(fetchImageCandidates).toHaveBeenLastCalledWith('any', false);

        const categorySelect = container.querySelector<HTMLSelectElement>(
            '.image-options-section select',
        )!;
        categorySelect.value = 'nature';
        categorySelect.dispatchEvent(new Event('change'));
        expect(fetchImageCandidates).toHaveBeenCalledTimes(2);
        expect(fetchImageCandidates).toHaveBeenLastCalledWith('nature', false);

        const vibrant = container.querySelector<HTMLInputElement>(
            '.image-options-section input[type="checkbox"]',
        )!;
        vibrant.checked = true;
        vibrant.dispatchEvent(new Event('change'));
        expect(fetchImageCandidates).toHaveBeenCalledTimes(3);
        expect(fetchImageCandidates).toHaveBeenLastCalledWith('nature', true);
    });

    it('hides the candidate grid when no fetchImageCandidates is provided', () => {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });

        expect(container.querySelector<HTMLElement>('.image-picker-grid')!.hidden).toBe(true);
    });
});

describe('createNewGameDialog — composable visibility', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    it('hides the composable button on production', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('BASE_URL', '/puzzle/');
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        expect(
            container.querySelector('[data-cut-style-id="composable"]'),
        ).toBeNull();
    });

    it('shows the composable button on dev-deploys', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('BASE_URL', '/puzzle/dev/');
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        expect(
            container.querySelector('[data-cut-style-id="composable"]'),
        ).not.toBeNull();
    });

    it('coerces a saved composable preference to the default on prod', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('BASE_URL', '/puzzle/');
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',  // saved value not visible on prod
            onSelect: vi.fn(),
        });
        // The "Classic" button should be the selected one.
        const classicBtn = container.querySelector(
            '[data-cut-style-id="classic"]',
        ) as HTMLElement | null;
        expect(classicBtn?.classList.contains('cut-style-option--selected')).toBe(true);
    });
});

describe('createNewGameDialog — composable borderless toggle', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('includes composableConfig.borderless in the selection when checked', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            composableSupportsBorderless: true,
            onSelect,
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '[data-testid="composable-borderless-toggle"]',
        );
        expect(checkbox).not.toBeNull();
        checkbox!.checked = true;
        checkbox!.dispatchEvent(new Event('change'));

        // Trigger onSelect the same way the dialog does: pick "Surprise me".
        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                composableConfig: expect.objectContaining({ borderless: true }),
            }),
        );
    });

    it('omits the borderless checkbox when the generator does not support it', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            composableSupportsBorderless: false,
            onSelect: vi.fn(),
        });
        expect(
            container.querySelector('[data-testid="composable-borderless-toggle"]'),
        ).toBeNull();
    });
});

describe('createNewGameDialog — fractal borderless toggle', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('shows a Borderless toggle for fractal and feeds it into the selection', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '24',
            selectedCutStyleId: 'fractal',
            onSelect,
        });

        const toggle = container.querySelector<HTMLInputElement>('[data-testid="fractal-borderless-toggle"]');
        expect(toggle).not.toBeNull();
        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change'));

        // Trigger selection the same way the existing dialog tests do (pick "Surprise me").
        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ fractalConfig: { borderless: true } }),
        );
    });
});

describe('createNewGameDialog — wavy borderless toggle', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('shows a Borderless toggle for wavy and feeds it into the selection', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '24',
            selectedCutStyleId: 'wavy',
            onSelect,
        });

        const toggle = container.querySelector<HTMLInputElement>('[data-testid="wavy-borderless-toggle"]');
        expect(toggle).not.toBeNull();
        toggle!.checked = true;
        toggle!.dispatchEvent(new Event('change'));

        // Trigger selection the same way the existing dialog tests do (pick "Surprise me").
        pickSurprise(container);

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ wavyConfig: { borderless: true } }),
        );
    });

    it('does not emit wavyConfig when the cut style is not wavy', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '24',
            selectedCutStyleId: 'classic',
            onSelect,
        });
        pickSurprise(container);
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ wavyConfig: undefined }),
        );
    });
});

describe('createNewGameDialog — responsive layout structure', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function openDialog(): void {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect: vi.fn() });
    }

    it('keeps the title outside the scrollable content wrapper', () => {
        openDialog();
        const dialog = container.querySelector('.size-picker-dialog')!;
        const title = dialog.querySelector('.size-picker-title')!;
        expect(title.parentElement).toBe(dialog);
        expect(dialog.querySelector('.dialog-content')).not.toBeNull();
        expect(dialog.querySelector('.dialog-content .size-picker-title')).toBeNull();
    });

    it('places every section inside the scrollable content wrapper', () => {
        openDialog();
        const content = container.querySelector('.dialog-content')!;
        for (const selector of [
            '.cut-style-section',
            '.rotation-row',
            '.image-options-section',
            '.image-picker',
            '.composable-sliders',
        ]) {
            expect(content.querySelector(selector), selector).not.toBeNull();
        }
    });

    it('splits sections into settings and start groups for the two-column layout', () => {
        openDialog();
        const settings = container.querySelector('.dialog-group--settings')!;
        const start = container.querySelector('.dialog-group--start')!;
        expect(settings.querySelector('.cut-style-section')).not.toBeNull();
        expect(settings.querySelector('.rotation-row')).not.toBeNull();
        // Fractal and wavy borderless sections share the .cut-style-options class.
        expect(settings.querySelectorAll('.cut-style-options')).toHaveLength(2);
        expect(settings.querySelector('.composable-sliders')).not.toBeNull();
        expect(settings.querySelector('.image-options-section')).not.toBeNull();
        expect(settings.querySelector('[data-testid="size-select"]')).not.toBeNull();
        expect(start.querySelector('.image-picker')).not.toBeNull();
        expect(start.querySelector('.image-options-section')).toBeNull();
    });

    it('renders the picker heading inside the start group', () => {
        openDialog();
        const start = container.querySelector('.dialog-group--start')!;
        expect(start.querySelector('.size-picker-subtitle')?.textContent)
            .toBe('Pick an image to start');
    });
});

describe('composable base-cut picker', () => {
    let container: HTMLElement;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    function openDialogAndSelectComposable(onSelect = vi.fn()): ReturnType<typeof vi.fn> {
        createNewGameDialog({ container, selectedSizeId: '48', onSelect });
        // Composable is dev-visible under vitest (import.meta.env.DEV).
        const composableBtn = Array.from(
            container.querySelectorAll<HTMLButtonElement>('.cut-style-option'),
        ).find(b => b.textContent?.toLowerCase().includes('composable'));
        composableBtn!.click();
        return onSelect;
    }

    it('shows sine controls and hides triangular controls by default', () => {
        openDialogAndSelectComposable();
        const sine = container.querySelector<HTMLElement>('[data-testid="composable-sine-controls"]')!;
        const tri = container.querySelector<HTMLElement>('[data-testid="composable-triangular-controls"]')!;
        expect(sine.style.display).not.toBe('none');
        expect(tri.style.display).toBe('none');
    });

    it('reveals the irregularity slider when triangular is picked', () => {
        openDialogAndSelectComposable();
        const triRadio = container.querySelector<HTMLInputElement>(
            'input[type="radio"][value="triangular"]',
        )!;
        triRadio.click();
        const sine = container.querySelector<HTMLElement>('[data-testid="composable-sine-controls"]')!;
        const tri = container.querySelector<HTMLElement>('[data-testid="composable-triangular-controls"]')!;
        expect(sine.style.display).toBe('none');
        expect(tri.style.display).not.toBe('none');
        expect(container.querySelector('[data-testid="composable-jitter-slider"]')).not.toBeNull();
    });

    it('reports baseCut + jitter through onSelect', () => {
        const onSelect = openDialogAndSelectComposable();
        container.querySelector<HTMLInputElement>('input[type="radio"][value="triangular"]')!.click();
        const jitter = container.querySelector<HTMLInputElement>('[data-testid="composable-jitter-slider"]')!;
        jitter.value = '0.3';
        jitter.dispatchEvent(new Event('input'));
        // Pick "Surprise me" to fire onSelect.
        pickSurprise(container);
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                cutStyleId: 'composable',
                composableConfig: expect.objectContaining<Partial<ComposableSliderConfig>>({ baseCut: 'triangular', jitter: 0.3 }),
            }),
        );
    });

    it('reports the smooth toggle through onSelect', () => {
        const onSelect = openDialogAndSelectComposable();
        container.querySelector<HTMLInputElement>('input[type="radio"][value="triangular"]')!.click();
        const smooth = container.querySelector<HTMLInputElement>('[data-testid="composable-smooth-toggle"]')!;
        expect(smooth).not.toBeNull();
        smooth.checked = true;
        smooth.dispatchEvent(new Event('change'));
        // Pick "Surprise me" to fire onSelect.
        pickSurprise(container);
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                composableConfig: expect.objectContaining<Partial<ComposableSliderConfig>>({ baseCut: 'triangular', smooth: true }),
            }),
        );
    });
});
