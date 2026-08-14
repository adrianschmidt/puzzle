/**
 * Asymmetric by style: Wavy and Triangles always get their trace-set version
 * (no fallback); Classic only when traced tabs loaded (else legacy); Composable
 * never (not a trace consumer); Fractal passes through regardless of cutStyle.
 */

import type { CutStyle } from '../game/cut-styles.js';
import type { FractalDialogConfig, WavyDialogConfig } from '../ui/index.js';
import { CURRENT_TRACE_SET_VERSION } from '../puzzle/composable/traces/trace-set-version.js';

export interface GeneratorConfigs {
    fractalConfig?: { borderless: boolean };
    wavyConfig?: { borderless: boolean; traceSetVersion: number };
    trianglesConfig?: { traceSetVersion: number };
    classicConfig?: { traceSetVersion: number };
}

/**
 * A Classic game without `classicConfig` falls back to the legacy
 * straight-grid generator, so `classic && !tracedTabsOk` producing `{}` is the
 * `legacy-classic` outcome, deliberately — not an omission.
 */
export function generatorConfigsForNewGame(opts: {
    cutStyle: CutStyle;
    fractalConfig?: FractalDialogConfig;
    wavyConfig?: WavyDialogConfig;
    /** True when traced tabs are available — `TracedTabOutcome.kind === 'ok'`. */
    tracedTabsOk: boolean;
}): GeneratorConfigs {
    const configs: GeneratorConfigs = {};

    if (opts.fractalConfig) {
        configs.fractalConfig = { borderless: opts.fractalConfig.borderless };
    }

    // This path only creates fresh puzzles, so stamping the current trace-set
    // version is always correct; older saves/links are reproduced verbatim
    // elsewhere.
    if (opts.cutStyle === 'wavy') {
        configs.wavyConfig = {
            borderless: opts.wavyConfig?.borderless ?? false,
            traceSetVersion: CURRENT_TRACE_SET_VERSION,
        };
    }

    // Same stamping rationale as wavyConfig above.
    if (opts.cutStyle === 'triangles') {
        configs.trianglesConfig = { traceSetVersion: CURRENT_TRACE_SET_VERSION };
    }

    // Stamping activates the sine-based generator for fresh Classic puzzles;
    // withholding it is the `legacy-classic` fallback (see the function doc).
    if (opts.cutStyle === 'classic' && opts.tracedTabsOk) {
        configs.classicConfig = { traceSetVersion: CURRENT_TRACE_SET_VERSION };
    }

    return configs;
}
