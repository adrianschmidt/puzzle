/**
 * Info/Help modal — shows credits, project info, license, and help text.
 *
 * A glassmorphism modal overlay with information about the app,
 * credits to algorithm inspirations, and brief help for features.
 */

export interface InfoModalOptions {
    /** Container to append the modal to. */
    container: HTMLElement;
    /** Called when the modal is dismissed. */
    onDismiss?: () => void;
}

/**
 * Create and show the info modal.
 *
 * Returns a cleanup function that removes the modal from the DOM.
 */
export function createInfoModal(options: InfoModalOptions): () => void {
    const { container, onDismiss } = options;

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
                    <li>🔄 <strong>Gather Pieces</strong> — Bring all pieces to view</li>
                    <li>🎨 <strong>Background</strong> — Change table colour</li>
                </ul>
            </ul>
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