/**
 * Info/Help modal — shows credits, project info, license, help text,
 * and settings (merge tolerance).
 *
 * A glassmorphism modal overlay with information about the app,
 * credits to algorithm inspirations, brief help for features,
 * and configurable game settings.
 */

import {
    getSortedPresets,
    loadTolerancePreference,
    saveTolerancePreference,
} from './merge-tolerance.js';
import {
    loadOffsetDragPreference,
    saveOffsetDragPreference,
} from './offset-drag.js';

export interface InfoModalOptions {
    /** Container to append the modal to. */
    container: HTMLElement;
    /** Called when the modal is dismissed. */
    onDismiss?: () => void;
    /** Called when the merge tolerance preference changes. */
    onToleranceChanged?: (index: number) => void;
    /** Called when the solve button is pressed (debug). */
    onSolve?: () => void;
}

/**
 * Create and show the info modal.
 *
 * Returns a cleanup function that removes the modal from the DOM.
 */
export function createInfoModal(options: InfoModalOptions): () => void {
    const { container, onDismiss, onToleranceChanged } = options;

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'info-modal-overlay';

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
                    <li>🎮 <strong>New Game</strong> — Start fresh with a random image</li>
                    <li>📍 <strong>Centre View</strong> — Reset zoom and pan</li>
                    <li>🔄 <strong>Gather Pieces</strong> — Organize all pieces in a compact grid</li>
                    <li>🎨 <strong>Background</strong> — Change table colour</li>
                </ul>
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
            <div class="info-setting">
                <label class="info-setting-label" for="piece-opacity-slider">Piece opacity</label>
                <p class="info-setting-description">Adjust puzzle piece transparency (debug).</p>
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
                <p class="info-setting-description">Highlight edges with no mate (mateEdgeId&nbsp;=&nbsp;-1) in pink (debug).</p>
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

    // Debug: solve button at the bottom of the content
    if (options.onSolve) {
        const solveBtn = document.createElement('button');
        solveBtn.className = 'info-modal-solve-btn';
        solveBtn.textContent = '🧩 Solve Puzzle (debug)';
        solveBtn.type = 'button';
        solveBtn.addEventListener('click', () => {
            dismiss();
            options.onSolve!();
        });
        content.appendChild(solveBtn);
    }

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);

    function dismiss(): void {
        overlay.remove();
        document.removeEventListener('keydown', handleKeyDown);
        onDismiss?.();
    }

    function handleKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            dismiss();
        }
    }

    // Dismiss on backdrop click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            dismiss();
        }
    });

    // Dismiss on close button click
    closeButton.addEventListener('click', dismiss);

    // Dismiss on Escape
    document.addEventListener('keydown', handleKeyDown);

    container.appendChild(overlay);

    return dismiss;
}