/**
 * Uses the tangent-smoothed splicer so flowy photographed curves join with C1
 * continuity. The trace-set version selects which frozen trace list backs the
 * template (getTracedTemplates). Per edge it consumes EXACTLY 3 outer PRNG calls
 * (2 placement + 1 template subSeed), regardless of version or retry rungs.
 *
 * Both entry points share `tracedTabVariants`: it yields the base tab, then a
 * short retry ladder of cheap local variations (sign flip, shrink,
 * shrunk-and-centered); the framework commits the first that survives its
 * crossing checks. With `deepResolve` (triangular cuts) the ladder expands to
 * scale×invert rungs plus a smallest-scale center-pull tier; the PRNG draw count
 * is unchanged.
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
 * Deep-ladder scale factors (triangular base cut): full, then three ×0.8 steps
 * (smallest ~0.51). Each is tried upright then inverted before the next.
 */
const DEEP_SCALES = [1, SHRINK, SHRINK * SHRINK, SHRINK * SHRINK * SHRINK] as const;

/** One ladder rung: tab center position, tab/blank orientation, tab path. */
type Rung = readonly [number, boolean, BezierPath];

/**
 * Read the deep-resolution flag from the opaque tab config. The generator is
 * base-cut agnostic; `generateTopologyPuzzle` sets this only for triangular
 * cuts, whose cramped pieces reject the shallow ladder too often.
 */
function readDeepResolve(config: unknown): boolean {
    return (config as { deepResolve?: unknown } | null | undefined)?.deepResolve === true;
}

function defaultRungs(
    basePath: BezierPath,
    tCenter: number,
    tPulled: number,
    isTab: boolean,
): readonly Rung[] {
    const shrunk = scaleBezierPath(basePath, SHRINK, SHRINK);
    return [
        [tCenter, isTab, basePath],   // base (== generate())
        [tCenter, !isTab, basePath],  // flip sign
        [tCenter, isTab, shrunk],     // shrink
        [tPulled, isTab, shrunk],     // shrink + pull-to-center
    ];
}

/**
 * Deep ladder for triangular cuts. Each scale is tried upright then inverted,
 * then a center-pull tier at the smallest scale as a last resort. The framework
 * commits the first rung that survives its crossing checks, so an edge takes the
 * largest, most-upright tab that fits.
 */
function deepRungs(
    basePath: BezierPath,
    tCenter: number,
    tPulled: number,
    isTab: boolean,
): readonly Rung[] {
    const s1 = scaleBezierPath(basePath, DEEP_SCALES[1], DEEP_SCALES[1]);
    const s2 = scaleBezierPath(basePath, DEEP_SCALES[2], DEEP_SCALES[2]);
    const s3 = scaleBezierPath(basePath, DEEP_SCALES[3], DEEP_SCALES[3]);
    return [
        [tCenter, isTab, basePath], [tCenter, !isTab, basePath], // 1.0
        [tCenter, isTab, s1],       [tCenter, !isTab, s1],       // 0.8
        [tCenter, isTab, s2],       [tCenter, !isTab, s2],       // 0.64
        [tCenter, isTab, s3],       [tCenter, !isTab, s3],       // 0.512
        [tPulled, isTab, s3],       [tPulled, !isTab, s3],       // 0.512 + center
    ];
}

/**
 * Build each version's template once (not per edge) — keeps the per-edge path
 * allocation-free beyond the template's own.
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
 * Read the trace-set version from the opaque tab config. Absent/invalid ⇒
 * version 1: an un-versioned config is a legacy caller that must reproduce
 * against v1. Share-link decode clamps a future version to a known one first.
 */
function readTraceSetVersion(config: unknown): number {
    const v = (config as { traceSetVersion?: unknown } | null | undefined)?.traceSetVersion;
    return normalizeTraceSetVersion(v) ?? 1;
}

/**
 * All PRNG draws (placement + the one template path) happen before the
 * first yield.
 */
function* tracedTabVariants(
    edge: Curve,
    random: () => number,
    version: number,
    deep: boolean,
): Generator<Curve | null> {
    const placement = computeTabPlacement(edge, DEFAULT_TAB_PLACEMENT, random);
    if (!placement) return;
    const basePath = templateForVersion(version).generate(random);

    const { tCenter, isTab } = placement;
    const tPulled = tCenter + (0.5 - tCenter) * CENTER_PULL;

    const rungs = deep
        ? deepRungs(basePath, tCenter, tPulled, isTab)
        : defaultRungs(basePath, tCenter, tPulled, isTab);

    for (const [tc, tab, path] of rungs) {
        yield spliceSmoothedFromPath(edge, tc, tab, path);
    }
}

export const tracedTabGenerator: TabGenerator = {
    id: 'traced',

    generate(edge: Curve, random: () => number, config: unknown): Curve | null {
        const version = readTraceSetVersion(config);
        const deep = readDeepResolve(config);
        for (const variant of tracedTabVariants(edge, random, version, deep)) {
            if (variant) return variant;
        }
        return null;
    },

    generateVariants(edge: Curve, random: () => number, config: unknown): Iterable<Curve | null> {
        return tracedTabVariants(
            edge,
            random,
            readTraceSetVersion(config),
            readDeepResolve(config),
        );
    },
};
