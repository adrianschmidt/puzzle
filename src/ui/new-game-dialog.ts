/**
 * Despite the legacy `.size-picker-*` CSS classes, the dialog owns the
 * cut-style picker, fractal/composable options, image-options controls,
 * the size select, and the image picker itself.
 */

import { PUZZLE_SIZE_OPTIONS } from '../game/puzzle-sizes.js';
import { createCutStylePicker } from './cut-style-picker.js';
import { cutStyleNeedsTracedTabs, DEFAULT_CUT_STYLE_ID, getVisibleCutStyleOptions } from '../game/cut-styles.js';
import { IMAGE_CATEGORY_OPTIONS } from '../game/image-categories.js';
import { createDismissableOverlay } from './dismissable-overlay.js';
import { createImagePicker, type ImagePicker, type NewGameImageChoice } from './image-picker.js';
import type { CandidateImage } from '../app/unsplash-display-image.js';

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

export interface FractalDialogConfig {
    borderless: boolean;
}

export interface WavyDialogConfig {
    borderless: boolean;
}

export interface NewGameSelection {
    sizeId: string;
    cutStyleId: string;
    /** Present only when the chosen cut style is composable. */
    composableConfig?: ComposableSliderConfig;
    /** Present only when the chosen cut style is fractal. */
    fractalConfig?: FractalDialogConfig;
    /** Present only when the chosen cut style is wavy. */
    wavyConfig?: WavyDialogConfig;
    rotationEnabled: boolean;
    imageChoice: NewGameImageChoice;
    imageCategory: string;
    vibrant: boolean;
}

export interface NewGameDialogOptions {
    container: HTMLElement;
    selectedSizeId: string;
    selectedCutStyleId?: string;
    savedComposableConfig?: ComposableSliderConfig;
    savedFractalConfig?: FractalDialogConfig;
    savedWavyConfig?: WavyDialogConfig;
    savedRotationEnabled?: boolean;
    composableSupportsBorderless?: boolean;
    savedImageCategory?: string;
    savedVibrant?: boolean;
    /** Absent when no image proxy is configured — the picker hides its grid. */
    fetchImageCandidates?: (
        imageCategory: string,
        vibrant: boolean,
    ) => Promise<CandidateImage[] | null>;
    /** Called when the player picks an image (photo tile, Surprise me, or Blank puzzle). */
    onSelect: (selection: NewGameSelection) => void;
    /** Called when the dialog is dismissed without selecting. */
    onCancel?: () => void;
    /**
     * Fires as soon as the dialog's effective tab generator becomes
     * `'traced'`. The host uses it to kick off the traced-tab lazy chunk
     * in the background so the click-to-puzzle path stays snappy. Safe to
     * invoke repeatedly — the preload helper is idempotent.
     */
    onPreloadTracedTabs?: () => void;
}

interface SizeSelectRow {
    element: HTMLElement;
    getValue(): string;
    updateLabels(): void;
}

/**
 * Both Fractal and Wavy render identically — only their test id differs —
 * so they share one builder.
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

interface ImageOptionsSection {
    element: HTMLElement;
    getValues(): { imageCategory: string; vibrant: boolean };
}

function buildSizeSelectRow(args: {
    selectedSizeId: string;
    getCutStyleId: () => string;
}): SizeSelectRow {
    const row = document.createElement('div');
    row.className = 'dialog-row';

    const label = document.createElement('label');
    label.className = 'dialog-row-label';
    label.textContent = 'Puzzle size';

    const select = document.createElement('select');
    select.className = 'dialog-row-input';
    select.dataset.testid = 'size-select';
    for (const opt of PUZZLE_SIZE_OPTIONS) {
        const el = document.createElement('option');
        el.value = opt.id;
        select.appendChild(el);
    }
    select.value = args.selectedSizeId;

    function updateLabels(): void {
        // Fractal and Triangles piece counts are approximate: fractal scales
        // an internal grid, and the triangle lattice derives its column count
        // from the image aspect ratio (unknown until the photo is fetched).
        // Both therefore show ~N rather than an exact piece count.
        const cutStyleId = args.getCutStyleId();
        const isApproximate = cutStyleId === 'fractal' || cutStyleId === 'triangles';
        const optionEls = select.querySelectorAll('option');
        PUZZLE_SIZE_OPTIONS.forEach((opt, i) => {
            optionEls[i].textContent = isApproximate
                ? `~${opt.pieceCount} pieces`
                : `${opt.pieceCount} pieces`;
        });
    }

    updateLabels();

    row.appendChild(label);
    row.appendChild(select);

    return { element: row, getValue: () => select.value, updateLabels };
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

function buildImageOptionsSection(args: {
    savedImageCategory?: string;
    savedVibrant?: boolean;
    onChange: () => void;
}): ImageOptionsSection {
    const section = document.createElement('div');
    section.className = 'image-options-section';

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

    categorySelect.addEventListener('change', args.onChange);
    vibrantCheckbox.addEventListener('change', args.onChange);

    return {
        element: section,
        getValues: () => ({
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

    const sineControls = document.createElement('div');
    sineControls.dataset.testid = 'composable-sine-controls';

    const triangularControls = document.createElement('div');
    triangularControls.dataset.testid = 'composable-triangular-controls';

    // Created up front so the visibility helper can toggle it; appended to
    // the section later in DOM order.
    const borderlessWrap = document.createElement('div');

    const applyBaseCutVisibility = (baseCut: 'sine' | 'triangular'): void => {
        const tri = baseCut === 'triangular';
        sineControls.style.display = tri ? 'none' : 'block';
        triangularControls.style.display = tri ? 'block' : 'none';
        borderlessWrap.style.display = tri ? 'none' : 'block';
    };

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

    // Hidden for triangular cut since borderless doesn't apply there.
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
 * Increments on each row so two rows with the same label still get
 * distinct ids (multiple rows may share a label).
 */
let nextSegmentedRowSuffix = 0;

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

/** Returns a cleanup function that removes the dialog from the DOM. */
export function createNewGameDialog(options: NewGameDialogOptions): () => void {
    const { container, selectedSizeId, onSelect, onCancel } = options;

    let currentCutStyleId: string = options.selectedCutStyleId ?? DEFAULT_CUT_STYLE_ID;

    const visibleOptions = getVisibleCutStyleOptions();
    if (!visibleOptions.some((o) => o.id === currentCutStyleId)) {
        currentCutStyleId = DEFAULT_CUT_STYLE_ID;
    }

    // The helper owns Escape/backdrop dismissal and fires onCancel only on
    // those paths — not when the caller invokes dismiss() after picking an
    // image.
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

    let imagePicker: ImagePicker | undefined;

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
    const imageOptionsSection = buildImageOptionsSection({
        savedImageCategory: options.savedImageCategory,
        savedVibrant: options.savedVibrant,
        onChange: () => imagePicker?.refresh(),
    });

    /**
     * Kicking the preload off here is what keeps the fetch off the
     * critical path in `startNewGame`.
     */
    const needsTracedTabs = (id: string): boolean =>
        cutStyleNeedsTracedTabs(id, composableSection.getSelectedTabGenerator());

    const sizeRow = buildSizeSelectRow({
        selectedSizeId,
        getCutStyleId: () => currentCutStyleId,
    });

    const rotationRow = document.createElement('div');
    rotationRow.className = 'rotation-row';
    const rotationCheckbox = appendCheckboxRow(
        rotationRow,
        'Enable rotation',
        options.savedRotationEnabled ?? false,
    );

    imagePicker = createImagePicker({
        fetchCandidates: options.fetchImageCandidates
            ? () => {
                const { imageCategory, vibrant } = imageOptionsSection.getValues();
                return options.fetchImageCandidates!(imageCategory, vibrant);
            }
            : undefined,
        onPick: (imageChoice) => {
            dismiss();
            onSelect({
                sizeId: sizeRow.getValue(),
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
                imageChoice,
                ...imageOptionsSection.getValues(),
            });
        },
    });

    const cutStyleSection = createCutStylePicker({
        selectedCutStyleId: currentCutStyleId,
        options: visibleOptions,
        onSelect: (id) => {
            currentCutStyleId = id;
            sizeRow.updateLabels();
            fractalSection.setVisible(id === 'fractal');
            wavySection.setVisible(id === 'wavy');
            composableSection.setVisible(id === 'composable');
            if (needsTracedTabs(id)) options.onPreloadTracedTabs?.();
        },
    });

    fractalSection.setVisible(currentCutStyleId === 'fractal');
    wavySection.setVisible(currentCutStyleId === 'wavy');
    composableSection.setVisible(currentCutStyleId === 'composable');

    // Cover the "open with traced tabs already selected" paths so the lazy
    // chunk starts loading even if the user never touches a radio — which is
    // the common case now that the default style (Classic) is traced.
    if (needsTracedTabs(currentCutStyleId)) options.onPreloadTracedTabs?.();

    // Scrollable body: the title stays pinned above; everything else lives in
    // two groups so the short-and-wide layout can place them side by side.
    // The start group holds only the image picker, since picking an image
    // launches the game.
    const content = document.createElement('div');
    content.className = 'dialog-content';

    const settingsGroup = document.createElement('div');
    settingsGroup.className = 'dialog-group dialog-group--settings';
    settingsGroup.appendChild(cutStyleSection);
    settingsGroup.appendChild(rotationRow);
    settingsGroup.appendChild(fractalSection.element);
    settingsGroup.appendChild(wavySection.element);
    settingsGroup.appendChild(composableSection.element);
    settingsGroup.appendChild(sizeRow.element);
    settingsGroup.appendChild(imageOptionsSection.element);

    const startGroup = document.createElement('div');
    startGroup.className = 'dialog-group dialog-group--start';
    startGroup.appendChild(imagePicker.element);

    content.appendChild(settingsGroup);
    content.appendChild(startGroup);
    dialog.appendChild(content);

    overlay.appendChild(dialog);

    return dismiss;
}
