/**
 * Reproducing an existing save or share link doesn't go through here: those
 * carry their own per-style config, and a pre-upgrade Classic or legacy-tab Wavy
 * link needs no chunk even though the style declares `'always'`.
 */

import { cutStyleNeedsTracedTabs, type CutStyle } from '../game/cut-styles.js';

export interface TracedTabPlan {
    /** Cut style the game is actually generated with — may differ from the requested one. */
    cutStyle: CutStyle;
    preloadChunk: boolean;
    /**
     * Generate the legacy straight-grid Classic cut whatever the chunk fetch
     * reports. Only the boot fallback sets it, always with `preloadChunk: false`.
     * It rides on the plan rather than being re-derived at the fetch-outcome site
     * so the two halves can't drift: without it, the skipped fetch reads as a
     * success, the caller stamps the sine config, and generation runs the traced
     * pipeline against a registry whose chunk was never loaded.
     */
    forceLegacyClassic: boolean;
}

/**
 * The cut style the boot fallback is forced to. Exported so the fallback's
 * failure-event attribution names the style it attempted, without a second
 * literal to keep in step.
 */
export const BOOT_FALLBACK_CUT_STYLE: CutStyle = 'classic';

/**
 * `bootFallback` is the last-resort boot puzzle (#488): forces the legacy
 * Classic cut and never touches the chunk. Forcing the style here rather than
 * trusting the caller is deliberate — a safety net that can be handed `'wavy'`
 * is not one.
 */
export function planTracedTabs(opts: {
    cutStyle: CutStyle;
    tabGenerator?: string;
    bootFallback?: boolean;
}): TracedTabPlan {
    if (opts.bootFallback) {
        return { cutStyle: BOOT_FALLBACK_CUT_STYLE, preloadChunk: false, forceLegacyClassic: true };
    }
    return {
        cutStyle: opts.cutStyle,
        preloadChunk: cutStyleNeedsTracedTabs(opts.cutStyle, opts.tabGenerator),
        forceLegacyClassic: false,
    };
}

/**
 * What the settled chunk fetch means for generation. `legacy-classic` is
 * Classic without its sine config (the straight-grid cut); `degraded` separates
 * "a fetch failed" (warn + flag analytics) from "never tried" (boot fallback).
 * `fail` means the style can't generate without the chunk; the caller rethrows.
 */
export type TracedTabOutcome =
    | { kind: 'ok' }
    | { kind: 'legacy-classic'; degraded: false }
    | { kind: 'legacy-classic'; degraded: true; error: unknown }
    | { kind: 'fail'; error: unknown };

export function resolveTracedTabOutcome(opts: {
    plan: TracedTabPlan;
    /**
     * Why the chunk fetch rejected, or `null` for "succeeded, or never started".
     * The `null` sentinel is a documented convention, not type-enforced (the
     * union collapses to `unknown`), so the caller must coerce a falsy rejection
     * reason into a real Error.
     */
    chunkError: unknown;
}): TracedTabOutcome {
    // Before the `chunkError` check, not after: the boot fallback never started
    // a fetch, so its `null` would otherwise read as success and license the
    // sine config it must not have.
    if (opts.plan.forceLegacyClassic) return { kind: 'legacy-classic', degraded: false };
    if (opts.chunkError === null) return { kind: 'ok' };
    // Classic is the only style whose generator works without the chunk, so it
    // degrades instead of failing the start — keeping the default style booting
    // when the fetch fails.
    if (opts.plan.cutStyle !== 'classic') return { kind: 'fail', error: opts.chunkError };
    return { kind: 'legacy-classic', degraded: true, error: opts.chunkError };
}
