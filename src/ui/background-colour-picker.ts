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
    /** Currently selected colour index. */
    selectedIndex: number;
    /** Called when the player selects a colour. Receives the preset index. */
    onSelect: (index: number) => void;
}

/**
 * Create the swatch element for a single colour preset.
 */
export function createSwatch(
    preset: BackgroundColourPreset,
    index: number,
    isSelected: boolean,
): HTMLButtonElement {
    const swatch = document.createElement('button');
    swatch.className = 'bg-colour-swatch';
    swatch.type = 'button';
    swatch.style.backgroundColor = preset.colour;
    swatch.setAttribute('aria-label', preset.label);
    swatch.title = preset.label;
    swatch.dataset.colourIndex = String(index);

    if (isSelected) {
        swatch.classList.add('bg-colour-swatch--selected');
    }

    return swatch;
}

/**
 * Create the popover panel containing all colour swatches.
 */
export function createPickerPanel(
    selectedIndex: number,
    onSelect: (index: number) => void,
    onDismiss: () => void,
): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'bg-colour-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Background colour');

    for (let i = 0; i < BACKGROUND_COLOUR_PRESETS.length; i++) {
        const preset = BACKGROUND_COLOUR_PRESETS[i];
        const isSelected = i === selectedIndex;
        const swatch = createSwatch(preset, i, isSelected);
        swatch.setAttribute('role', 'option');
        swatch.setAttribute('aria-selected', String(isSelected));

        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(i);
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
    let currentIndex = options.selectedIndex;

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
            currentIndex,
            (index) => {
                currentIndex = index;
                onSelect(index);
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
