/**
 * Offset drag setting — persistence and defaults.
 *
 * When enabled, single pieces are shifted upward on drag start
 * so the user's finger doesn't block the view on touch devices.
 *
 * Disabled by default. Users can enable it in the info modal.
 */

import { createBooleanPreference } from './preference-store.js';

/** localStorage key for the offset drag preference. */
export const OFFSET_DRAG_KEY = 'puzzle-offset-drag';

const store = createBooleanPreference({
    key: OFFSET_DRAG_KEY,
    defaultValue: false,
});

/**
 * Load the offset drag preference from localStorage.
 * Returns false (disabled) if nothing is saved.
 */
export const loadOffsetDragPreference = store.load;

/**
 * Save the offset drag preference to localStorage.
 */
export const saveOffsetDragPreference = store.save;
