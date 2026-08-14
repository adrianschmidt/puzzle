/**
 * Disabled (default) = intersect: select every group the box touches. Enabled =
 * contain: select only groups fully inside the box.
 */

import { createBooleanPreference } from './preference-store.js';

export const MARQUEE_CONTAIN_KEY = 'puzzle-marquee-contain';

const store = createBooleanPreference({
    key: MARQUEE_CONTAIN_KEY,
    defaultValue: false,
});

export const loadMarqueeContainPreference = store.load;

export const saveMarqueeContainPreference = store.save;
