/**
 * The caller decides which options to show — on production builds,
 * `getVisibleCutStyleOptions()` in `game/cut-styles.ts` filters
 * Composable out.
 */

import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';
import type { CutStyleOption } from '../game/cut-styles.js';

export interface CutStylePickerOptions {
    selectedCutStyleId: string;
    options?: readonly CutStyleOption[];
    onSelect: (id: string) => void;
}

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
