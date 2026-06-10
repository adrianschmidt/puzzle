/**
 * Marquee hit-semantics setting — persistence and defaults.
 *
 * When disabled (the default), a marquee selects every group whose bounds
 * the box touches (intersect). When enabled, only groups whose bounds lie
 * fully inside the box are selected (contain).
 *
 * Disabled by default. Users can change it in the info modal.
 */

import { createBooleanPreference } from './preference-store.js';

/** localStorage key for the marquee hit-semantics preference. */
export const MARQUEE_CONTAIN_KEY = 'puzzle-marquee-contain';

const store = createBooleanPreference({
    key: MARQUEE_CONTAIN_KEY,
    defaultValue: false,
});

/**
 * Load the marquee-contain preference. Returns false (intersect) if nothing
 * is saved.
 */
export const loadMarqueeContainPreference = store.load;

/** Save the marquee-contain preference. */
export const saveMarqueeContainPreference = store.save;
