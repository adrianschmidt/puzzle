/**
 * The decision is asymmetric by style: Wavy and Triangles always get their
 * versions because those styles have no fallback; Classic only when traced
 * tabs loaded (otherwise it falls back to legacy); Composable never (it is
 * not a trace consumer); and Fractal passes through regardless of cutStyle.
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
 * Withholding `classicConfig` is not an omission; it is a decision. A Classic
 * game without `classicConfig` falls back to the legacy straight-grid
 * generator. So `cutStyle === 'classic' && !tracedTabsOk` producing `{}` is
 * the `legacy-classic` outcome, deliberately.
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

    // Every new Wavy game uses traced tabs at the current trace-set version.
    // Older saves/links carry their own (or no) version and are reproduced
    // verbatim elsewhere; this path only ever creates fresh puzzles, so
    // stamping the current version is always correct.
    if (opts.cutStyle === 'wavy') {
        configs.wavyConfig = {
            borderless: opts.wavyConfig?.borderless ?? false,
            traceSetVersion: CURRENT_TRACE_SET_VERSION,
        };
    }

    // Every new Triangles game uses traced tabs at the current trace-set
    // version — same stamping rationale as wavyConfig above.
    if (opts.cutStyle === 'triangles') {
        configs.trianglesConfig = { traceSetVersion: CURRENT_TRACE_SET_VERSION };
    }

    // Every new Classic game uses the sine-based generator with traced tabs at
    // the current trace-set version. A Classic game without this config falls
    // back to the legacy generator, so stamping it is what activates the
    // upgrade for fresh puzzles, and withholding it is what the
    // `legacy-classic` outcome means.
    if (opts.cutStyle === 'classic' && opts.tracedTabsOk) {
        configs.classicConfig = { traceSetVersion: CURRENT_TRACE_SET_VERSION };
    }

    return configs;
}
