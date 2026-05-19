/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { createCutStylePicker } from './cut-style-picker.js';
import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';

describe('createCutStylePicker', () => {
    it('renders one button per option', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        const buttons = section.querySelectorAll('.cut-style-option');
        expect(buttons).toHaveLength(CUT_STYLE_OPTIONS.length);
    });

    it('renders only the provided options when given an explicit list', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            options: [CUT_STYLE_OPTIONS[0], CUT_STYLE_OPTIONS[1]],
            onSelect: vi.fn(),
        });
        const buttons = section.querySelectorAll('.cut-style-option');
        expect(buttons).toHaveLength(2);
    });

    it('marks the selected option', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'fractal',
            onSelect: vi.fn(),
        });
        const fractalBtn = section.querySelector(
            '[data-cut-style-id="fractal"]',
        ) as HTMLElement;
        expect(fractalBtn.classList.contains('cut-style-option--selected')).toBe(true);
        const classicBtn = section.querySelector(
            '[data-cut-style-id="classic"]',
        ) as HTMLElement;
        expect(classicBtn.classList.contains('cut-style-option--selected')).toBe(false);
    });

    it('calls onSelect with the option id when clicked', () => {
        const onSelect = vi.fn();
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            onSelect,
        });
        const btn = section.querySelector(
            '[data-cut-style-id="fractal"]',
        ) as HTMLButtonElement;
        btn.click();
        expect(onSelect).toHaveBeenCalledWith('fractal');
    });

    it('moves the selected class to the clicked option', () => {
        const section = createCutStylePicker({
            selectedCutStyleId: 'classic',
            onSelect: vi.fn(),
        });
        const classicBtn = section.querySelector(
            '[data-cut-style-id="classic"]',
        ) as HTMLButtonElement;
        const fractalBtn = section.querySelector(
            '[data-cut-style-id="fractal"]',
        ) as HTMLButtonElement;
        fractalBtn.click();
        expect(classicBtn.classList.contains('cut-style-option--selected')).toBe(false);
        expect(fractalBtn.classList.contains('cut-style-option--selected')).toBe(true);
    });
});
