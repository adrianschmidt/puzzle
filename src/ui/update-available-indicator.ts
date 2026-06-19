/**
 * Persistent "update ready" indicator. Unlike `showToast`, this does not
 * auto-dismiss — it stays until the user taps it (which reloads into the new
 * version) or the page reloads on its own (e.g. on focus regain).
 */

export interface UpdateAvailableIndicatorOptions {
    /** Invoked when the user taps the indicator. */
    onRefresh: () => void;
}

const INDICATOR_CLASS = 'update-available-indicator';

/**
 * Show the indicator. Returns a cleanup function that removes it. Only one
 * indicator exists at a time.
 */
export function createUpdateAvailableIndicator(
    options: UpdateAvailableIndicatorOptions,
): () => void {
    document
        .querySelectorAll(`.${INDICATOR_CLASS}`)
        .forEach((el) => el.remove());

    const indicator = document.createElement('button');
    indicator.className = INDICATOR_CLASS;
    indicator.type = 'button';
    indicator.textContent = 'Update ready — tap to refresh';
    indicator.addEventListener('click', () => options.onRefresh());

    document.body.appendChild(indicator);

    return () => indicator.remove();
}
