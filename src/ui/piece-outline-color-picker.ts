/**
 * Piece-outline color picker — a swatch-grid picker for the 1px outline
 * color, shown in the info modal's Piece-outline setting when the
 * "Outline" style is active. A thin adapter over the reusable
 * `createSwatchPicker`, feeding it the extended palette.
 *
 * The trigger button has no icon; it previews the current outline color
 * via CSS (`.outline-color-button` background = `var(--piece-outline-color)`).
 */

import { PIECE_OUTLINE_COLOR_PRESETS } from './piece-outline-color.js';
import { createSwatchPicker } from './swatch-picker.js';

export interface PieceOutlineColorPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Currently selected color id. */
    selectedId: string;
    /** Called when the player selects a color. Receives the preset id. */
    onSelect: (id: string) => void;
}

/**
 * Create and attach the outline color picker (button + popover).
 * Returns a cleanup function that removes the picker from the DOM.
 */
export function createPieceOutlineColorPicker(
    options: PieceOutlineColorPickerOptions,
): () => void {
    const picker = createSwatchPicker({
        container: options.container,
        button: {
            // No glyph — the button's background previews the current color.
            icon: '',
            title: 'Outline colour',
            className: 'outline-color-button',
        },
        ariaLabel: 'Outline colour',
        panelClassName: 'outline-color-panel',
        swatches: PIECE_OUTLINE_COLOR_PRESETS,
        selectedId: options.selectedId,
        onSelect: options.onSelect,
        columnCount: 20,
    });
    return () => picker.dispose();
}
