/**
 * Size picker dialog — lets the player choose puzzle size
 * before starting a new game.
 *
 * Shows a modal overlay with size options as buttons.
 * Selecting a size dismisses the dialog and triggers the callback.
 * The dialog can also be dismissed by clicking the backdrop or pressing Escape.
 */

import { PUZZLE_SIZE_OPTIONS } from '../game/puzzle-sizes.js';
import { createCutStylePicker } from './cut-style-picker.js';

export interface SizePickerOptions {
    /** Container to append the dialog to. */
    container: HTMLElement;
    /** Currently selected size index (highlighted in the dialog). */
    selectedIndex: number;
    /** Currently selected cut style index. */
    selectedCutStyleIndex?: number;
    /** Called when the player selects a size. Receives the size and cut style indices. */
    onSelect: (index: number, cutStyleIndex?: number) => void;
    /** Called when the dialog is dismissed without selecting. */
    onCancel?: () => void;
}

/**
 * Determine the CSS class suffix for a size option based on its piece count.
 * Used for visual differentiation of the size buttons.
 */
export function getSizeClass(pieceCount: number): string {
    if (pieceCount <= 24) return 'small';
    if (pieceCount <= 48) return 'medium';
    if (pieceCount <= 96) return 'large';

    return 'xlarge';
}

/**
 * Create and show the size picker dialog.
 *
 * Returns a cleanup function that removes the dialog from the DOM.
 */
export function createSizePickerDialog(options: SizePickerOptions): () => void {
    const { container, selectedIndex, onSelect, onCancel } = options;

    // Track the current cut style selection
    let currentCutStyleIndex = options.selectedCutStyleIndex ?? 0;

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'size-picker-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'size-picker-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'New game options');

    const title = document.createElement('h2');
    title.className = 'size-picker-title';
    title.textContent = 'New Game';
    dialog.appendChild(title);

    // Cut style picker section
    const cutStyleSection = createCutStylePicker({
        selectedIndex: currentCutStyleIndex,
        onSelect: (index) => {
            currentCutStyleIndex = index;
        },
    });
    dialog.appendChild(cutStyleSection);

    // Size section title
    const sizeTitle = document.createElement('h3');
    sizeTitle.className = 'size-picker-subtitle';
    sizeTitle.textContent = 'Puzzle Size';
    dialog.appendChild(sizeTitle);

    const grid = document.createElement('div');
    grid.className = 'size-picker-grid';

    function dismiss(): void {
        overlay.remove();
        document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            dismiss();
            onCancel?.();
        }
    }

    for (let i = 0; i < PUZZLE_SIZE_OPTIONS.length; i++) {
        const opt = PUZZLE_SIZE_OPTIONS[i];
        const btn = document.createElement('button');
        btn.className = `size-picker-option size-picker-option--${getSizeClass(opt.pieceCount)}`;
        btn.type = 'button';

        if (i === selectedIndex) {
            btn.classList.add('size-picker-option--selected');
        }

        const count = document.createElement('span');
        count.className = 'size-picker-count';
        count.textContent = String(opt.pieceCount);

        const label = document.createElement('span');
        label.className = 'size-picker-label';
        label.textContent = 'pieces';

        const dims = document.createElement('span');
        dims.className = 'size-picker-dims';
        dims.textContent = `${opt.cols} × ${opt.rows}`;

        btn.appendChild(count);
        btn.appendChild(label);
        btn.appendChild(dims);

        btn.addEventListener('click', () => {
            dismiss();
            onSelect(i, currentCutStyleIndex);
        });

        grid.appendChild(btn);
    }

    dialog.appendChild(grid);
    overlay.appendChild(dialog);

    // Dismiss on backdrop click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            dismiss();
            onCancel?.();
        }
    });

    // Dismiss on Escape
    document.addEventListener('keydown', handleKeyDown);

    container.appendChild(overlay);

    return dismiss;
}
