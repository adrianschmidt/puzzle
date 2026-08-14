/**
 * Preference: shift the dragged group upward on drag start so a finger doesn't
 * block it on touch. Single-group drags only — multi-select is excluded.
 */

import { createBooleanPreference } from './preference-store.js';

export const OFFSET_DRAG_KEY = 'puzzle-offset-drag';

const store = createBooleanPreference({
    key: OFFSET_DRAG_KEY,
    defaultValue: false,
});

export const loadOffsetDragPreference = store.load;

export const saveOffsetDragPreference = store.save;
