/**
 * Background colour picker — a button that opens a small picker
 * with colour swatches for changing the puzzle table background.
 *
 * The picker appears as a popover anchored to the button.
 * Clicking a swatch selects that colour, persists the choice,
 * and applies it immediately.
 */

import {
    BACKGROUND_COLOUR_PRESETS,
    type BackgroundColourPreset,
} from './background-colour.js';
import { attachDismissablePopover } from './dismissable-overlay.js';

export interface BackgroundColourPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Currently selected colour id. */
    selectedId: string;
    /** Called when the player selects a colour. Receives the preset id. */
    onSelect: (id: string) => void;
}

/**
 * Create the swatch element for a single colour preset.
 */
export function createSwatch(
    preset: BackgroundColourPreset,
    isSelected: boolean,
): HTMLButtonElement {
    const swatch = document.createElement('button');
    swatch.className = 'bg-colour-swatch';
    swatch.type = 'button';
    swatch.style.backgroundColor = preset.colour;
    swatch.setAttribute('aria-label', preset.label);
    swatch.title = preset.label;
    swatch.dataset.colourId = preset.id;

    if (isSelected) {
        swatch.classList.add('bg-colour-swatch--selected');
    }

    return swatch;
}

/**
 * Create the popover panel containing all colour swatches.
 */
export function createPickerPanel(
    selectedId: string,
    onSelect: (id: string) => void,
    onDismiss: () => void,
): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'bg-colour-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Background colour');

    for (const preset of BACKGROUND_COLOUR_PRESETS) {
        const isSelected = preset.id === selectedId;
        const swatch = createSwatch(preset, isSelected);
        swatch.setAttribute('role', 'option');
        swatch.setAttribute('aria-selected', String(isSelected));

        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(preset.id);
            onDismiss();
        });

        panel.appendChild(swatch);
    }

    return panel;
}

/**
 * Create and attach the background colour picker (button + popover).
 *
 * Returns a cleanup function that removes the picker from the DOM.
 */
export function createBackgroundColourPicker(
    options: BackgroundColourPickerOptions,
): () => void {
    const { container, onSelect } = options;
    let currentId = options.selectedId;

    const button = document.createElement('button');
    button.className = 'bg-colour-button';
    button.type = 'button';
    button.title = 'Background colour';
    button.setAttribute('aria-label', 'Background colour');
    button.innerHTML = '🎨';

    let panel: HTMLDivElement | null = null;
    let dismissPopover: (() => void) | null = null;

    function dismissPanel(): void {
        if (dismissPopover) {
            dismissPopover();
            dismissPopover = null;
        }
        panel = null;
    }

    function showPanel(): void {
        if (panel) {
            dismissPanel();

            return;
        }

        panel = createPickerPanel(
            currentId,
            (id) => {
                currentId = id;
                onSelect(id);
            },
            dismissPanel,
        );

        button.after(panel);

        const handle = attachDismissablePopover({
            panel,
            anchor: button,
            onDismiss: () => {
                // The helper already removed the panel; clear our refs so
                // the next click reopens cleanly.
                panel = null;
                dismissPopover = null;
            },
        });
        dismissPopover = handle.dismiss;
    }

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        showPanel();
    });

    container.appendChild(button);

    return () => {
        dismissPanel();
        button.remove();
    };
}
