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
import { CUT_STYLE_OPTIONS } from '../game/cut-styles.js';

/** Composable generator config passed through from sliders. */
export interface ComposableSliderConfig {
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    disableTabs: boolean;
}

export interface SizePickerOptions {
    /** Container to append the dialog to. */
    container: HTMLElement;
    /** Currently selected size index (highlighted in the dialog). */
    selectedIndex: number;
    /** Currently selected cut style index. */
    selectedCutStyleIndex?: number;
    /** Called when the player selects a size. */
    onSelect: (index: number, cutStyleIndex?: number, composableConfig?: ComposableSliderConfig, imageSource?: string) => void;
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

    // Store button elements for re-rendering when cut style changes
    const sizeButtons: HTMLButtonElement[] = [];

    /**
     * Update the content of size buttons based on the current cut style.
     */
    function updateSizeButtons(): void {
        const currentCutStyle = CUT_STYLE_OPTIONS[currentCutStyleIndex];
        const isFractal = currentCutStyle.id === 'fractal';

        for (let i = 0; i < sizeButtons.length; i++) {
            const btn = sizeButtons[i];
            const opt = PUZZLE_SIZE_OPTIONS[i];

            // Clear existing content
            btn.innerHTML = '';

            const count = document.createElement('span');
            count.className = 'size-picker-count';
            count.textContent = isFractal ? `~${opt.pieceCount}` : String(opt.pieceCount);

            const label = document.createElement('span');
            label.className = 'size-picker-label';
            label.textContent = 'pieces';

            btn.appendChild(count);
            btn.appendChild(label);

            // Only show dimensions for classic cut style
            if (!isFractal) {
                const dims = document.createElement('span');
                dims.className = 'size-picker-dims';
                dims.textContent = `${opt.cols} × ${opt.rows}`;
                btn.appendChild(dims);
            }
        }
    }

    // Create size buttons
    for (let i = 0; i < PUZZLE_SIZE_OPTIONS.length; i++) {
        const opt = PUZZLE_SIZE_OPTIONS[i];
        const btn = document.createElement('button');
        btn.className = `size-picker-option size-picker-option--${getSizeClass(opt.pieceCount)}`;
        btn.type = 'button';

        if (i === selectedIndex) {
            btn.classList.add('size-picker-option--selected');
        }

        btn.addEventListener('click', () => {
            dismiss();
            const composableConfig = currentCutStyleIndex === composableCutIndex
                ? getSliderValues()
                : undefined;
            onSelect(i, currentCutStyleIndex, composableConfig, imageSourceSelect.value);
        });

        sizeButtons.push(btn);
        grid.appendChild(btn);
    }

    // Initial render of size buttons
    updateSizeButtons();

    // Composable sliders container (populated below, visibility toggled here)
    const composableCutIndex = CUT_STYLE_OPTIONS.findIndex(o => o.id === 'composable');
    const slidersSection = document.createElement('div');
    slidersSection.className = 'composable-sliders';
    slidersSection.style.display = 'none';

    function updateSlidersVisibility(): void {
        slidersSection.style.display = currentCutStyleIndex === composableCutIndex ? 'block' : 'none';
    }

    // Cut style picker section (insert before size grid)
    const cutStyleSection = createCutStylePicker({
        selectedIndex: currentCutStyleIndex,
        onSelect: (index) => {
            currentCutStyleIndex = index;
            updateSizeButtons();
            updateSlidersVisibility();
        },
    });

    dialog.appendChild(cutStyleSection);

    // Image source selector
    const imageSourceSection = document.createElement('div');
    imageSourceSection.className = 'composable-slider-row';
    const imageSourceLabel = document.createElement('label');
    imageSourceLabel.className = 'composable-slider-label';
    imageSourceLabel.textContent = 'Image';
    const imageSourceSelect = document.createElement('select');
    imageSourceSelect.className = 'composable-slider-input';
    for (const [value, label] of [['random', 'Random photo'], ['blank', 'Blank (white)']]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        imageSourceSelect.appendChild(opt);
    }
    imageSourceSection.appendChild(imageSourceLabel);
    imageSourceSection.appendChild(imageSourceSelect);
    dialog.appendChild(imageSourceSection);

    dialog.appendChild(grid);

    // --- Populate composable parameter sliders ---
    interface SliderDef {
        id: string;
        label: string;
        min: number;
        max: number;
        step: number;
        defaultValue: number;
    }

    const sliderDefs: SliderDef[] = [
        { id: 'horizontalAmplitude', label: 'H Amplitude', min: 0, max: 0.5, step: 0.01, defaultValue: 0.15 },
        { id: 'horizontalFrequency', label: 'H Frequency', min: 0, max: 10, step: 0.1, defaultValue: 1.5 },
        { id: 'verticalAmplitude', label: 'V Amplitude', min: 0, max: 0.5, step: 0.01, defaultValue: 0.15 },
        { id: 'verticalFrequency', label: 'V Frequency', min: 0, max: 10, step: 0.1, defaultValue: 1.5 },

    ];

    const sliderInputs: Map<string, HTMLInputElement> = new Map();

    for (const def of sliderDefs) {
        const row = document.createElement('div');
        row.className = 'composable-slider-row';

        const lbl = document.createElement('label');
        lbl.className = 'composable-slider-label';
        lbl.textContent = def.label;

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'composable-slider-value';
        valueDisplay.textContent = String(def.defaultValue);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'composable-slider-input';
        input.min = String(def.min);
        input.max = String(def.max);
        input.step = String(def.step);
        input.value = String(def.defaultValue);

        input.addEventListener('input', () => {
            valueDisplay.textContent = input.value;
        });

        sliderInputs.set(def.id, input);

        row.appendChild(lbl);
        row.appendChild(input);
        row.appendChild(valueDisplay);
        slidersSection.appendChild(row);
    }

    function getSliderValues(): ComposableSliderConfig {
        return {
            horizontalAmplitude: parseFloat(sliderInputs.get('horizontalAmplitude')!.value),
            horizontalFrequency: parseFloat(sliderInputs.get('horizontalFrequency')!.value),
            verticalAmplitude: parseFloat(sliderInputs.get('verticalAmplitude')!.value),
            verticalFrequency: parseFloat(sliderInputs.get('verticalFrequency')!.value),
            disableTabs: disableTabsCheckbox?.checked ?? false,
        };
    }

    // Disable tabs checkbox
    const checkboxRow = document.createElement('div');
    checkboxRow.className = 'composable-slider-row';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'composable-slider-label';
    checkboxLabel.textContent = 'Disable Tabs';

    const disableTabsCheckbox = document.createElement('input');
    disableTabsCheckbox.type = 'checkbox';
    disableTabsCheckbox.checked = false;

    checkboxRow.appendChild(checkboxLabel);
    checkboxRow.appendChild(disableTabsCheckbox);
    slidersSection.appendChild(checkboxRow);

    dialog.appendChild(slidersSection);
    updateSlidersVisibility();

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
