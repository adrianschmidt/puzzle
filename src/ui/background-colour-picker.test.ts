/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the background colour picker UI component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BACKGROUND_COLOUR_PRESETS } from './background-colour.js';
import {
    createSwatch,
    createPickerPanel,
    createBackgroundColourPicker,
} from './background-colour-picker.js';

describe('createSwatch', () => {
    it('creates a button element', () => {
        const swatch = createSwatch(BACKGROUND_COLOUR_PRESETS[0], false);
        expect(swatch.tagName).toBe('BUTTON');
    });

    it('sets the background colour to the preset colour', () => {
        const preset = BACKGROUND_COLOUR_PRESETS[0];
        const swatch = createSwatch(preset, false);
        expect(swatch.style.backgroundColor).toBeTruthy();
    });

    it('sets the aria-label to the preset label', () => {
        const preset = BACKGROUND_COLOUR_PRESETS[1];
        const swatch = createSwatch(preset, false);
        expect(swatch.getAttribute('aria-label')).toBe(preset.label);
    });

    it('stores the id in a data attribute', () => {
        const preset = BACKGROUND_COLOUR_PRESETS[2];
        const swatch = createSwatch(preset, false);
        expect(swatch.dataset.colourId).toBe(preset.id);
    });

    it('adds selected class when isSelected is true', () => {
        const swatch = createSwatch(BACKGROUND_COLOUR_PRESETS[0], true);
        expect(swatch.classList.contains('bg-colour-swatch--selected')).toBe(
            true,
        );
    });

    it('does not add selected class when isSelected is false', () => {
        const swatch = createSwatch(BACKGROUND_COLOUR_PRESETS[0], false);
        expect(swatch.classList.contains('bg-colour-swatch--selected')).toBe(
            false,
        );
    });
});

describe('createPickerPanel', () => {
    it('creates a panel with a swatch for each preset', () => {
        const panel = createPickerPanel('midnight', vi.fn(), vi.fn());
        const swatches = panel.querySelectorAll('.bg-colour-swatch');
        expect(swatches.length).toBe(BACKGROUND_COLOUR_PRESETS.length);
    });

    it('marks the selected swatch', () => {
        const panel = createPickerPanel('slate', vi.fn(), vi.fn());
        const swatches = panel.querySelectorAll('.bg-colour-swatch');
        const selectedIndex = BACKGROUND_COLOUR_PRESETS.findIndex(
            (p) => p.id === 'slate',
        );
        expect(
            swatches[selectedIndex].classList.contains(
                'bg-colour-swatch--selected',
            ),
        ).toBe(true);
    });

    it('calls onSelect with the correct id when a swatch is clicked', () => {
        const onSelect = vi.fn();
        const onDismiss = vi.fn();
        const panel = createPickerPanel('midnight', onSelect, onDismiss);
        const swatches = panel.querySelectorAll<HTMLButtonElement>(
            '.bg-colour-swatch',
        );

        swatches[3].click();

        expect(onSelect).toHaveBeenCalledWith(BACKGROUND_COLOUR_PRESETS[3].id);
    });

    it('calls onDismiss when a swatch is clicked', () => {
        const onSelect = vi.fn();
        const onDismiss = vi.fn();
        const panel = createPickerPanel('midnight', onSelect, onDismiss);
        const swatches = panel.querySelectorAll<HTMLButtonElement>(
            '.bg-colour-swatch',
        );

        swatches[1].click();

        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('has role=listbox', () => {
        const panel = createPickerPanel('midnight', vi.fn(), vi.fn());
        expect(panel.getAttribute('role')).toBe('listbox');
    });

    it('each swatch has role=option', () => {
        const panel = createPickerPanel('midnight', vi.fn(), vi.fn());
        const swatches = panel.querySelectorAll('.bg-colour-swatch');
        for (const swatch of swatches) {
            expect(swatch.getAttribute('role')).toBe('option');
        }
    });
});

describe('createBackgroundColourPicker', () => {
    let container: HTMLElement;
    let onSelect: ReturnType<typeof vi.fn<(id: string) => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        onSelect = vi.fn<(id: string) => void>();
    });

    afterEach(() => {
        container.remove();
    });

    it('adds a button to the container', () => {
        createBackgroundColourPicker({
            container,
            selectedId: 'midnight',
            onSelect,
        });

        const button = container.querySelector('.bg-colour-button');
        expect(button).not.toBeNull();
    });

    it('opens a panel when the button is clicked', () => {
        createBackgroundColourPicker({
            container,
            selectedId: 'midnight',
            onSelect,
        });

        const button =
            container.querySelector<HTMLButtonElement>('.bg-colour-button')!;
        button.click();

        const panel = container.querySelector('.bg-colour-panel');
        expect(panel).not.toBeNull();
    });

    it('closes the panel when the button is clicked again', () => {
        createBackgroundColourPicker({
            container,
            selectedId: 'midnight',
            onSelect,
        });

        const button =
            container.querySelector<HTMLButtonElement>('.bg-colour-button')!;
        button.click();
        expect(container.querySelector('.bg-colour-panel')).not.toBeNull();

        button.click();
        expect(container.querySelector('.bg-colour-panel')).toBeNull();
    });

    it('calls onSelect when a swatch is clicked', () => {
        createBackgroundColourPicker({
            container,
            selectedId: 'midnight',
            onSelect,
        });

        const button =
            container.querySelector<HTMLButtonElement>('.bg-colour-button')!;
        button.click();

        const swatches = container.querySelectorAll<HTMLButtonElement>(
            '.bg-colour-swatch',
        );
        swatches[2].click();

        expect(onSelect).toHaveBeenCalledWith(BACKGROUND_COLOUR_PRESETS[2].id);
    });

    it('closes the panel after selecting a colour', () => {
        createBackgroundColourPicker({
            container,
            selectedId: 'midnight',
            onSelect,
        });

        const button =
            container.querySelector<HTMLButtonElement>('.bg-colour-button')!;
        button.click();

        const swatches = container.querySelectorAll<HTMLButtonElement>(
            '.bg-colour-swatch',
        );
        swatches[1].click();

        expect(container.querySelector('.bg-colour-panel')).toBeNull();
    });

    it('removes everything on cleanup', () => {
        const cleanup = createBackgroundColourPicker({
            container,
            selectedId: 'midnight',
            onSelect,
        });

        // Open the panel
        const button =
            container.querySelector<HTMLButtonElement>('.bg-colour-button')!;
        button.click();

        cleanup();

        expect(container.querySelector('.bg-colour-button')).toBeNull();
        expect(container.querySelector('.bg-colour-panel')).toBeNull();
    });
});

// Need afterEach in scope for the describe block above
import { afterEach } from 'vitest';
