/**
 * Cut style picker — lets the player choose the puzzle cut style.
 *
 * Renders one button per provided option. The caller decides which
 * options to show — on production builds, `getVisibleCutStyleOptions()`
 * in `game/cut-styles.ts` filters Composable out.
 */

import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';
import type { CutStyleOption } from '../game/cut-styles.js';

export interface CutStylePickerOptions {
    /** Currently selected cut style id. */
    selectedCutStyleId: string;
    /** Options to render. Defaults to all known options. */
    options?: readonly CutStyleOption[];
    /** Called when the player selects a style. Receives the option id. */
    onSelect: (id: string) => void;
}

/**
 * Create the cut style picker section (title + option buttons).
 */
export function createCutStylePicker(opts: CutStylePickerOptions): HTMLElement {
    const { selectedCutStyleId, onSelect } = opts;
    const options = opts.options ?? CUT_STYLE_OPTIONS;

    const section = document.createElement('div');
    section.className = 'cut-style-section';

    const title = document.createElement('h3');
    title.className = 'cut-style-title';
    title.textContent = 'Cut Style';
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'cut-style-grid';

    const buttons: HTMLButtonElement[] = [];

    for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'cut-style-option';
        btn.type = 'button';
        btn.dataset.cutStyleId = opt.id;

        if (opt.id === selectedCutStyleId) {
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

        btn.addEventListener('click', () => {
            for (const b of buttons) {
                b.classList.remove('cut-style-option--selected');
            }
            btn.classList.add('cut-style-option--selected');
            onSelect(opt.id);
        });

        buttons.push(btn);
        grid.appendChild(btn);
    }

    section.appendChild(grid);
    return section;
}
