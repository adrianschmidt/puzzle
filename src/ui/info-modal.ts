/**
 * Info/Help modal — shows credits, project info, license, help text,
 * and settings (merge tolerance).
 *
 * A glassmorphism modal overlay with information about the app,
 * credits to algorithm inspirations, brief help for features,
 * and configurable game settings.
 *
 * The modal is composed of per-section builder functions; each owns its
 * DOM and event wiring so adding/removing a setting is a localised change.
 */

import type { GameState } from '../model/types.js';
import { createDismissableOverlay } from './dismissable-overlay.js';
import {
    getSortedPresets,
    loadTolerancePreference,
    saveTolerancePreference,
} from './merge-tolerance.js';
import {
    loadOffsetDragPreference,
    saveOffsetDragPreference,
} from './offset-drag.js';
import {
    loadMarqueeContainPreference,
    saveMarqueeContainPreference,
} from './marquee-contain.js';
import {
    PIECE_OUTLINE_PRESETS,
    loadPieceOutlinePreference,
    savePieceOutlinePreference,
    applyPieceOutline,
} from './piece-outline.js';
import {
    loadPieceOutlineColorPreference,
    savePieceOutlineColorPreference,
    applyPieceOutlineColor,
} from './piece-outline-color.js';
import { createPieceOutlineColorPicker } from './piece-outline-color-picker.js';
import { attachShareSection } from './share-section.js';

export interface InfoModalOptions {
    /** Container to append the modal to. */
    container: HTMLElement;
    /** Called when the modal is dismissed. */
    onDismiss?: () => void;
    /** Called when the merge tolerance preference changes. */
    onToleranceChanged?: (id: string) => void;
    /** Called when the solve button is pressed (debug). */
    onSolve?: () => void;
    /**
     * Returns the current game state — used by the Debug panel to show the
     * parameters needed to reproduce the puzzle. Optional: when absent the
     * repro block is omitted.
     */
    getState?: () => GameState | null | undefined;
    /** Current game state; when provided, a "Share this puzzle" section is rendered. */
    state?: GameState;
}

/** HTML class toggled on <html> to switch pieces into debug (white) view. */
const DEBUG_PIECES_CLASS = 'show-debug-pieces';

/**
 * Fields required to reproduce a puzzle from its seed.
 * Kept minimal so a screenshot of the block is easy to read.
 */
function buildReproParams(state: GameState): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (state.seed !== undefined) params.seed = state.seed;
    if (state.cutStyle) params.cutStyle = state.cutStyle;
    if (state.gridSize) params.gridSize = state.gridSize;
    if (state.rotationMode) params.rotationMode = state.rotationMode;
    if (state.composableConfig) params.composableConfig = state.composableConfig;
    if (state.fractalConfig) params.fractalConfig = state.fractalConfig;
    if (state.wavyConfig) params.wavyConfig = state.wavyConfig;
    if (state.trianglesConfig) params.trianglesConfig = state.trianglesConfig;
    return params;
}

/**
 * Append a list `<li>` to `parent`, where the contents are an alternating
 * sequence of plain strings and `[tag, text]` tuples (rendered as that
 * inline element). Keeps the static help-text builders compact without
 * resorting to innerHTML.
 */
type InlineNode = string | [tag: string, text: string, attrs?: Record<string, string>];

function appendInlineLi(parent: HTMLElement, parts: InlineNode[]): HTMLLIElement {
    const li = document.createElement('li');
    appendInline(li, parts);
    parent.appendChild(li);
    return li;
}

function appendInline(target: HTMLElement, parts: InlineNode[]): void {
    for (const part of parts) {
        if (typeof part === 'string') {
            target.appendChild(document.createTextNode(part));
            continue;
        }
        const [tag, text, attrs] = part;
        const el = document.createElement(tag);
        el.textContent = text;
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                el.setAttribute(k, v);
            }
        }
        target.appendChild(el);
    }
}

function buildHowToPlaySection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'info-section';

    const heading = document.createElement('h3');
    heading.textContent = 'How to Play';
    section.appendChild(heading);

    const list = document.createElement('ul');
    appendInlineLi(list, [['strong', 'Drag pieces'], ' to move them around']);
    appendInlineLi(list, [['strong', 'Drop near matching edges'], ' to merge pieces']);
    appendInlineLi(list, [['strong', 'Pinch to zoom'], ' (or scroll wheel)']);
    appendInlineLi(list, [['strong', 'Drag the background'], ' to move your view around']);
    appendInlineLi(list, [['strong', 'Use the buttons'], ' for convenience:']);

    const buttons = document.createElement('ul');
    appendInlineLi(buttons, [
        '🎮 ',
        ['strong', 'New Game'],
        ' — Choose puzzle size, cut style and picture type, then tap one of the suggested photos to start (↻ swaps them for a new set) — or ',
        ['strong', 'Surprise me'],
        ' for a fresh random photo. Tick ',
        ['strong', 'Vibrant colours'],
        ' for more saturated photos.',
    ]);
    appendInlineLi(buttons, [
        '🔄 ',
        ['strong', 'Gather Pieces'],
        ' — Organize all pieces in a compact grid',
    ]);
    appendInlineLi(buttons, ['🎨 ', ['strong', 'Background'], ' — Change table colour']);
    appendInlineLi(buttons, [
        '⬚ ',
        ['strong', 'Multi-select'],
        ' (top-left) — When active, tap pieces to add/remove them from a selection; drag any selected piece to move the whole selection together. Tap ✕ (bottom) to deselect all.',
    ]);
    appendInlineLi(buttons, [
        '▭ ',
        ['strong', 'Marquee'],
        ' (below Multi-select) — Turns on multi-select and lets you drag a box on empty space to select every group it covers (turn on ',
        ['strong', 'Enclose to select'],
        ' in Settings to require a group be fully inside the box). Turning the marquee off leaves your selection untouched. On a computer you can also hold Shift and drag a box without switching the button on.',
    ]);
    appendInlineLi(buttons, [
        '↺ ↻ ',
        ['strong', 'Rotate'],
        ' (when rotation is enabled) — Tap any piece to bring up rotation controls next to it. With ',
        ['strong', '90° rotation'],
        ' (Classic and Fractal puzzles), the ↺ / ↻ buttons rotate the focused piece by a quarter-turn. With ',
        ['strong', 'Free rotation'],
        " (Wavy and Triangles puzzles), a single round handle below the focused piece lets you drag to rotate continuously — the piece follows your finger like a dial. Pieces snap together when their rotations are close to alignment; how close they need to be depends on your ",
        ['strong', 'Snap distance'],
        ' setting.',
    ]);
    list.appendChild(buttons);

    section.appendChild(list);
    return section;
}

function buildSettingsSection(args: {
    onToleranceChanged?: (id: string) => void;
}): HTMLElement {
    const section = document.createElement('section');
    section.className = 'info-section';

    const heading = document.createElement('h3');
    heading.textContent = 'Settings';
    section.appendChild(heading);

    section.appendChild(buildToleranceSetting(args.onToleranceChanged));
    section.appendChild(buildPieceOutlineSetting());
    section.appendChild(buildOffsetDragSetting());
    section.appendChild(buildMarqueeContainSetting());

    return section;
}

function buildToleranceSetting(
    onToleranceChanged?: (id: string) => void,
): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const label = document.createElement('label');
    label.className = 'info-setting-label';
    label.textContent = 'Snap distance';
    setting.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent = 'How close pieces need to be before they snap together.';
    setting.appendChild(desc);

    const tolContainer = document.createElement('div');
    tolContainer.className = 'preset-options';
    tolContainer.dataset.testid = 'tolerance-options';

    const currentToleranceId = loadTolerancePreference();
    getSortedPresets().forEach((preset) => {
        const button = document.createElement('button');
        button.className = 'preset-option';
        button.type = 'button';
        button.dataset.testid = `tolerance-${preset.label.toLowerCase()}`;
        if (preset.id === currentToleranceId) {
            button.classList.add('selected');
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'preset-option-label';
        labelSpan.textContent = preset.label;
        button.appendChild(labelSpan);

        const descSpan = document.createElement('span');
        descSpan.className = 'preset-option-desc';
        descSpan.textContent = preset.description;
        button.appendChild(descSpan);

        button.addEventListener('click', () => {
            saveTolerancePreference(preset.id);
            tolContainer
                .querySelectorAll('.preset-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');
            onToleranceChanged?.(preset.id);
        });

        tolContainer.appendChild(button);
    });

    setting.appendChild(tolContainer);
    return setting;
}

function buildPieceOutlineSetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const label = document.createElement('label');
    label.className = 'info-setting-label';
    label.textContent = 'Piece outline';
    setting.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent =
        'The visual edge drawn around each piece group. With "Outline" ' +
        'selected, pick its colour below.';
    setting.appendChild(desc);

    const container = document.createElement('div');
    container.className = 'preset-options';
    container.dataset.testid = 'piece-outline-options';

    const currentId = loadPieceOutlinePreference();
    for (const preset of PIECE_OUTLINE_PRESETS) {
        const button = document.createElement('button');
        button.className = 'preset-option';
        button.type = 'button';
        button.dataset.testid = `piece-outline-${preset.id}`;
        if (preset.id === currentId) {
            button.classList.add('selected');
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'preset-option-label';
        labelSpan.textContent = preset.label;
        button.appendChild(labelSpan);

        const descSpan = document.createElement('span');
        descSpan.className = 'preset-option-desc';
        descSpan.textContent = preset.description;
        button.appendChild(descSpan);

        button.addEventListener('click', () => {
            savePieceOutlinePreference(preset.id);
            applyPieceOutline(preset.id);
            container
                .querySelectorAll('.preset-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');
            updateColorRowVisibility(preset.id);
        });

        container.appendChild(button);
    }

    setting.appendChild(container);

    // Outline-color picker — only meaningful for the "Outline" style, so
    // it's revealed/hidden as the active edge style changes.
    const colorRow = document.createElement('div');
    colorRow.className = 'outline-color-row';
    colorRow.dataset.testid = 'piece-outline-color-row';

    const colorLabel = document.createElement('span');
    colorLabel.className = 'info-setting-label';
    colorLabel.textContent = 'Outline colour';
    colorRow.appendChild(colorLabel);

    // The picker's cleanup function is intentionally discarded: the modal
    // tears down its whole subtree on dismiss (overlay.remove()), which
    // takes the button and swatch panel with it. The popover's only
    // out-of-subtree resource is its document-level dismiss listeners, and
    // every modal-close path (✕, backdrop, Escape) also trips the popover's
    // own outside-pointerdown / Escape handler, which removes them. Mirrors
    // the background-color picker, which likewise discards its cleanup.
    createPieceOutlineColorPicker({
        container: colorRow,
        selectedId: loadPieceOutlineColorPreference(),
        onSelect: (colorId) => {
            savePieceOutlineColorPreference(colorId);
            applyPieceOutlineColor(colorId);
        },
    });

    function updateColorRowVisibility(styleId: string): void {
        colorRow.hidden = styleId !== 'outline';
    }
    updateColorRowVisibility(currentId);

    setting.appendChild(colorRow);
    return setting;
}

function buildOffsetDragSetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'info-setting-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-checkbox';
    checkbox.dataset.testid = 'offset-drag-toggle';
    checkbox.checked = loadOffsetDragPreference();
    checkbox.addEventListener('change', () => {
        saveOffsetDragPreference(checkbox.checked);
    });

    const text = document.createElement('span');
    text.className = 'info-setting-label';
    text.textContent = 'Offset drag';

    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(text);
    setting.appendChild(toggleLabel);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent =
        "Shift the dragged piece or group upward, so your finger doesn't block the view.";
    setting.appendChild(desc);

    return setting;
}

function buildMarqueeContainSetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'info-setting-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-checkbox';
    checkbox.dataset.testid = 'marquee-contain-toggle';
    checkbox.checked = loadMarqueeContainPreference();
    checkbox.addEventListener('change', () => {
        saveMarqueeContainPreference(checkbox.checked);
    });

    const text = document.createElement('span');
    text.className = 'info-setting-label';
    text.textContent = 'Enclose to select';

    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(text);
    setting.appendChild(toggleLabel);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent =
        'When dragging a selection box, select only pieces fully inside the ' +
        'box instead of every piece the box touches.';
    setting.appendChild(desc);

    return setting;
}

function buildCreditsSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'info-section';

    const heading = document.createElement('h3');
    heading.textContent = 'Credits';
    section.appendChild(heading);

    const intro = document.createElement('p');
    intro.textContent = 'Algorithm inspirations:';
    section.appendChild(intro);

    const list = document.createElement('ul');
    appendInlineLi(list, [
        ['strong', 'Classic jigsaw cuts'],
        ' — inspired by ',
        [
            'a',
            "Dillo's CodePen",
            { href: 'https://codepen.io/dillo/pen/MQVBpN', target: '_blank', rel: 'noopener' },
        ],
    ]);
    appendInlineLi(list, [
        ['strong', 'Fractal cuts'],
        ' — inspired by ',
        [
            'a',
            'Fractal Jigsaw Generator',
            {
                href: 'https://github.com/proceduraljigsaw/Fractalpuzzlejs',
                target: '_blank',
                rel: 'noopener',
            },
        ],
    ]);
    section.appendChild(list);
    return section;
}

function buildAboutSection(): HTMLElement {
    const section = document.createElement('section');
    section.className = 'info-section';

    const heading = document.createElement('h3');
    heading.textContent = 'About';
    section.appendChild(heading);

    const list = document.createElement('ul');
    appendInlineLi(list, [
        ['strong', 'Project:'],
        ' ',
        [
            'a',
            'github.com/adrianschmidt/puzzle',
            { href: 'https://github.com/adrianschmidt/puzzle', target: '_blank', rel: 'noopener' },
        ],
    ]);
    appendInlineLi(list, [['strong', 'License:'], ' MIT']);
    appendInlineLi(list, [
        ['strong', 'Images:'],
        ' ',
        ['a', 'Unsplash', { href: 'https://unsplash.com', target: '_blank', rel: 'noopener' }],
        ' (photographer credited per image)',
    ]);
    section.appendChild(list);
    return section;
}

function buildDebugSection(args: {
    state: GameState | null | undefined;
    onSolve?: () => void;
    dismiss: () => void;
}): HTMLElement {
    const details = document.createElement('details');
    details.className = 'info-section info-section--debug';
    details.dataset.testid = 'debug-section';

    const summary = document.createElement('summary');
    summary.className = 'info-section-summary';
    summary.textContent = 'Debug';
    details.appendChild(summary);

    details.appendChild(buildReproSetting(args.state));

    details.appendChild(buildOpacitySetting());

    details.appendChild(
        buildDebugToggleSetting({
            testid: 'mateless-edges-toggle',
            label: 'Show mateless edges',
            description:
                'Highlight edges with no mate (mateEdgeId = -1) in pink.',
            htmlClass: 'show-mateless-edges',
        }),
    );

    details.appendChild(
        buildDebugToggleSetting({
            testid: 'debug-pieces-toggle',
            label: 'Debug piece view',
            description:
                'Show pieces as white outlines with their piece IDs and an arrow indicating each piece\'s original "up" direction.',
            htmlClass: DEBUG_PIECES_CLASS,
        }),
    );

    // Solve button — kept inside Debug so all debug tools stay together.
    if (args.onSolve) {
        const solveBtn = document.createElement('button');
        solveBtn.className = 'info-modal-solve-btn';
        solveBtn.textContent = '🧩 Solve Puzzle';
        solveBtn.type = 'button';
        solveBtn.addEventListener('click', () => {
            args.dismiss();
            args.onSolve!();
        });
        details.appendChild(solveBtn);
    }

    return details;
}

function buildReproSetting(state: GameState | null | undefined): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';
    setting.dataset.testid = 'repro-params-setting';

    const label = document.createElement('label');
    label.className = 'info-setting-label';
    label.textContent = 'Reproduction parameters';
    setting.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent =
        'Parameters needed to regenerate this exact puzzle. Include in bug reports.';
    setting.appendChild(desc);

    const block = document.createElement('pre');
    block.className = 'info-repro-block';
    block.dataset.testid = 'repro-params';
    setting.appendChild(block);

    if (state) {
        block.textContent = JSON.stringify(buildReproParams(state), null, 2);
    } else {
        setting.style.display = 'none';
    }

    return setting;
}

function buildOpacitySetting(): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const label = document.createElement('label');
    label.className = 'info-setting-label';
    label.htmlFor = 'piece-opacity-slider';
    label.textContent = 'Piece opacity';
    setting.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent = 'Adjust puzzle piece transparency.';
    setting.appendChild(desc);

    const row = document.createElement('div');
    row.className = 'info-setting-slider';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'piece-opacity-slider';
    slider.dataset.testid = 'piece-opacity-slider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = '1';

    const value = document.createElement('span');
    value.className = 'info-setting-slider-value';
    value.dataset.testid = 'piece-opacity-value';
    value.textContent = '1';

    // Initialize from the current CSS custom property, if previously set.
    const current = getComputedStyle(document.documentElement)
        .getPropertyValue('--piece-opacity')
        .trim();
    if (current) {
        slider.value = current;
        value.textContent = current;
    }
    slider.addEventListener('input', () => {
        value.textContent = slider.value;
        document.documentElement.style.setProperty('--piece-opacity', slider.value);
    });

    row.appendChild(slider);
    row.appendChild(value);
    setting.appendChild(row);

    return setting;
}

/**
 * Build a debug-section toggle that mirrors a class on `<html>`: the
 * checkbox reflects whether the class is set, and changes apply or remove it.
 */
function buildDebugToggleSetting(args: {
    testid: string;
    label: string;
    description: string;
    htmlClass: string;
}): HTMLElement {
    const setting = document.createElement('div');
    setting.className = 'info-setting';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'info-setting-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-checkbox';
    checkbox.dataset.testid = args.testid;
    checkbox.checked = document.documentElement.classList.contains(args.htmlClass);
    checkbox.addEventListener('change', () => {
        document.documentElement.classList.toggle(args.htmlClass, checkbox.checked);
    });

    const text = document.createElement('span');
    text.className = 'info-setting-label';
    text.textContent = args.label;

    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(text);
    setting.appendChild(toggleLabel);

    const desc = document.createElement('p');
    desc.className = 'info-setting-description';
    desc.textContent = args.description;
    setting.appendChild(desc);

    return setting;
}

/**
 * Create and show the info modal. Returns a cleanup function that removes the modal from the DOM.
 */
export function createInfoModal(options: InfoModalOptions): () => void {
    const { container, onDismiss, onToleranceChanged, getState } = options;

    // Build overlay (dismissal listeners owned by createDismissableOverlay).
    const { overlay, dismiss: dismissOverlay } = createDismissableOverlay({
        container,
        className: 'info-modal-overlay',
        onDismiss,
    });

    function dismiss(): void {
        dismissOverlay();
        onDismiss?.();
    }

    const modal = document.createElement('div');
    modal.className = 'info-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Info and Help');

    // Header with close button
    const header = document.createElement('div');
    header.className = 'info-modal-header';

    const title = document.createElement('h2');
    title.className = 'info-modal-title';
    title.textContent = 'Puzzle App';

    const closeButton = document.createElement('button');
    closeButton.className = 'info-modal-close';
    closeButton.textContent = '✕';
    closeButton.type = 'button';
    closeButton.title = 'Close';

    header.appendChild(title);
    header.appendChild(closeButton);

    const content = document.createElement('div');
    content.className = 'info-modal-content';

    // Share section first so it's the most prominent thing in the modal.
    // Strip the hash so attachShareSection receives the bare page URL rather
    // than silently relying on buildShareUrl to drop any stale `#p=...`.
    if (options.state) {
        const baseUrl = window.location.href.split('#')[0];
        attachShareSection(content, options.state, baseUrl);
    }

    content.appendChild(buildHowToPlaySection());
    content.appendChild(buildSettingsSection({ onToleranceChanged }));
    content.appendChild(buildCreditsSection());
    content.appendChild(buildAboutSection());
    content.appendChild(
        buildDebugSection({
            state: getState?.(),
            onSolve: options.onSolve,
            dismiss,
        }),
    );

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);

    // Backdrop / Escape are handled by the overlay helper; both fire
    // onDismiss already, so we only wire up the close button here.
    closeButton.addEventListener('click', dismiss);

    return dismiss;
}
