/**
 * Composable cut style configuration — types and persistence.
 *
 * The composable cut style exposes four per-axis sliders (amplitude /
 * frequency, horizontal / vertical) and a tab-style picker
 * (classic / traced / none). Player choices are persisted as JSON
 * in localStorage.
 */

import { createJsonPreference } from '../ui/preference-store.js';
import type { ComposableConfig } from '../puzzle/composable-generator.js';

/** localStorage key for the saved composable slider config. */
export const COMPOSABLE_CONFIG_KEY = 'puzzle-composable-config';

/** Discrete tab-generator choice exposed by the new-game dialog. */
export type ComposableTabGenerator = 'classic' | 'traced' | 'none';

/** Default tab generator when no preference is saved. */
export const DEFAULT_TAB_GENERATOR: ComposableTabGenerator = 'classic';

/** Base-cut generator choice exposed by the new-game dialog. */
export type ComposableBaseCut = 'sine' | 'triangular' | 'silhouette';

/** Default base cut when no preference is saved. */
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

/**
 * Shape of the composable slider config stored in preferences.
 */
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
    /** Number of quantized color bands used to segment the image. */
    silhouetteColorLevels: number;
    /** Maximum number of silhouette regions selected. */
    silhouetteMaxRegions: number;
    /** Minimum region size as a percentage (0-100) of the image area. */
    silhouetteMinRegionPct: number;
    /** Maximum region size as a percentage (0-100) of the image area. */
    silhouetteMaxRegionPct: number;
    /** Whether adjacent same-color regions may both be selected. */
    silhouetteAllowAdjacent: boolean;
    /** Whole-piece area threshold, as a multiple of the average piece area. */
    silhouetteWholePieceFactor: number;
    /** Contour simplification tolerance, in source pixels. */
    silhouetteSimplifyTolerance: number;
    /** Contour smoothing strength, 0 (polygon) to 1 (full Catmull-Rom). */
    silhouetteSmoothing: number;
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
        config.baseCut === 'triangular' ? 'triangular'
        : config.baseCut === 'silhouette' ? 'silhouette'
        : DEFAULT_BASE_CUT;
    // Clamp to the slider's [0, 0.5] range. The generator re-clamps too, but
    // clamping here keeps the persisted preference within the documented range
    // (a hand-edited or stale localStorage value can't smuggle out-of-range
    // jitter back into the UI).
    const jitterRaw = Number(config.jitter);
    const jitter = Number.isFinite(jitterRaw)
        ? Math.min(0.5, Math.max(0, jitterRaw))
        : DEFAULT_JITTER;
    const smooth = config.smooth === true;

    const numOr = (v: unknown, fallback: number): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    // Silhouette sliders (defaults mirror DEFAULT_SILHOUETTE_PARAMS,
    // expressed in UI units — pct instead of frac).
    const silhouette = {
        silhouetteColorLevels: numOr(config.silhouetteColorLevels, 8),
        silhouetteMaxRegions: numOr(config.silhouetteMaxRegions, 5),
        silhouetteMinRegionPct: numOr(config.silhouetteMinRegionPct, 1),
        silhouetteMaxRegionPct: numOr(config.silhouetteMaxRegionPct, 25),
        silhouetteAllowAdjacent: config.silhouetteAllowAdjacent === true,
        silhouetteWholePieceFactor: numOr(config.silhouetteWholePieceFactor, 3),
        silhouetteSimplifyTolerance: numOr(config.silhouetteSimplifyTolerance, 4),
        silhouetteSmoothing: numOr(config.silhouetteSmoothing, 0.8),
    };

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
        ...silhouette,
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

/**
 * Translate a composable slider/preference config into the framework's
 * opaque {@link ComposableConfig}. Branches on `baseCut`: sine emits the
 * `{ha,hf,va,vf}` shape and honors borderless; triangular emits `{jitter}`
 * (rows are injected downstream from the size grid) and never borderless;
 * silhouette emits the sine lattice keys plus the compact segmentation bgc
 * keys (`cl,mr,mnf,mxf,aa,st,sm,wp`) and is never borderless (v1).
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
    if (slider.baseCut === 'silhouette') {
        return {
            baseCutGenerator: 'silhouette',
            baseCutConfig: {
                ha: slider.horizontalAmplitude,
                hf: slider.horizontalFrequency,
                va: slider.verticalAmplitude,
                vf: slider.verticalFrequency,
                cl: slider.silhouetteColorLevels,
                mr: slider.silhouetteMaxRegions,
                mnf: slider.silhouetteMinRegionPct / 100,
                mxf: slider.silhouetteMaxRegionPct / 100,
                aa: slider.silhouetteAllowAdjacent,
                st: slider.silhouetteSimplifyTolerance,
                sm: slider.silhouetteSmoothing,
                wp: slider.silhouetteWholePieceFactor,
            },
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
