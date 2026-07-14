/**
 * Background color picker — the 🎨 toolbar button that opens a swatch
 * grid for changing the puzzle table background. A thin adapter over the
 * reusable `createSwatchPicker`, feeding it the extended palette.
 */

import { BACKGROUND_COLOR_PRESETS } from './background-color.js';
import { createSwatchPicker, type SwatchPickerHandle } from './swatch-picker.js';

export interface BackgroundColorPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Currently selected color id. */
    selectedId: string;
    /** Called when the player selects a color. Receives the preset id. */
    onSelect: (id: string) => void;
}

/**
 * Create and attach the background color picker (button + popover).
 * Returns a handle with `setSelected` and `dispose`.
 */
export function createBackgroundColorPicker(
    options: BackgroundColorPickerOptions,
): SwatchPickerHandle {
    return createSwatchPicker({
        container: options.container,
        button: {
            icon: '🎨',
            title: 'Background colour',
            className: 'bg-color-button',
        },
        ariaLabel: 'Background colour',
        panelClassName: 'bg-color-panel',
        swatches: BACKGROUND_COLOR_PRESETS,
        selectedId: options.selectedId,
        onSelect: options.onSelect,
        columnCount: 20,
    });
}
