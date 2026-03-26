/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the size picker dialog.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSizePickerDialog, getSizeClass } from './size-picker.js';
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

describe('createSizePickerDialog', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('adds an overlay to the container', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.size-picker-overlay')).not.toBeNull();
    });

    it('shows the correct number of size options', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        const buttons = container.querySelectorAll('.size-picker-option');
        expect(buttons).toHaveLength(PUZZLE_SIZE_OPTIONS.length);
    });

    it('marks the selected option', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 2,
            onSelect: vi.fn(),
        });

        const buttons = container.querySelectorAll('.size-picker-option');
        expect(buttons[2].classList.contains('size-picker-option--selected')).toBe(true);
        expect(buttons[0].classList.contains('size-picker-option--selected')).toBe(false);
    });

    it('calls onSelect with the correct index when a size is clicked', () => {
        const onSelect = vi.fn();
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect,
        });

        const buttons = container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        buttons[3].click();

        expect(onSelect).toHaveBeenCalledWith(3, 0, undefined, "random");
    });

    it('removes the overlay after selection', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        const buttons = container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        buttons[0].click();

        expect(container.querySelector('.size-picker-overlay')).toBeNull();
    });

    it('removes the overlay when clicking the backdrop', () => {
        const onCancel = vi.fn();
        createSizePickerDialog({
            container,
            selectedIndex: 1,
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
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
            onCancel,
        });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(container.querySelector('.size-picker-overlay')).toBeNull();
        expect(onCancel).toHaveBeenCalled();
    });

    it('returns a cleanup function that removes the overlay', () => {
        const dismiss = createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.size-picker-overlay')).not.toBeNull();
        dismiss();
        expect(container.querySelector('.size-picker-overlay')).toBeNull();
    });

    it('displays piece count in each button', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        const counts = container.querySelectorAll('.size-picker-count');
        expect(counts[0].textContent).toBe('24');
        expect(counts[1].textContent).toBe('48');
        expect(counts[2].textContent).toBe('96');
        expect(counts[3].textContent).toBe('192');
    });

    it('displays grid dimensions in each button', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        const dims = container.querySelectorAll('.size-picker-dims');
        expect(dims[0].textContent).toBe('6 × 4');
        expect(dims[1].textContent).toBe('8 × 6');
        expect(dims[2].textContent).toBe('12 × 8');
        expect(dims[3].textContent).toBe('16 × 12');
    });

    it('includes the cut style picker section', () => {
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        expect(container.querySelector('.cut-style-section')).not.toBeNull();
    });

    it('passes the selected cut style index to onSelect', () => {
        const onSelect = vi.fn();
        createSizePickerDialog({
            container,
            selectedIndex: 1,
            selectedCutStyleIndex: 1,
            onSelect,
        });

        // Click the first size option
        const sizeButtons =
            container.querySelectorAll<HTMLButtonElement>('.size-picker-option');
        sizeButtons[0].click();

        expect(onSelect).toHaveBeenCalledWith(0, 1, undefined, "random");
    });

    it('updates the cut style when a different style is clicked before selecting size', () => {
        const onSelect = vi.fn();
        createSizePickerDialog({
            container,
            selectedIndex: 1,
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

        expect(onSelect).toHaveBeenCalledWith(0, 1, undefined, "random");
    });
});
