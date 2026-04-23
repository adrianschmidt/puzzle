/**
 * Full-screen "Building puzzle…" overlay for blocking work.
 *
 * Puzzle generation is synchronous and can take a second or two on older
 * devices; shared-link recipients in particular see a dead page without
 * feedback. `showLoadingOverlay` puts up a spinner and explanatory text,
 * `hideLoadingOverlay` tears it down once the game is rendered.
 *
 * `yieldForPaint` is the helper that lets the browser actually paint the
 * overlay before a sync work burst; without it the overlay DOM is
 * created but never shown because the main thread never returns.
 */

const OVERLAY_CLASS = 'loading-overlay';
const TEXT_CLASS = 'loading-overlay__text';
const SPINNER_CLASS = 'loading-overlay__spinner';

export function showLoadingOverlay(text: string = 'Building puzzle…'): void {
    let overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = OVERLAY_CLASS;
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');

        const spinner = document.createElement('div');
        spinner.className = SPINNER_CLASS;
        overlay.appendChild(spinner);

        const label = document.createElement('div');
        label.className = TEXT_CLASS;
        label.textContent = text;
        overlay.appendChild(label);

        document.body.appendChild(overlay);
        return;
    }

    const label = overlay.querySelector<HTMLElement>(`.${TEXT_CLASS}`);
    if (label) label.textContent = text;
}

export function hideLoadingOverlay(): void {
    document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)?.remove();
}

/**
 * Wait for the browser to paint the current DOM state before returning.
 * Use this after `showLoadingOverlay` and before a synchronous heavy
 * work burst so the overlay actually appears on screen.
 */
export function yieldForPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}
