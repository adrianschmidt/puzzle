/**
 * When disabled (the default), a marquee selects every group whose bounds
 * the box touches (intersect). When enabled, only groups whose bounds lie
 * fully inside the box are selected (contain).
 */

import { createBooleanPreference } from './preference-store.js';

export const MARQUEE_CONTAIN_KEY = 'puzzle-marquee-contain';

const store = createBooleanPreference({
    key: MARQUEE_CONTAIN_KEY,
    defaultValue: false,
});

export const loadMarqueeContainPreference = store.load;

export const saveMarqueeContainPreference = store.save;
