/**
 * Persistent "update ready" indicator — unlike `showToast` it does not
 * auto-dismiss; it stays until the user taps it (reloads into the new version)
 * or the page reloads on its own.
 */

export interface UpdateAvailableIndicatorOptions {
    onRefresh: () => void;
}

const INDICATOR_CLASS = 'update-available-indicator';

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
