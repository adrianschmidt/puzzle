/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the new-game dialog.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNewGameDialog, getSizeClass } from './new-game-dialog.js';
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
            freeRotation: false,
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
            freeRotation: false,
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
            freeRotation: false,
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

describe('free rotation sub-checkbox', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('is hidden when "Enable rotation" is unchecked', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: false,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row');
        expect(row).not.toBeNull();
        expect(row!.style.display).toBe('none');
    });

    it('is hidden when cut style is not composable', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'fractal',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row');
        expect(row).not.toBeNull();
        expect(row!.style.display).toBe('none');
    });

    it('is hidden when rotation is enabled but classic cut style is active', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row');
        expect(row).not.toBeNull();
        expect(row!.style.display).toBe('none');
    });

    it('appears when rotation is enabled AND cut style is composable', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row');
        expect(row).not.toBeNull();
        expect(row!.style.display).not.toBe('none');
    });

    it('becomes visible when user enables rotation while composable is active', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: false,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row')!;
        expect(row.style.display).toBe('none');

        const rotationCheckbox = container.querySelector<HTMLInputElement>(
            '.rotation-row input[type="checkbox"]',
        )!;
        rotationCheckbox.checked = true;
        rotationCheckbox.dispatchEvent(new Event('change'));

        expect(row.style.display).not.toBe('none');
    });

    it('becomes hidden when user switches away from composable while rotation is on', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row')!;
        expect(row.style.display).not.toBe('none');

        // Switch to Fractal
        const fractalBtn = container.querySelector<HTMLButtonElement>(
            '[data-cut-style-id="fractal"]',
        )!;
        fractalBtn.click();

        expect(row.style.display).toBe('none');
    });

    it('produces freeRotation: true when both toggles are on at submit', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            savedFreeRotationEnabled: true,
            onSelect,
        });

        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ freeRotation: true }),
        );
    });

    it('produces freeRotation: false when the sub-checkbox is unchecked', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            savedFreeRotationEnabled: false,
            onSelect,
        });

        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ freeRotation: false }),
        );
    });

    it('produces freeRotation: false when rotation is off (even if sub-checkbox state was saved as on)', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: false,
            savedFreeRotationEnabled: true,
            onSelect,
        });

        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ freeRotation: false }),
        );
    });

    it('produces freeRotation: false when cut style is not composable', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            savedRotationEnabled: true,
            savedFreeRotationEnabled: true,
            onSelect,
        });

        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ freeRotation: false }),
        );
    });

    it('initializes the sub-checkbox from savedFreeRotationEnabled', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            savedFreeRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.free-rotation-row input[type="checkbox"]',
        );
        expect(checkbox?.checked).toBe(true);
    });

    it('defaults the sub-checkbox to unchecked when savedFreeRotationEnabled is not provided', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.free-rotation-row input[type="checkbox"]',
        );
        expect(checkbox?.checked).toBe(false);
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

describe('createNewGameDialog — free rotation sub-checkbox', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        // Make composable visible so the picker renders it.
        vi.stubEnv('DEV', true);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    function getFreeRotationRow(): HTMLElement {
        return container.querySelector('.free-rotation-row') as HTMLElement;
    }

    it('is hidden by default (rotation off)', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'wavy',
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('none');
    });

    it('is visible when rotation is on and cut style is wavy', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'wavy',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('block');
    });

    it('is visible when rotation is on and cut style is composable', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'composable',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('block');
    });

    it('is hidden when rotation is on but cut style is classic', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'classic',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('none');
    });

    it('is hidden when rotation is on but cut style is fractal', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleId: 'fractal',
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });
        expect(getFreeRotationRow().style.display).toBe('none');
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
