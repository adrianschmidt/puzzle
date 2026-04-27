/**
 * Composable cut style configuration — types and persistence.
 *
 * The composable cut style exposes four per-axis sliders (amplitude /
 * frequency, horizontal / vertical) and a "disable tabs" toggle.
 * Player choices are persisted as JSON in localStorage.
 */

import { createJsonPreference } from '../ui/preference-store.js';

/** localStorage key for the saved composable slider config. */
export const COMPOSABLE_CONFIG_KEY = 'puzzle-composable-config';

/**
 * Shape of the composable slider config stored in preferences.
 */
export interface ComposableSliderPreference {
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    disableTabs: boolean;
}

function parseComposableConfig(
    raw: unknown,
): ComposableSliderPreference | undefined {
    if (
        typeof raw !== 'object' ||
        raw === null ||
        !('horizontalAmplitude' in raw) ||
        !('horizontalFrequency' in raw) ||
        !('verticalAmplitude' in raw) ||
        !('verticalFrequency' in raw)
    ) {
        return undefined;
    }

    const config = raw as Record<string, unknown>;

    return {
        horizontalAmplitude: Number(config.horizontalAmplitude),
        horizontalFrequency: Number(config.horizontalFrequency),
        verticalAmplitude: Number(config.verticalAmplitude),
        verticalFrequency: Number(config.verticalFrequency),
        disableTabs: Boolean(config.disableTabs),
    };
}

const store = createJsonPreference<ComposableSliderPreference>({
    key: COMPOSABLE_CONFIG_KEY,
    parse: parseComposableConfig,
});

/**
 * Save the composable slider config to localStorage.
 */
export const saveComposableConfigPreference = store.save;

/**
 * Load the composable slider config from localStorage.
 * Returns undefined if nothing is saved or the value is invalid.
 */
export const loadComposableConfigPreference = store.load;
