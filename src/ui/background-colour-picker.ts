/**
 * Background colour picker — the 🎨 toolbar button that opens a swatch
 * grid for changing the puzzle table background. A thin adapter over the
 * reusable `createSwatchPicker`, feeding it the extended palette.
 */

import { BACKGROUND_COLOUR_PRESETS } from './background-colour.js';
import { createSwatchPicker } from './swatch-picker.js';

export interface BackgroundColourPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Currently selected colour id. */
    selectedId: string;
    /** Called when the player selects a colour. Receives the preset id. */
    onSelect: (id: string) => void;
}

/**
 * Create and attach the background colour picker (button + popover).
 * Returns a cleanup function that removes the picker from the DOM.
 */
export function createBackgroundColourPicker(
    options: BackgroundColourPickerOptions,
): () => void {
    return createSwatchPicker({
        container: options.container,
        button: {
            icon: '🎨',
            title: 'Background colour',
            className: 'bg-colour-button',
        },
        ariaLabel: 'Background colour',
        panelClassName: 'bg-colour-panel',
        swatches: BACKGROUND_COLOUR_PRESETS,
        selectedId: options.selectedId,
        onSelect: options.onSelect,
        columnCount: 20,
    });
}
