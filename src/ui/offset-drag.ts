/**
 * When enabled, the dragged piece or group is shifted upward on drag
 * start so the user's finger doesn't block the view on touch devices.
 * Only applies when a single group moves — multi-select drags of
 * several groups are excluded.
 */

import { createBooleanPreference } from './preference-store.js';

export const OFFSET_DRAG_KEY = 'puzzle-offset-drag';

const store = createBooleanPreference({
    key: OFFSET_DRAG_KEY,
    defaultValue: false,
});

export const loadOffsetDragPreference = store.load;

export const saveOffsetDragPreference = store.save;
