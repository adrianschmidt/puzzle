/**
 * Rotation lives as its own top-level preference in
 * `src/ui/rotation-preference.ts` — it applies to every cut style, not just
 * fractal.
 */

import { createJsonPreference } from '../ui/preference-store.js';

export const FRACTAL_CONFIG_KEY = 'puzzle-fractal-config';

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

export const saveFractalConfigPreference = store.save;

export const loadFractalConfigPreference = store.load;
