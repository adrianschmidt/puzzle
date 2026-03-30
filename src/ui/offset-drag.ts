/**
 * Offset drag setting — persistence and defaults.
 *
 * When enabled, single pieces are shifted upward on drag start
 * so the user's finger doesn't block the view on touch devices.
 *
 * Disabled by default. Users can enable it in the info modal.
 */

/** localStorage key for the offset drag preference. */
export const OFFSET_DRAG_KEY = 'puzzle-offset-drag';

/**
 * Load the offset drag preference from localStorage.
 * Returns false (disabled) if nothing is saved.
 */
export function loadOffsetDragPreference(): boolean {
    try {
        const raw = localStorage.getItem(OFFSET_DRAG_KEY);
        if (raw === null) {
            return false; // disabled by default
        }

        return raw !== 'false';
    } catch {
        return false;
    }
}

/**
 * Save the offset drag preference to localStorage.
 */
export function saveOffsetDragPreference(enabled: boolean): void {
    localStorage.setItem(OFFSET_DRAG_KEY, String(enabled));
}
