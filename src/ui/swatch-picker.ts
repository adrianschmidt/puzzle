/**
 * Reusable swatch-grid picker: a button that opens a dismissable popover
 * containing a grid of colour swatches. Selecting a swatch fires
 * `onSelect(id)` and closes the popover.
 *
 * The component is colour-source agnostic — callers pass swatches as
 * data — so it can back both the background-colour picker and the
 * piece-outline colour picker (#392).
 */

import { attachDismissablePopover } from './dismissable-overlay.js';

/**
 * A swatch to render. All fields must be caller-trusted: `colour` is
 * written to `style.backgroundColor` and `label` to `aria-label`/`title`,
 * so callers must not pass untrusted/user-supplied strings.
 */
export interface SwatchEntry {
    /** Stable id reported to `onSelect`. */
    id: string;
    /** Accessible label / tooltip. */
    label: string;
    /** CSS colour value shown in the swatch. */
    colour: string;
}

export interface SwatchPickerOptions {
    /** The container to append the button to. */
    container: HTMLElement;
    /** Trigger-button presentation. `className` positions the button. */
    button: { icon: string; title: string; className: string };
    /** Accessible label for the grid (listbox). */
    ariaLabel: string;
    /**
     * Extra class on the grid panel, added alongside `swatch-grid`. The
     * base `.swatch-grid` rule carries only generic appearance — each
     * instance supplies its own positioning via this class, so multiple
     * pickers (e.g. the background and outline pickers) can anchor
     * independently instead of stacking at the same coordinates.
     */
    panelClassName?: string;
    /** Swatches to render. */
    swatches: readonly SwatchEntry[];
    /** Currently selected swatch id. */
    selectedId: string;
    /** Called with the chosen swatch id. */
    onSelect: (id: string) => void;
    /** Grid column count (default 20). */
    columnCount?: number;
}

const DEFAULT_COLUMNS = 20;

/** Create a single swatch button. */
export function createSwatch(
    entry: SwatchEntry,
    isSelected: boolean,
): HTMLButtonElement {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.type = 'button';
    swatch.style.backgroundColor = entry.colour;
    swatch.setAttribute('role', 'option');
    swatch.setAttribute('aria-label', entry.label);
    swatch.setAttribute('aria-selected', String(isSelected));
    swatch.title = entry.label;
    swatch.dataset.swatchId = entry.id;

    if (isSelected) {
        swatch.classList.add('swatch--selected');
    }

    return swatch;
}

/** Create the grid panel (listbox of swatches). */
export function createSwatchGrid(
    swatches: readonly SwatchEntry[],
    selectedId: string,
    onSelect: (id: string) => void,
    onDismiss: () => void,
    opts: { ariaLabel: string; columnCount?: number; panelClassName?: string },
): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = opts.panelClassName
        ? `swatch-grid ${opts.panelClassName}`
        : 'swatch-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', opts.ariaLabel);
    grid.style.setProperty(
        '--swatch-columns',
        String(opts.columnCount ?? DEFAULT_COLUMNS),
    );

    for (const entry of swatches) {
        const swatch = createSwatch(entry, entry.id === selectedId);
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            onSelect(entry.id);
            onDismiss();
        });
        grid.appendChild(swatch);
    }

    return grid;
}

/**
 * Create and attach the swatch picker (button + popover). Returns a
 * cleanup function that removes the picker from the DOM.
 */
export function createSwatchPicker(options: SwatchPickerOptions): () => void {
    const { container, swatches, onSelect, ariaLabel, columnCount, panelClassName } =
        options;
    let currentId = options.selectedId;

    const button = document.createElement('button');
    button.className = options.button.className;
    button.type = 'button';
    button.title = options.button.title;
    button.setAttribute('aria-label', options.button.title);
    button.textContent = options.button.icon;

    let grid: HTMLDivElement | null = null;
    let dismissPopover: (() => void) | null = null;

    function dismissPanel(): void {
        if (dismissPopover) {
            dismissPopover();
            dismissPopover = null;
        }
        grid = null;
    }

    function showPanel(): void {
        if (grid) {
            dismissPanel();
            return;
        }

        grid = createSwatchGrid(
            swatches,
            currentId,
            (id) => {
                currentId = id;
                onSelect(id);
            },
            dismissPanel,
            { ariaLabel, columnCount, panelClassName },
        );

        button.after(grid);

        const handle = attachDismissablePopover({
            panel: grid,
            anchor: button,
            onDismiss: () => {
                grid = null;
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
