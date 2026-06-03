/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the background colour picker adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundColourPicker } from './background-colour-picker.js';
import { BACKGROUND_COLOUR_PRESETS } from './background-colour.js';

describe('createBackgroundColourPicker', () => {
    it('adds the 🎨 button to the container', () => {
        const container = document.createElement('div');
        const cleanup = createBackgroundColourPicker({
            container,
            selectedId: BACKGROUND_COLOUR_PRESETS[0].id,
            onSelect: vi.fn(),
        });
        const button = container.querySelector('button.bg-colour-button');
        expect(button).toBeTruthy();
        cleanup();
    });

    it('opens a grid with one swatch per preset and reports selections', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onSelect = vi.fn();
        const cleanup = createBackgroundColourPicker({
            container,
            selectedId: 'indigo-darker',
            onSelect,
        });

        (container.querySelector('button.bg-colour-button') as HTMLButtonElement).click();
        const swatches = container.querySelectorAll('.swatch-grid .swatch');
        expect(swatches.length).toBe(BACKGROUND_COLOUR_PRESETS.length);

        (container.querySelector('[data-swatch-id="blue-default"]') as HTMLButtonElement).click();
        expect(onSelect).toHaveBeenCalledWith('blue-default');

        cleanup();
        document.body.removeChild(container);
    });
});
