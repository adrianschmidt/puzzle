/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the cut style picker component.
 */

import { describe, it, expect, vi } from 'vitest';
import { createCutStylePicker } from './cut-style-picker.js';
import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';

describe('createCutStylePicker', () => {
    it('returns a section element with the correct class', () => {
        const section = createCutStylePicker({
            selectedIndex: 0,
            onSelect: vi.fn(),
        });

        expect(section.className).toBe('cut-style-section');
    });

    it('shows a title', () => {
        const section = createCutStylePicker({
            selectedIndex: 0,
            onSelect: vi.fn(),
        });

        const title = section.querySelector('.cut-style-title');
        expect(title).not.toBeNull();
        expect(title!.textContent).toBe('Cut Style');
    });

    it('renders one button per cut style option', () => {
        const section = createCutStylePicker({
            selectedIndex: 0,
            onSelect: vi.fn(),
        });

        const buttons = section.querySelectorAll('.cut-style-option');
        expect(buttons).toHaveLength(CUT_STYLE_OPTIONS.length);
    });

    it('marks the selected option', () => {
        const section = createCutStylePicker({
            selectedIndex: 1,
            onSelect: vi.fn(),
        });

        const buttons = section.querySelectorAll('.cut-style-option');
        expect(buttons[0].classList.contains('cut-style-option--selected')).toBe(false);
        expect(buttons[1].classList.contains('cut-style-option--selected')).toBe(true);
    });

    it('displays the label and description for each option', () => {
        const section = createCutStylePicker({
            selectedIndex: 0,
            onSelect: vi.fn(),
        });

        const labels = section.querySelectorAll('.cut-style-label');
        const descs = section.querySelectorAll('.cut-style-desc');

        expect(labels[0].textContent).toBe('Classic');
        expect(labels[1].textContent).toBe('Fractal');
        expect(descs[0].textContent).toBe('Traditional jigsaw tabs');
        expect(descs[1].textContent).toBe('Organic circle-packing');
    });

    it('calls onSelect when a style is clicked', () => {
        const onSelect = vi.fn();
        const section = createCutStylePicker({
            selectedIndex: 0,
            onSelect,
        });

        const buttons = section.querySelectorAll<HTMLButtonElement>('.cut-style-option');
        buttons[1].click();

        expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('updates the visual selection when clicking a different style', () => {
        const section = createCutStylePicker({
            selectedIndex: 0,
            onSelect: vi.fn(),
        });

        const buttons = section.querySelectorAll<HTMLButtonElement>('.cut-style-option');
        buttons[1].click();

        expect(buttons[0].classList.contains('cut-style-option--selected')).toBe(false);
        expect(buttons[1].classList.contains('cut-style-option--selected')).toBe(true);
    });
});
