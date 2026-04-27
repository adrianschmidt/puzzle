/**
 * Fractal cut style configuration — types and persistence.
 *
 * The fractal cut style exposes a "borderless" toggle and an opt-in
 * 90°-snap rotation mode. Player choices are persisted as JSON in
 * localStorage.
 */

import { createJsonPreference } from '../ui/preference-store.js';

/** localStorage key for the saved fractal config. */
export const FRACTAL_CONFIG_KEY = 'puzzle-fractal-config';

/**
 * Shape of the fractal config stored in preferences.
 */
export interface FractalConfigPreference {
    borderless: boolean;
    /**
     * Whether the player opted into 90°-snap rotation for a fractal puzzle.
     * When true, groups start at a random rotation and rotate-buttons appear.
     */
    rotationEnabled: boolean;
}

function parseFractalConfig(raw: unknown): FractalConfigPreference | undefined {
    if (typeof raw !== 'object' || raw === null || !('borderless' in raw)) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    return {
        borderless: Boolean(config.borderless),
        rotationEnabled: Boolean(config.rotationEnabled),
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
