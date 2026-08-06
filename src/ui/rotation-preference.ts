/**
 * Persisted under its own localStorage key (rather than nested inside any
 * per-style config) because rotation is orthogonal to cut style.
 */

import { createBooleanPreference } from './preference-store.js';

export const ROTATION_ENABLED_PREFERENCE_KEY = 'puzzle-rotation-enabled';

const store = createBooleanPreference({
    key: ROTATION_ENABLED_PREFERENCE_KEY,
    defaultValue: false,
});

export const loadRotationEnabledPreference = store.load;

export const saveRotationEnabledPreference = store.save;
