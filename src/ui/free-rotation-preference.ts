/**
 * Free-rotation-enabled preference — sub-checkbox under the composable
 * options in the new-game dialog. Only meaningful when the top-level
 * "Enable rotation" toggle is also on AND the cut style is composable.
 *
 * Stored separately from the parent rotation toggle so it persists across
 * new-game flows even while the composable section is hidden.
 */

import { createBooleanPreference } from './preference-store.js';

/** localStorage key for the free-rotation-enabled preference. */
export const FREE_ROTATION_ENABLED_PREFERENCE_KEY = 'puzzle-free-rotation-enabled';

const store = createBooleanPreference({
    key: FREE_ROTATION_ENABLED_PREFERENCE_KEY,
    defaultValue: false,
});

/**
 * Load the free-rotation-enabled preference from localStorage.
 * Returns false (disabled) if nothing is saved or the value is invalid.
 */
export const loadFreeRotationEnabledPreference = store.load;

/**
 * Save the free-rotation-enabled preference to localStorage.
 */
export const saveFreeRotationEnabledPreference = store.save;
