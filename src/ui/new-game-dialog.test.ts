/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the new-game dialog.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNewGameDialog, getSizeClass, type ComposableSliderConfig } from './new-game-dialog.js';
import { PUZZLE_SIZE_OPTIONS } from '../game/puzzle-sizes.js';

describe('getSizeClass', () => {
    it('returns "small" for 24 pieces', () => {
        expect(getSizeClass(24)).toBe('small');
    });

    it('returns "medium" for 48 pieces', () => {
        expect(getSizeClass(48)).toBe('medium');
    });

    it('returns "large" for 96 pieces', () => {
        expect(getSizeClass(96)).toBe('large');
    });

    it('returns "xlarge" for 192 pieces', () => {
        expect(getSizeClass(192)).toBe('xlarge');
    });
});

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

    it('shows the correct number of size options', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        const buttons = container.querySelectorAll('.size-picker-option');
        expect(buttons).toHaveLength(PUZZLE_SIZE_OPTIONS.length);
    });

    it('marks the selected option', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '96',
            onSelect: vi.fn(),
        });

        const buttons = container.querySelectorAll('.size-picker-option');
        expect(buttons[2].classList.contains('size-picker-option--selected')).toBe(true);
        expect(buttons[0].classList.contains('size-picker-option--selected')).toBe(false);
    });

    it('calls onSelect with the correct id when a size is clicked', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect,
        });

        const buttons = container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        buttons[3].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '192',
            cutStyleId: 'classic',
            composableConfig: undefined,
            fractalConfig: undefined,
            rotationEnabled: false,
            imageSource: 'random',
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

        const buttons = container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        buttons[0].click();

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

    it('displays piece count in each button', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        const counts = container.querySelectorAll('.size-picker-count');
        expect(counts[0].textContent).toBe('24');
        expect(counts[1].textContent).toBe('48');
        expect(counts[2].textContent).toBe('96');
        expect(counts[3].textContent).toBe('192');
    });

    it('displays grid dimensions in each button', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            onSelect: vi.fn(),
        });

        const dims = container.querySelectorAll('.size-picker-dims');
        expect(dims[0].textContent).toBe('6 × 4');
        expect(dims[1].textContent).toBe('8 × 6');
        expect(dims[2].textContent).toBe('12 × 8');
        expect(dims[3].textContent).toBe('16 × 12');
    });

    it('shows approximate piece counts without grid dims for triangles', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'triangles',
            onSelect: vi.fn(),
        });

        const counts = container.querySelectorAll('.size-picker-count');
        expect(counts[0].textContent).toBe('~24');
        expect(counts[1].textContent).toBe('~48');
        expect(counts[2].textContent).toBe('~96');
        expect(counts[3].textContent).toBe('~192');
        expect(container.querySelectorAll('.size-picker-dims')).toHaveLength(0);
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

        // Click the first size option
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '24',
            cutStyleId: 'fractal',
            composableConfig: undefined,
            fractalConfig: { borderless: false },
            rotationEnabled: false,
            imageSource: 'random',
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

        // Then pick a size
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '24',
            cutStyleId: 'fractal',
            composableConfig: undefined,
            fractalConfig: { borderless: false },
            rotationEnabled: false,
            imageSource: 'random',
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

        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

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

        // Trigger a size selection to fire onSelect (match how other tests do it).
        container
            .querySelectorAll<HTMLButtonElement>('.size-picker-option')[0]
            .click();

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

        // Trigger selection the same way the existing dialog tests do (size click).
        container.querySelectorAll<HTMLElement>('.size-picker-option')[0].click();

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

        // Trigger selection the same way the existing dialog tests do (size click).
        container.querySelectorAll<HTMLElement>('.size-picker-option')[0].click();

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
        container.querySelectorAll<HTMLElement>('.size-picker-option')[0].click();
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ wavyConfig: undefined }),
        );
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
        // Pick a size to fire onSelect.
        container.querySelectorAll<HTMLButtonElement>('.size-picker-option')[0].click();
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
        // Pick a size to fire onSelect.
        container.querySelectorAll<HTMLButtonElement>('.size-picker-option')[0].click();
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({
                composableConfig: expect.objectContaining<Partial<ComposableSliderConfig>>({ baseCut: 'triangular', smooth: true }),
            }),
        );
    });
});
