/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the new-game dialog.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
            cutStyleIndex: 0,
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

    it('passes the selected cut style index to onSelect', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleIndex: 1,
            onSelect,
        });

        // Click the first size option
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '24',
            cutStyleIndex: 1,
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
            selectedCutStyleIndex: 0,
            onSelect,
        });

        // Switch to Fractal
        const cutStyleButtons =
            container.querySelectorAll<HTMLButtonElement>('.cut-style-option');
        cutStyleButtons[1].click();

        // Then pick a size
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith({
            sizeId: '24',
            cutStyleIndex: 1,
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

    it('passes rotationEnabled: true when the top-level checkbox is ticked, regardless of cut style', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleIndex: 0, // Classic
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
                cutStyleIndex: 0,
                rotationEnabled: true,
            }),
        );
    });

    it('initialises the top-level checkbox from savedRotationEnabled', () => {
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

// CUT_STYLE_OPTIONS order: 0=classic, 1=fractal, 2=composable
const COMPOSABLE_INDEX = 2;
const FRACTAL_INDEX = 1;
const CLASSIC_INDEX = 0;

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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: FRACTAL_INDEX,
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
            selectedCutStyleIndex: CLASSIC_INDEX,
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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const row = container.querySelector<HTMLElement>('.free-rotation-row')!;
        expect(row.style.display).not.toBe('none');

        // Switch to Fractal
        const cutStyleButtons =
            container.querySelectorAll<HTMLButtonElement>('.cut-style-option');
        cutStyleButtons[FRACTAL_INDEX].click();

        expect(row.style.display).toBe('none');
    });

    it('produces freeRotation: true when both toggles are on at submit', () => {
        const onSelect = vi.fn();
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: CLASSIC_INDEX,
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

    it('initialises the sub-checkbox from savedFreeRotationEnabled', () => {
        createNewGameDialog({
            container,
            selectedSizeId: '48',
            selectedCutStyleIndex: COMPOSABLE_INDEX,
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
            selectedCutStyleIndex: COMPOSABLE_INDEX,
            savedRotationEnabled: true,
            onSelect: vi.fn(),
        });

        const checkbox = container.querySelector<HTMLInputElement>(
            '.free-rotation-row input[type="checkbox"]',
        );
        expect(checkbox?.checked).toBe(false);
    });
});
