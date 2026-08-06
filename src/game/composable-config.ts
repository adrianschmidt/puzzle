import { createJsonPreference } from '../ui/preference-store.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';

export const COMPOSABLE_CONFIG_KEY = 'puzzle-composable-config';

export type ComposableTabGenerator = 'classic' | 'traced' | 'none';

export const DEFAULT_TAB_GENERATOR: ComposableTabGenerator = 'classic';

export type ComposableBaseCut = 'sine' | 'triangular';

export const DEFAULT_BASE_CUT: ComposableBaseCut = 'sine';

/** Default triangular irregularity (fraction of side length). */
export const DEFAULT_JITTER = 0.15;

/**
 * Translate the legacy `disableTabs: boolean` field into the new
 * `tabGenerator` enum. Centralised so the localStorage preference,
 * save-file, and share-link legacy paths agree on the mapping.
 *
 * Per the keep-old-save-migrations rule this branch is permanent —
 * users may still hold v1/v2 saves and share links from before the
 * traced-tabs PR landed.
 */
export function legacyDisableTabsToTabGenerator(
    rawDisableTabs: unknown,
): ComposableTabGenerator {
    return rawDisableTabs === true ? 'none' : 'classic';
}

export interface ComposableSliderPreference {
    baseCut: ComposableBaseCut;
    horizontalAmplitude: number;
    horizontalFrequency: number;
    verticalAmplitude: number;
    verticalFrequency: number;
    tabGenerator: ComposableTabGenerator;
    borderless: boolean;
    jitter: number;
    smooth: boolean;
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

    // Migration: legacy { disableTabs: boolean } → { tabGenerator: 'none' | 'classic' }.
    // Per feedback_keep_old_save_migrations, this branch stays indefinitely.
    let tabGenerator: ComposableTabGenerator;
    if (config.tabGenerator === 'classic' || config.tabGenerator === 'traced' || config.tabGenerator === 'none') {
        tabGenerator = config.tabGenerator;
    } else if ('disableTabs' in config) {
        tabGenerator = legacyDisableTabsToTabGenerator(config.disableTabs);
    } else {
        tabGenerator = DEFAULT_TAB_GENERATOR;
    }

    const baseCut: ComposableBaseCut =
        config.baseCut === 'triangular' ? 'triangular' : DEFAULT_BASE_CUT;
    // Clamp to the slider's [0, 0.5] range. The generator re-clamps too, but
    // clamping here keeps the persisted preference within the documented range
    // (a hand-edited or stale localStorage value can't smuggle out-of-range
    // jitter back into the UI).
    const jitterRaw = Number(config.jitter);
    const jitter = Number.isFinite(jitterRaw)
        ? Math.min(0.5, Math.max(0, jitterRaw))
        : DEFAULT_JITTER;
    const smooth = config.smooth === true;

    return {
        baseCut,
        horizontalAmplitude: Number(config.horizontalAmplitude),
        horizontalFrequency: Number(config.horizontalFrequency),
        verticalAmplitude: Number(config.verticalAmplitude),
        verticalFrequency: Number(config.verticalFrequency),
        tabGenerator,
        borderless: config.borderless === true,
        jitter,
        smooth,
    };
}

const store = createJsonPreference<ComposableSliderPreference>({
    key: COMPOSABLE_CONFIG_KEY,
    parse: parseComposableConfig,
});

export const saveComposableConfigPreference = store.save;

export const loadComposableConfigPreference = store.load;

/**
 * Triangular emits `{jitter}` (rows are injected downstream from the
 * size grid) and never borderless.
 */
export function composableSliderToGeneratorConfig(
    slider: ComposableSliderPreference,
): ComposableConfig {
    if (slider.baseCut === 'triangular') {
        return {
            baseCutGenerator: 'triangular',
            baseCutConfig: { jitter: slider.jitter, smooth: slider.smooth },
            tabGenerator: slider.tabGenerator,
            tabConfig: {},
            borderless: false,
        };
    }
    return {
        baseCutGenerator: 'sine',
        baseCutConfig: {
            ha: slider.horizontalAmplitude,
            hf: slider.horizontalFrequency,
            va: slider.verticalAmplitude,
            vf: slider.verticalFrequency,
        },
        tabGenerator: slider.tabGenerator,
        tabConfig: {},
        borderless: slider.borderless,
    };
}
