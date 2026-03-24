/**
 * Cut style picker — lets the player choose the puzzle cut style.
 *
 * Creates a row of style option buttons that can be embedded
 * in the new-game dialog alongside the size picker.
 */

import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';

export interface CutStylePickerOptions {
    /** Currently selected cut style index. */
    selectedIndex: number;
    /** Called when the player selects a style. Receives the option index. */
    onSelect: (index: number) => void;
}

/**
 * Create the cut style picker section (title + option buttons).
 *
 * Returns a container element to append to a dialog.
 * When a style is selected, its button gets the selected class
 * and onSelect is called.
 */
export function createCutStylePicker(options: CutStylePickerOptions): HTMLElement {
    const { selectedIndex, onSelect } = options;

    const section = document.createElement('div');
    section.className = 'cut-style-section';

    const title = document.createElement('h3');
    title.className = 'cut-style-title';
    title.textContent = 'Cut Style';
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cut-style-grid';

    const buttons: HTMLButtonElement[] = [];

    for (let i = 0; i < CUT_STYLE_OPTIONS.length; i++) {
        const opt = CUT_STYLE_OPTIONS[i];
        const btn = document.createElement('button');
        btn.className = 'cut-style-option';
        btn.type = 'button';

        if (i === selectedIndex) {
            btn.classList.add('cut-style-option--selected');
        }

        const label = document.createElement('span');
        label.className = 'cut-style-label';
        label.textContent = opt.label;

        const desc = document.createElement('span');
        desc.className = 'cut-style-desc';
        desc.textContent = opt.description;

        btn.appendChild(label);
        btn.appendChild(desc);

        const index = i;
        btn.addEventListener('click', () => {
            // Update visual selection
            for (const b of buttons) {
                b.classList.remove('cut-style-option--selected');
            }

            btn.classList.add('cut-style-option--selected');
            onSelect(index);
        });

        buttons.push(btn);
        grid.appendChild(btn);
    }

    section.appendChild(grid);

    return section;
}
