/**
 * "Borderless" strips the outer ring of pieces so every piece has a
 * tab/blank on all sides.
 */

import { createJsonPreference } from '../ui/preference-store.js';

export const WAVY_CONFIG_KEY = 'puzzle-wavy-config';

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

export const saveWavyConfigPreference = store.save;

export const loadWavyConfigPreference = store.load;
