/**
 * Fractal cut style configuration — types and persistence.
 *
 * The fractal cut style exposes a "borderless" toggle. Player choices
 * are persisted as JSON in localStorage.
 *
 * Rotation is no longer part of this config — it lives as its own
 * top-level preference in `src/ui/rotation-preference.ts` because it
 * applies to every cut style, not just fractal.
 */

import { createJsonPreference } from '../ui/preference-store.js';

/** localStorage key for the saved fractal config. */
export const FRACTAL_CONFIG_KEY = 'puzzle-fractal-config';

/**
 * Shape of the fractal config stored in preferences.
 */
export interface FractalConfigPreference {
    borderless: boolean;
}

function parseFractalConfig(raw: unknown): FractalConfigPreference | undefined {
    if (typeof raw !== 'object' || raw === null || !('borderless' in raw)) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    return {
        borderless: Boolean(config.borderless),
    };
}

const store = createJsonPreference<FractalConfigPreference>({
    key: FRACTAL_CONFIG_KEY,
    parse: parseFractalConfig,
});

/**
 * Save the fractal config to localStorage.
 */
export const saveFractalConfigPreference = store.save;

/**
 * Load the fractal config from localStorage.
 * Returns undefined if nothing is saved or the value is invalid.
 */
export const loadFractalConfigPreference = store.load;
