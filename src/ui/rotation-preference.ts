/**
 * Rotation-enabled preference — top-level "Enable rotation" toggle for the
 * new-game dialog. Applies to any cut style.
 *
 * Disabled by default. Persisted under its own localStorage key (rather
 * than nested inside any per-style config) because rotation is orthogonal
 * to cut style.
 */

import { createBooleanPreference } from './preference-store.js';

/** localStorage key for the rotation-enabled preference. */
export const ROTATION_ENABLED_PREFERENCE_KEY = 'puzzle-rotation-enabled';

const store = createBooleanPreference({
    key: ROTATION_ENABLED_PREFERENCE_KEY,
    defaultValue: false,
});

/**
 * Load the rotation-enabled preference from localStorage.
 * Returns false (disabled) if nothing is saved or the value is invalid.
 */
export const loadRotationEnabledPreference = store.load;

/**
 * Save the rotation-enabled preference to localStorage.
 */
export const saveRotationEnabledPreference = store.save;
