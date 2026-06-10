/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the piece-outline color picker adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPieceOutlineColorPicker } from './piece-outline-color-picker.js';
import { PIECE_OUTLINE_COLOR_PRESETS } from './piece-outline-color.js';

describe('createPieceOutlineColorPicker', () => {
    it('adds the outline-color button to the container', () => {
        const container = document.createElement('div');
        const cleanup = createPieceOutlineColorPicker({
            container,
            selectedId: PIECE_OUTLINE_COLOR_PRESETS[0].id,
            onSelect: vi.fn(),
        });
        expect(container.querySelector('button.outline-color-button')).toBeTruthy();
        cleanup();
    });

    it('opens a grid with one swatch per preset and reports selections', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onSelect = vi.fn();
        const cleanup = createPieceOutlineColorPicker({
            container,
            selectedId: 'gray-darker-3',
            onSelect,
        });

        (
            container.querySelector(
                'button.outline-color-button',
            ) as HTMLButtonElement
        ).click();
        const swatches = container.querySelectorAll('.swatch-grid .swatch');
        expect(swatches.length).toBe(PIECE_OUTLINE_COLOR_PRESETS.length);
        // The adapter supplies its own panel-positioning class.
        expect(
            container.querySelector('.swatch-grid.outline-color-panel'),
        ).toBeTruthy();

        (
            container.querySelector(
                '[data-swatch-id="blue-default"]',
            ) as HTMLButtonElement
        ).click();
        expect(onSelect).toHaveBeenCalledWith('blue-default');

        cleanup();
        document.body.removeChild(container);
    });
});
