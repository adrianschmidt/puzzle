/**
 * Info/Help modal — shows credits, project info, license, help text,
 * and settings (merge tolerance).
 *
 * A glassmorphism modal overlay with information about the app,
 * credits to algorithm inspirations, brief help for features,
 * and configurable game settings.
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
import { attachShareSection } from './share-section.js';

export interface InfoModalOptions {
    /** Container to append the modal to. */
    container: HTMLElement;
    /** Called when the modal is dismissed. */
    onDismiss?: () => void;
    /** Called when the merge tolerance preference changes. */
    onToleranceChanged?: (index: number) => void;
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
    return params;
}

/**
 * Create and show the info modal.
 *
 * Returns a cleanup function that removes the modal from the DOM.
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

    // Content
    const content = document.createElement('div');
    content.className = 'info-modal-content';

    // Build static HTML sections
    content.innerHTML = `
        <section class="info-section">
            <h3>How to Play</h3>
            <ul>
                <li><strong>Drag pieces</strong> to move them around</li>
                <li><strong>Drop near matching edges</strong> to merge pieces</li>
                <li><strong>Pinch to zoom</strong> (or scroll wheel)</li>
                <li><strong>Pan on empty space</strong> to move around</li>
                <li><strong>Use the buttons</strong> for convenience:</li>
                <ul>
                    <li>🎮 <strong>New Game</strong> — Start fresh with a random image; pick puzzle size, cut style, image source and picture type in the dialog. Tick <strong>Vibrant colours</strong> for more saturated photos.</li>
                    <li>📍 <strong>Centre View</strong> — Reset zoom and pan</li>
                    <li>🔄 <strong>Gather Pieces</strong> — Organize all pieces in a compact grid</li>
                    <li>🎨 <strong>Background</strong> — Change table colour</li>
                    <li>⬚ <strong>Multi-select</strong> (top-left) — When active, tap pieces to add/remove them from a selection; drag any selected piece to move the whole selection together. Tap ✕ (bottom) to deselect all.</li>
                    <li>↺ ↻ <strong>Rotate</strong> (bottom-left, fractal only) — Rotate every selected group 90° counter-clockwise or clockwise</li>
                </ul>
                <li><strong>Share this puzzle</strong> — use the <em>Share this puzzle</em> section above to copy a link your friends can open to get the exact same puzzle.</li>
            </ul>
        </section>

        <section class="info-section">
            <h3>Cut Styles</h3>
            <ul>
                <li><strong>Classic</strong> — Traditional jigsaw tabs on a rectangular grid</li>
                <li><strong>Fractal</strong> — Organic circle-packing cuts. Options:
                    <ul>
                        <li><strong>Borderless</strong> — No pieces with flat edges, so it's not obvious which pieces make up the frame of the puzzle</li>
                        <li><strong>Enable rotation</strong> — Pieces start at random 90° rotations; solve orientation as well as position. Multi-select is turned on by default so you can pick the pieces to rotate, then use the ↺ / ↻ buttons.</li>
                    </ul>
                </li>
                <li><strong>Composable</strong> (experimental) — Customizable cuts with sliders in the new-game dialog</li>
            </ul>
        </section>

        <section class="info-section">
            <h3>Settings</h3>
            <div class="info-setting">
                <label class="info-setting-label">Snap distance</label>
                <p class="info-setting-description">How close pieces need to be before they snap together.</p>
                <div class="tolerance-options" data-testid="tolerance-options"></div>
            </div>
            <div class="info-setting">
                <label class="info-setting-toggle">
                    <input type="checkbox" data-testid="offset-drag-toggle" />
                    <span class="info-setting-label">Offset drag</span>
                </label>
                <p class="info-setting-description">Shift single pieces upward when dragging, so your finger doesn't block the view.</p>
            </div>
        </section>

        <section class="info-section">
            <h3>Credits</h3>
            <p>Algorithm inspirations:</p>
            <ul>
                <li><strong>Classic jigsaw cuts</strong> — inspired by <a href="https://codepen.io/dillo/pen/MQVBpN" target="_blank" rel="noopener">Dillo's CodePen</a></li>
                <li><strong>Fractal cuts</strong> — inspired by <a href="https://github.com/proceduraljigsaw/Fractalpuzzlejs" target="_blank" rel="noopener">Fractal Jigsaw Generator</a></li>
            </ul>
        </section>

        <section class="info-section">
            <h3>About</h3>
            <ul>
                <li><strong>Project:</strong> <a href="https://github.com/adrianschmidt/puzzle" target="_blank" rel="noopener">github.com/adrianschmidt/puzzle</a></li>
                <li><strong>License:</strong> MIT</li>
                <li><strong>Images:</strong> <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a> (photographer credited per image)</li>
            </ul>
        </section>

        <details class="info-section info-section--debug" data-testid="debug-section">
            <summary class="info-section-summary">Debug</summary>
            <div class="info-setting" data-testid="repro-params-setting">
                <label class="info-setting-label">Reproduction parameters</label>
                <p class="info-setting-description">Parameters needed to regenerate this exact puzzle. Include in bug reports.</p>
                <pre class="info-repro-block" data-testid="repro-params"></pre>
            </div>
            <div class="info-setting">
                <label class="info-setting-label" for="piece-opacity-slider">Piece opacity</label>
                <p class="info-setting-description">Adjust puzzle piece transparency.</p>
                <div class="info-setting-slider">
                    <input type="range" id="piece-opacity-slider" data-testid="piece-opacity-slider"
                           min="0" max="1" step="0.05" value="1" />
                    <span class="info-setting-slider-value" data-testid="piece-opacity-value">1</span>
                </div>
            </div>
            <div class="info-setting">
                <label class="info-setting-toggle">
                    <input type="checkbox" data-testid="mateless-edges-toggle" />
                    <span class="info-setting-label">Show mateless edges</span>
                </label>
                <p class="info-setting-description">Highlight edges with no mate (mateEdgeId&nbsp;=&nbsp;-1) in pink.</p>
            </div>
            <div class="info-setting">
                <label class="info-setting-toggle">
                    <input type="checkbox" data-testid="debug-pieces-toggle" />
                    <span class="info-setting-label">Debug piece view</span>
                </label>
                <p class="info-setting-description">Show pieces as white outlines with their piece IDs and an arrow indicating each piece's original "up" direction.</p>
            </div>
        </details>
    `;

    // Build tolerance option buttons
    const toleranceContainer = content.querySelector('.tolerance-options')!;
    const currentToleranceIndex = loadTolerancePreference();

    getSortedPresets().forEach(({ preset, storageIndex }) => {
        const button = document.createElement('button');
        button.className = 'tolerance-option';
        button.type = 'button';
        button.dataset.testid = `tolerance-${preset.label.toLowerCase()}`;

        if (storageIndex === currentToleranceIndex) {
            button.classList.add('selected');
        }

        button.innerHTML = `
            <span class="tolerance-option-label">${preset.label}</span>
            <span class="tolerance-option-desc">${preset.description}</span>
        `;

        button.addEventListener('click', () => {
            saveTolerancePreference(storageIndex);

            // Update button states
            toleranceContainer
                .querySelectorAll('.tolerance-option')
                .forEach((btn) => btn.classList.remove('selected'));
            button.classList.add('selected');

            onToleranceChanged?.(storageIndex);
        });

        toleranceContainer.appendChild(button);
    });

    // Offset drag toggle
    const offsetToggle = content.querySelector<HTMLInputElement>(
        '[data-testid="offset-drag-toggle"]',
    )!;
    offsetToggle.checked = loadOffsetDragPreference();
    offsetToggle.addEventListener('change', () => {
        saveOffsetDragPreference(offsetToggle.checked);
    });

    // Piece opacity slider (debug)
    const opacitySlider = content.querySelector<HTMLInputElement>(
        '[data-testid="piece-opacity-slider"]',
    )!;
    const opacityValue = content.querySelector<HTMLSpanElement>(
        '[data-testid="piece-opacity-value"]',
    )!;
    // Initialise from current CSS custom property (if previously set)
    const current = getComputedStyle(document.documentElement)
        .getPropertyValue('--piece-opacity')
        .trim();
    if (current) {
        opacitySlider.value = current;
        opacityValue.textContent = current;
    }
    opacitySlider.addEventListener('input', () => {
        const v = opacitySlider.value;
        opacityValue.textContent = v;
        document.documentElement.style.setProperty('--piece-opacity', v);
    });

    // Mateless edges debug toggle
    const matelessToggle = content.querySelector<HTMLInputElement>(
        '[data-testid="mateless-edges-toggle"]',
    )!;
    matelessToggle.checked =
        document.documentElement.classList.contains('show-mateless-edges');
    matelessToggle.addEventListener('change', () => {
        document.documentElement.classList.toggle(
            'show-mateless-edges',
            matelessToggle.checked,
        );
    });

    // Debug piece-view toggle — swaps pieces for white outlines with IDs.
    const debugPiecesToggle = content.querySelector<HTMLInputElement>(
        '[data-testid="debug-pieces-toggle"]',
    )!;
    debugPiecesToggle.checked =
        document.documentElement.classList.contains(DEBUG_PIECES_CLASS);
    debugPiecesToggle.addEventListener('change', () => {
        document.documentElement.classList.toggle(
            DEBUG_PIECES_CLASS,
            debugPiecesToggle.checked,
        );
    });

    // Reproduction parameters code block. Only fill in when a state source
    // was provided — the modal otherwise hides the row rather than showing
    // an empty box.
    const reproBlock = content.querySelector<HTMLPreElement>(
        '[data-testid="repro-params"]',
    )!;
    const reproSetting = content.querySelector<HTMLElement>(
        '[data-testid="repro-params-setting"]',
    )!;
    const state = getState?.();
    if (state) {
        reproBlock.textContent = JSON.stringify(
            buildReproParams(state),
            null,
            2,
        );
    } else {
        reproSetting.style.display = 'none';
    }

    // Debug: solve button sits inside the Debug section so all debug tools stay together.
    if (options.onSolve) {
        const debugSection = content.querySelector<HTMLElement>(
            '[data-testid="debug-section"]',
        )!;
        const solveBtn = document.createElement('button');
        solveBtn.className = 'info-modal-solve-btn';
        solveBtn.textContent = '🧩 Solve Puzzle';
        solveBtn.type = 'button';
        solveBtn.addEventListener('click', () => {
            dismiss();
            options.onSolve!();
        });
        debugSection.appendChild(solveBtn);
    }

    // Share section: rendered at the top of the modal when state is available,
    // so it's the first thing the player sees. We strip the hash so
    // attachShareSection receives the bare page URL rather than silently
    // relying on buildShareUrl to drop any stale `#p=...`.
    if (options.state) {
        const baseUrl = window.location.href.split('#')[0];
        attachShareSection(content, options.state, baseUrl);
        const firstSection = content.querySelector<HTMLElement>('section.info-section');
        if (firstSection && content.lastElementChild) {
            content.insertBefore(content.lastElementChild, firstSection);
        }
    }

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);

    // Dismiss on close button click. Backdrop / Escape are handled by the
    // helper; both fire onDismiss already, so we only need to wire up the
    // close button (and the debug solve button above) here.
    closeButton.addEventListener('click', dismiss);

    return dismiss;
}