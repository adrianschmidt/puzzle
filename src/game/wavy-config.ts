/**
 * Wavy cut style configuration — types and persistence.
 *
 * The wavy cut style exposes a "borderless" toggle (strip the outer ring
 * of pieces so every piece has a tab/blank on all sides). Player choices
 * are persisted as JSON in localStorage. Mirrors `fractal-config.ts`.
 */

import { createJsonPreference } from '../ui/preference-store.js';

/** localStorage key for the saved wavy config. */
export const WAVY_CONFIG_KEY = 'puzzle-wavy-config';

/** Shape of the wavy config stored in preferences. */
export interface WavyConfigPreference {
    borderless: boolean;
}

function parseWavyConfig(raw: unknown): WavyConfigPreference | undefined {
    if (typeof raw !== 'object' || raw === null || !('borderless' in raw)) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    return {
        borderless: Boolean(config.borderless),
    };
}

const store = createJsonPreference<WavyConfigPreference>({
    key: WAVY_CONFIG_KEY,
    parse: parseWavyConfig,
});

/** Save the wavy config to localStorage. */
export const saveWavyConfigPreference = store.save;

/**
 * Load the wavy config from localStorage.
 * Returns undefined if nothing is saved or the value is invalid.
 */
export const loadWavyConfigPreference = store.load;
