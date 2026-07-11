/**
 * New-game dialog — modal that lets the player configure and start a new
 * puzzle. Despite the legacy `.size-picker-*` CSS classes, the dialog now
 * owns the cut-style picker, fractal/composable options, image-source
 * controls, and the size grid itself.
 *
 * The dialog is dismissed by picking a size, clicking the backdrop, or
 * pressing Escape. The latter two paths fire `onCancel`; size picks fire
 * `onSelect` with a {@link NewGameSelection}.
 */

import { PUZZLE_SIZE_OPTIONS } from '../game/puzzle-sizes.js';
import { createCutStylePicker } from './cut-style-picker.js';
import { DEFAULT_CUT_STYLE_ID, getVisibleCutStyleOptions } from '../game/cut-styles.js';
import { IMAGE_CATEGORY_OPTIONS } from '../game/image-categories.js';
import { createDismissableOverlay } from './dismissable-overlay.js';

/** Composable generator config passed through from sliders. */
export interface ComposableSliderConfig {
    baseCut: 'sine' | 'triangular';
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: 'classic' | 'traced' | 'none';
    borderless: boolean;
    jitter: number;
    smooth: boolean;
}

/** Fractal generator config passed through from the dialog. */
export interface FractalDialogConfig {
    borderless: boolean;
}

/** Wavy generator config passed through from the dialog. */
export interface WavyDialogConfig {
    borderless: boolean;
}

/** Everything the player chose in the new-game dialog. */
export interface NewGameSelection {
    sizeId: string;
    cutStyleId: string;
    /** Present only when the chosen cut style is composable. */
    composableConfig?: ComposableSliderConfig;
    /** Present only when the chosen cut style is fractal. */
    fractalConfig?: FractalDialogConfig;
    /** Present only when the chosen cut style is wavy. */
    wavyConfig?: WavyDialogConfig;
    /** Whether the player ticked the top-level "Enable rotation" checkbox. */
    rotationEnabled: boolean;
    imageSource: string;
    imageCategory: string;
    vibrant: boolean;
}

export interface NewGameDialogOptions {
    /** Container to append the dialog to. */
    container: HTMLElement;
    /** Currently selected size id (highlighted in the dialog). */
    selectedSizeId: string;
    /** Currently selected cut style id. */
    selectedCutStyleId?: string;
    /** Previously saved composable slider config (used to pre-populate sliders). */
    savedComposableConfig?: ComposableSliderConfig;
    /** Previously saved fractal config (used to pre-populate controls). */
    savedFractalConfig?: FractalDialogConfig;
    /** Previously saved wavy config (used to pre-populate the borderless toggle). */
    savedWavyConfig?: WavyDialogConfig;
    /** Previously saved rotation-enabled preference (defaults to false). */
    savedRotationEnabled?: boolean;
    /** Whether the composable base cut generator supports borderless mode. */
    composableSupportsBorderless?: boolean;
    /** Previously saved image source preference. */
    savedImageSource?: string;
    /** Previously saved image category preference. */
    savedImageCategory?: string;
    /** Previously saved "vibrant images" preference. */
    savedVibrant?: boolean;
    /** Called when the player selects a size. */
    onSelect: (selection: NewGameSelection) => void;
    /** Called when the dialog is dismissed without selecting. */
    onCancel?: () => void;
    /**
     * Fires as soon as the dialog's effective tab generator becomes
     * `'traced'` (on open with that saved value, on cut-style change
     * into Composable while traced is active, or when the user picks
     * the "Traced" radio). The host uses it to kick off the
     * traced-tab lazy chunk in the background so the click-to-puzzle
     * path stays snappy. Safe to invoke repeatedly — the preload
     * helper is idempotent.
     */
    onPreloadTracedTabs?: () => void;
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

interface SizeSection {
    element: HTMLElement;
    /** Re-render button labels (e.g. when cut style changes between fractal and classic). */
    updateLabels(): void;
}

/**
 * A cut-style options sub-section holding a single "Borderless" checkbox.
 * Both Fractal and Wavy render identically — only their test id differs —
 * so they share one builder. `getValues()` returns the structural
 * `{ borderless }` shape of both {@link FractalDialogConfig} and
 * {@link WavyDialogConfig}.
 */
interface BorderlessOptionsSection {
    element: HTMLElement;
    getValues(): { borderless: boolean };
    setVisible(visible: boolean): void;
}

interface ComposableSection {
    element: HTMLElement;
    getValues(): ComposableSliderConfig;
    setVisible(visible: boolean): void;
    /** Currently picked tab generator, regardless of section visibility. */
    getSelectedTabGenerator(): ComposableSliderConfig['tabGenerator'];
}

interface ImageSourceSection {
    element: HTMLElement;
    getValues(): { imageSource: string; imageCategory: string; vibrant: boolean };
}

function buildSizeSection(args: {
    selectedSizeId: string;
    getCutStyleId: () => string;
    onPick: (sizeId: string) => void;
}): SizeSection {
    const grid = document.createElement('div');
    grid.className = 'size-picker-grid';

    const buttons: HTMLButtonElement[] = [];

    for (const opt of PUZZLE_SIZE_OPTIONS) {
        const btn = document.createElement('button');
        btn.className = `size-picker-option size-picker-option--${getSizeClass(opt.pieceCount)}`;
        btn.type = 'button';
        btn.dataset.sizeId = opt.id;

        if (opt.id === args.selectedSizeId) {
            btn.classList.add('size-picker-option--selected');
        }

        btn.addEventListener('click', () => args.onPick(opt.id));

        buttons.push(btn);
        grid.appendChild(btn);
    }

    function updateLabels(): void {
        // Fractal and Triangles piece counts are approximate: fractal scales
        // an internal grid, and the triangle lattice derives its column count
        // from the image aspect ratio (unknown until the photo is fetched).
        // Both show ~N and omit the meaningless cols × rows line.
        const cutStyleId = args.getCutStyleId();
        const isApproximate = cutStyleId === 'fractal' || cutStyleId === 'triangles';

        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const opt = PUZZLE_SIZE_OPTIONS[i];

            btn.replaceChildren();

            const count = document.createElement('span');
            count.className = 'size-picker-count';
            count.textContent = isApproximate ? `~${opt.pieceCount}` : String(opt.pieceCount);

            const label = document.createElement('span');
            label.className = 'size-picker-label';
            label.textContent = 'pieces';

            btn.appendChild(count);
            btn.appendChild(label);

            if (!isApproximate) {
                const dims = document.createElement('span');
                dims.className = 'size-picker-dims';
                dims.textContent = `${opt.cols} × ${opt.rows}`;
                btn.appendChild(dims);
            }
        }
    }

    updateLabels();

    return { element: grid, updateLabels };
}

function buildBorderlessOptionsSection(args: {
    saved?: { borderless: boolean };
    testid: string;
}): BorderlessOptionsSection {
    const section = document.createElement('div');
    section.className = 'cut-style-options';

    const borderlessCheckbox = appendCheckboxRow(section, 'Borderless', args.saved?.borderless ?? false);
    borderlessCheckbox.dataset.testid = args.testid;

    return {
        element: section,
        getValues: () => ({
            borderless: borderlessCheckbox.checked,
        }),
        setVisible: (visible) => {
            section.style.display = visible ? 'block' : 'none';
        },
    };
}

function buildImageSourceSection(args: {
    savedImageSource?: string;
    savedImageCategory?: string;
    savedVibrant?: boolean;
}): ImageSourceSection {
    const section = document.createElement('div');
    section.className = 'image-source-section';

    const sourceRow = document.createElement('div');
    sourceRow.className = 'dialog-row';
    const sourceLabel = document.createElement('label');
    sourceLabel.className = 'dialog-row-label';
    sourceLabel.textContent = 'Image';
    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'dialog-row-input';
    for (const [value, label] of [['random', 'Random photo'], ['blank', 'Blank (white)']]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        sourceSelect.appendChild(opt);
    }
    if (args.savedImageSource) {
        sourceSelect.value = args.savedImageSource;
    }
    sourceRow.appendChild(sourceLabel);
    sourceRow.appendChild(sourceSelect);
    section.appendChild(sourceRow);

    const categoryRow = document.createElement('div');
    categoryRow.className = 'dialog-row';
    const categoryLabel = document.createElement('label');
    categoryLabel.className = 'dialog-row-label';
    categoryLabel.textContent = 'Picture Type';
    const categorySelect = document.createElement('select');
    categorySelect.className = 'dialog-row-input';
    for (const cat of IMAGE_CATEGORY_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.label;
        categorySelect.appendChild(opt);
    }
    if (args.savedImageCategory) {
        categorySelect.value = args.savedImageCategory;
    }
    categoryRow.appendChild(categoryLabel);
    categoryRow.appendChild(categorySelect);
    section.appendChild(categoryRow);

    // Vibrant-colors toggle — appends keywords like "vibrant colorful" to
    // the Unsplash query to bias results toward saturated photos.
    const vibrantRow = document.createElement('div');
    vibrantRow.className = 'dialog-row';
    const vibrantLabel = document.createElement('label');
    vibrantLabel.className = 'dialog-row-label';
    vibrantLabel.textContent = 'Vibrant colours';
    const vibrantCheckbox = document.createElement('input');
    vibrantCheckbox.type = 'checkbox';
    vibrantCheckbox.className = 'form-checkbox';
    vibrantCheckbox.checked = args.savedVibrant ?? false;
    vibrantRow.appendChild(vibrantLabel);
    vibrantRow.appendChild(vibrantCheckbox);
    section.appendChild(vibrantRow);

    function updateCategoryVisibility(): void {
        const hidden = sourceSelect.value === 'blank';
        categoryRow.style.display = hidden ? 'none' : '';
        vibrantRow.style.display = hidden ? 'none' : '';
    }

    sourceSelect.addEventListener('change', updateCategoryVisibility);
    updateCategoryVisibility();

    return {
        element: section,
        getValues: () => ({
            imageSource: sourceSelect.value,
            imageCategory: categorySelect.value,
            vibrant: vibrantCheckbox.checked,
        }),
    };
}

function buildComposableSlidersSection(args: {
    saved?: ComposableSliderConfig;
    showBorderless?: boolean;
    onTabGeneratorChange?: (value: ComposableSliderConfig['tabGenerator']) => void;
}): ComposableSection {
    const section = document.createElement('div');
    section.className = 'composable-sliders';

    // Sine controls wrapper — holds the four amplitude/frequency sliders.
    const sineControls = document.createElement('div');
    sineControls.dataset.testid = 'composable-sine-controls';

    // Triangular controls wrapper — holds the Irregularity (jitter) slider.
    const triangularControls = document.createElement('div');
    triangularControls.dataset.testid = 'composable-triangular-controls';

    // Borderless toggle wrapper — created up front so the visibility helper
    // can toggle it; appended to the section later in DOM order.
    const borderlessWrap = document.createElement('div');

    // Toggle control visibility for the chosen base cut: triangular hides the
    // sine sliders + Borderless and shows the Irregularity slider.
    const applyBaseCutVisibility = (baseCut: 'sine' | 'triangular'): void => {
        const tri = baseCut === 'triangular';
        sineControls.style.display = tri ? 'none' : 'block';
        triangularControls.style.display = tri ? 'block' : 'none';
        borderlessWrap.style.display = tri ? 'none' : 'block';
    };

    // Base-cut picker: Sine | Triangular.
    const baseCutRow = appendSegmentedRow<'sine' | 'triangular'>(
        section,
        'Base cut',
        [
            { value: 'sine', label: 'Sine' },
            { value: 'triangular', label: 'Triangular' },
        ],
        args.saved?.baseCut ?? 'sine',
        (value) => applyBaseCutVisibility(value),
    );

    interface SliderDef {
        id: keyof Omit<ComposableSliderConfig, 'tabGenerator' | 'borderless' | 'baseCut' | 'jitter'>;
        label: string;
        min: number;
        max: number;
        step: number;
        defaultValue: number;
    }

    const sliderDefs: SliderDef[] = [
        { id: 'horizontalAmplitude', label: 'H Amplitude', min: 0, max: 0.5, step: 0.01, defaultValue: args.saved?.horizontalAmplitude ?? 0.15 },
        { id: 'horizontalFrequency', label: 'H Frequency', min: 0, max: 10, step: 0.1, defaultValue: args.saved?.horizontalFrequency ?? 1.5 },
        { id: 'verticalAmplitude', label: 'V Amplitude', min: 0, max: 0.5, step: 0.01, defaultValue: args.saved?.verticalAmplitude ?? 0.15 },
        { id: 'verticalFrequency', label: 'V Frequency', min: 0, max: 10, step: 0.1, defaultValue: args.saved?.verticalFrequency ?? 1.5 },
    ];

    const sliderInputs = new Map<SliderDef['id'], HTMLInputElement>();

    for (const def of sliderDefs) {
        const row = document.createElement('div');
        row.className = 'dialog-row';

        const lbl = document.createElement('label');
        lbl.className = 'dialog-row-label';
        lbl.textContent = def.label;

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'dialog-row-value';
        valueDisplay.textContent = String(def.defaultValue);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'dialog-row-input';
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
        sineControls.appendChild(row);
    }

    section.appendChild(sineControls);

    // Irregularity (jitter) slider — lives in the triangular controls wrapper.
    const jitterRow = document.createElement('div');
    jitterRow.className = 'dialog-row';
    const jitterLabel = document.createElement('label');
    jitterLabel.className = 'dialog-row-label';
    jitterLabel.textContent = 'Irregularity';
    const jitterValue = document.createElement('span');
    jitterValue.className = 'dialog-row-value';
    const jitterInput = document.createElement('input');
    jitterInput.type = 'range';
    jitterInput.className = 'dialog-row-input';
    jitterInput.dataset.testid = 'composable-jitter-slider';
    jitterInput.min = '0';
    jitterInput.max = '0.5';
    jitterInput.step = '0.01';
    jitterInput.value = String(args.saved?.jitter ?? 0.15);
    jitterValue.textContent = jitterInput.value;
    jitterInput.addEventListener('input', () => { jitterValue.textContent = jitterInput.value; });
    jitterRow.appendChild(jitterLabel);
    jitterRow.appendChild(jitterInput);
    jitterRow.appendChild(jitterValue);
    triangularControls.appendChild(jitterRow);

    const smoothCheckbox = appendCheckboxRow(
        triangularControls,
        'Flowing edges',
        args.saved?.smooth ?? false,
    );
    smoothCheckbox.dataset.testid = 'composable-smooth-toggle';

    section.appendChild(triangularControls);

    // Traced has no dev/prod gate of its own — it inherits Composable's
    // visibility via `getVisibleCutStyleOptions()`. When Composable is
    // promoted to production, the 'Traced' radio ships with it. If
    // Traced should graduate independently (or stay dev-only), add an
    // explicit gate here before omitting/including the option.
    const tabGeneratorRow = appendSegmentedRow<'classic' | 'traced' | 'none'>(
        section,
        'Tab style',
        [
            { value: 'classic', label: 'Classic' },
            { value: 'traced',  label: 'Traced'  },
            { value: 'none',    label: 'None'    },
        ],
        args.saved?.tabGenerator ?? 'classic',
        args.onTabGeneratorChange,
    );

    // Borderless toggle — hidden for triangular cut since it doesn't apply.
    section.appendChild(borderlessWrap);
    const borderlessCheckbox = args.showBorderless
        ? appendCheckboxRow(borderlessWrap, 'Borderless', args.saved?.borderless ?? false)
        : null;
    if (borderlessCheckbox) borderlessCheckbox.dataset.testid = 'composable-borderless-toggle';

    applyBaseCutVisibility(args.saved?.baseCut ?? 'sine');

    return {
        element: section,
        getValues: () => ({
            baseCut: baseCutRow.getValue(),
            horizontalAmplitude: parseFloat(sliderInputs.get('horizontalAmplitude')!.value),
            horizontalFrequency: parseFloat(sliderInputs.get('horizontalFrequency')!.value),
            verticalAmplitude: parseFloat(sliderInputs.get('verticalAmplitude')!.value),
            verticalFrequency: parseFloat(sliderInputs.get('verticalFrequency')!.value),
            tabGenerator: tabGeneratorRow.getValue(),
            // Report the raw checkbox state; composableSliderToGeneratorConfig
            // forces borderless off for the triangular base cut, so coercing it
            // here too would be redundant — and would clobber the player's sine
            // borderless choice when they toggle back from triangular.
            borderless: borderlessCheckbox?.checked ?? false,
            jitter: parseFloat(jitterInput.value),
            smooth: smoothCheckbox.checked,
        }),
        setVisible: (visible) => {
            section.style.display = visible ? 'block' : 'none';
        },
        getSelectedTabGenerator: () => tabGeneratorRow.getValue(),
    };
}

interface SegmentedRow<T extends string> {
    getValue(): T;
}

/**
 * Module-scoped counter for unique DOM ids in `appendSegmentedRow`.
 * Increments on each row so two rows with the same label still get
 * distinct ids — important when the dialog is reopened (each open
 * builds a fresh DOM tree, but multiple rows may share a label).
 */
let nextSegmentedRowSuffix = 0;

/** Append a label + radio-group "segmented" row and return the value getter. */
function appendSegmentedRow<T extends string>(
    parent: HTMLElement,
    labelText: string,
    options: ReadonlyArray<{ value: T; label: string }>,
    initialValue: T,
    onChange?: (value: T) => void,
): SegmentedRow<T> {
    const row = document.createElement('div');
    row.className = 'dialog-row';

    const groupSlug = `${labelText.replace(/\s+/g, '-').toLowerCase()}-${nextSegmentedRowSuffix++}`;
    const labelId = `seg-label-${groupSlug}`;

    const label = document.createElement('label');
    label.className = 'dialog-row-label';
    label.id = labelId;
    label.textContent = labelText;

    const group = document.createElement('div');
    group.className = 'segmented-control';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', labelId);

    const groupName = `seg-${groupSlug}`;
    const inputs: HTMLInputElement[] = [];

    for (const opt of options) {
        const optLabel = document.createElement('label');
        optLabel.className = 'segmented-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = opt.value;
        if (opt.value === initialValue) input.checked = true;
        if (onChange) {
            input.addEventListener('change', () => {
                if (input.checked) onChange(opt.value);
            });
        }
        inputs.push(input);

        const text = document.createElement('span');
        text.textContent = opt.label;

        optLabel.appendChild(input);
        optLabel.appendChild(text);
        group.appendChild(optLabel);
    }

    row.appendChild(label);
    row.appendChild(group);
    parent.appendChild(row);

    return {
        getValue: (): T => {
            const checked = inputs.find(i => i.checked);
            return (checked ? (checked.value as T) : initialValue);
        },
    };
}

/** Append a label + checkbox row and return the checkbox. */
function appendCheckboxRow(
    parent: HTMLElement,
    labelText: string,
    initialChecked: boolean,
): HTMLInputElement {
    const row = document.createElement('div');
    row.className = 'dialog-row';

    const label = document.createElement('label');
    label.className = 'dialog-row-label';
    label.textContent = labelText;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-checkbox';
    checkbox.checked = initialChecked;

    row.appendChild(label);
    row.appendChild(checkbox);
    parent.appendChild(row);

    return checkbox;
}

/**
 * Create and show the new-game dialog.
 *
 * Returns a cleanup function that removes the dialog from the DOM.
 */
export function createNewGameDialog(options: NewGameDialogOptions): () => void {
    const { container, selectedSizeId, onSelect, onCancel } = options;

    let currentCutStyleId: string = options.selectedCutStyleId ?? DEFAULT_CUT_STYLE_ID;

    const visibleOptions = getVisibleCutStyleOptions();
    if (!visibleOptions.some((o) => o.id === currentCutStyleId)) {
        currentCutStyleId = DEFAULT_CUT_STYLE_ID;
    }

    // The helper owns Escape/backdrop dismissal and fires onCancel only on
    // those paths — not when the caller invokes dismiss() after picking a
    // size.
    const { overlay, dismiss } = createDismissableOverlay({
        container,
        className: 'size-picker-overlay',
        onDismiss: onCancel,
    });

    const dialog = document.createElement('div');
    dialog.className = 'size-picker-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'New game options');

    const title = document.createElement('h2');
    title.className = 'size-picker-title';
    title.textContent = 'New Game';
    dialog.appendChild(title);

    const sizeSubtitle = document.createElement('h3');
    sizeSubtitle.className = 'size-picker-subtitle';
    sizeSubtitle.textContent = 'Puzzle Size';
    dialog.appendChild(sizeSubtitle);

    const fractalSection = buildBorderlessOptionsSection({
        saved: options.savedFractalConfig,
        testid: 'fractal-borderless-toggle',
    });
    const wavySection = buildBorderlessOptionsSection({
        saved: options.savedWavyConfig,
        testid: 'wavy-borderless-toggle',
    });
    const composableSection = buildComposableSlidersSection({
        saved: options.savedComposableConfig,
        showBorderless: options.composableSupportsBorderless ?? false,
        onTabGeneratorChange: (value) => {
            if (value === 'traced') options.onPreloadTracedTabs?.();
        },
    });
    const imageSourceSection = buildImageSourceSection({
        savedImageSource: options.savedImageSource,
        savedImageCategory: options.savedImageCategory,
        savedVibrant: options.savedVibrant,
    });

    // Top-level "Enable rotation" row — applies to any cut style.
    const rotationRow = document.createElement('div');
    rotationRow.className = 'rotation-row';
    const rotationCheckbox = appendCheckboxRow(
        rotationRow,
        'Enable rotation',
        options.savedRotationEnabled ?? false,
    );

    const sizeSection = buildSizeSection({
        selectedSizeId,
        getCutStyleId: () => currentCutStyleId,
        onPick: (sizeId) => {
            dismiss();
            onSelect({
                sizeId,
                cutStyleId: currentCutStyleId,
                composableConfig: currentCutStyleId === 'composable'
                    ? composableSection.getValues()
                    : undefined,
                fractalConfig: currentCutStyleId === 'fractal'
                    ? fractalSection.getValues()
                    : undefined,
                wavyConfig: currentCutStyleId === 'wavy'
                    ? wavySection.getValues()
                    : undefined,
                rotationEnabled: rotationCheckbox.checked,
                ...imageSourceSection.getValues(),
            });
        },
    });

    const cutStyleSection = createCutStylePicker({
        selectedCutStyleId: currentCutStyleId,
        options: visibleOptions,
        onSelect: (id) => {
            currentCutStyleId = id;
            sizeSection.updateLabels();
            fractalSection.setVisible(id === 'fractal');
            wavySection.setVisible(id === 'wavy');
            composableSection.setVisible(id === 'composable');
            if (id === 'wavy' || id === 'triangles'
                || (id === 'composable' && composableSection.getSelectedTabGenerator() === 'traced')) {
                options.onPreloadTracedTabs?.();
            }
        },
    });

    fractalSection.setVisible(currentCutStyleId === 'fractal');
    wavySection.setVisible(currentCutStyleId === 'wavy');
    composableSection.setVisible(currentCutStyleId === 'composable');

    // Cover the "open with traced tabs already selected" paths so the lazy
    // chunk starts loading even if the user never touches a radio: Wavy (always
    // traced) or Composable with the Traced tab generator saved.
    if (currentCutStyleId === 'wavy' || currentCutStyleId === 'triangles'
        || (currentCutStyleId === 'composable' && composableSection.getSelectedTabGenerator() === 'traced')) {
        options.onPreloadTracedTabs?.();
    }

    dialog.appendChild(cutStyleSection);
    dialog.appendChild(rotationRow);
    dialog.appendChild(fractalSection.element);
    dialog.appendChild(wavySection.element);
    dialog.appendChild(imageSourceSection.element);
    dialog.appendChild(sizeSection.element);
    dialog.appendChild(composableSection.element);

    overlay.appendChild(dialog);

    return dismiss;
}
