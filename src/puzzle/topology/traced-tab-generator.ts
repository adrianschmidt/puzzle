/**
 * Traced tab generator: produces tab shapes from the photographed library.
 * Uses the tangent-smoothed splicer so the flowy photographed curves join the
 * parent edge with C1 continuity.
 *
 * The trace-set version (from the opaque tab config) selects which frozen,
 * ordered trace list backs the template — see getTracedTemplates. Per edge the
 * generator consumes EXACTLY 3 outer PRNG calls (2 placement + 1 template
 * subSeed) regardless of version or how many retry rungs are tried.
 *
 * Both entry points share one ladder generator, `tracedTabVariants`: it yields
 * the base tab first, then a short "retry ladder" of cheap local variations
 * (sign flip, shrink, shrunk-and-centered). The framework commits the first
 * that survives its crossing checks.
 */

import type { Curve } from './curve.js';
import { createTracedTabTemplate } from '../composable/tab-shapes-traced.js';
import { getTracedTemplates } from '../composable/traces/index.js';
import { normalizeTraceSetVersion } from '../composable/traces/trace-set-version.js';
import type { TabTemplate } from '../composable/tab-shapes.js';
import { scaleBezierPath } from '../composable/bezier-path.js';
import type { BezierPath } from '../composable/bezier-path.js';
import type { TabGenerator } from './plugin-types.js';
import {
    computeTabPlacement,
    spliceSmoothedFromPath,
    DEFAULT_TAB_PLACEMENT,
} from './tab-generator-helpers.js';

/** Shrink factor for the "smaller tab" rungs. */
const SHRINK = 0.8;
/** Fraction to pull the tab center toward mid-edge (0.5) on the move rungs. */
const CENTER_PULL = 0.5;

/**
 * Build each version's template once (not per edge). The factory is cheap, but
 * memoizing keeps the per-edge path allocation-free beyond the template's own.
 */
const templatesByVersion = new Map<number, TabTemplate>();
function templateForVersion(version: number): TabTemplate {
    let t = templatesByVersion.get(version);
    if (!t) {
        t = createTracedTabTemplate(getTracedTemplates(version));
        templatesByVersion.set(version, t);
    }
    return t;
}

/**
 * Read the trace-set version from the opaque tab config. Absent / invalid ⇒
 * version 1 (the original set): an un-versioned config is a pre-versioning
 * (legacy) caller and must reproduce against v1. Share-link decode clamps a
 * future version to a known one before it ever reaches here.
 */
function readTraceSetVersion(config: unknown): number {
    const v = (config as { traceSetVersion?: unknown } | null | undefined)?.traceSetVersion;
    return normalizeTraceSetVersion(v) ?? 1;
}

/**
 * The retry ladder, shared by `generate` and `generateVariants`. All PRNG
 * draws (placement + the one template path) happen before the first yield.
 */
function* tracedTabVariants(
    edge: Curve,
    random: () => number,
    version: number,
): Generator<Curve | null> {
    const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
    if (!placement) return;
    const basePath = templateForVersion(version).generate(random);

    const { tCenter, isTab } = placement;
    const tPulled = tCenter + (0.5 - tCenter) * CENTER_PULL;
    const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);

    const rungs: ReadonlyArray<readonly [number, boolean, BezierPath]> = [
        [tCenter, isTab, basePath],   // base (== generate())
        [tCenter, !isTab, basePath],  // flip sign (first retry)
        [tCenter, isTab, shrunk],     // shrink
        [tPulled, isTab, shrunk],     // shrink + pull-to-center
    ];

    for (const [tc, tab, path] of rungs) {
        yield spliceSmoothedFromPath(edge, tc, tab, path);
    }
}

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, config: unknown): Curve | null {
        const version = readTraceSetVersion(config);
        for (const variant of tracedTabVariants(edge, random, version)) {
            if (variant) return variant;
        }
        return null;
    },

    generateVariants(edge: Curve, random: () => number, config: unknown): Iterable<Curve | null> {
        return tracedTabVariants(edge, random, readTraceSetVersion(config));
    },
};
