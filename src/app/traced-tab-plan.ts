/**
 * The traced-tab decision for a *new* game, in the two halves it
 * naturally has: what to do before the lazy chunk fetch starts, and what
 * the fetch's outcome means once it settles.
 *
 * Extracted from `main.ts` because that file is not importable under
 * test, so every rule here — including the Classic degradation — was
 * previously unverifiable.
 *
 * Reproducing an existing save or share link is a different question and
 * does not go through here: those carry their own per-style config, and
 * a pre-upgrade Classic link or a legacy-tab Wavy link needs no chunk
 * even though the style declares `'always'`.
 */

import { cutStyleNeedsTracedTabs, type CutStyle } from '../game/cut-styles.js';

export interface TracedTabPlan {
    /** Cut style the game is actually generated with. */
    cutStyle: CutStyle;
    /** Whether to start the lazy traced-tab chunk fetch. */
    preloadChunk: boolean;
    /**
     * Generate the legacy straight-grid Classic cut whatever the chunk
     * fetch reports. Only the boot fallback sets it, always paired with
     * `preloadChunk: false`.
     *
     * It rides on the plan rather than being re-derived at the
     * fetch-outcome site so the two halves of the decision cannot drift
     * apart. `resolveTracedTabOutcome` without it would read the skipped
     * fetch as a success, the caller would stamp the sine config, and
     * generation would run the traced pipeline against a registry whose
     * chunk was never loaded — the safety net failing in exactly the
     * scenario it exists for.
     */
    forceLegacyClassic: boolean;
}

/**
 * Decide, before any fetch, which cut style to generate and whether the
 * traced-tab chunk is needed for it.
 *
 * `bootFallback` is the last-resort boot puzzle (#488): the boot path's
 * preferred start already failed, so this one forces the legacy Classic
 * cut and never touches the chunk. Forcing the style here rather than
 * trusting the caller is deliberate — a safety net that can be handed
 * `'wavy'` is not a safety net.
 */
export function planTracedTabs(opts: {
    cutStyle: CutStyle;
    tabGenerator?: string;
    bootFallback?: boolean;
}): TracedTabPlan {
    if (opts.bootFallback) {
        return { cutStyle: 'classic', preloadChunk: false, forceLegacyClassic: true };
    }
    return {
        cutStyle: opts.cutStyle,
        preloadChunk: cutStyleNeedsTracedTabs(opts.cutStyle, opts.tabGenerator),
        forceLegacyClassic: false,
    };
}

/**
 * What the settled chunk fetch means for generation.
 *
 * - `ok` — generate as requested.
 * - `legacy-classic` — Classic without its sine config, i.e. the legacy
 *   straight-grid cut. `degraded` separates "a fetch failed" (warn, and
 *   flag the analytics event) from "we never tried" (the boot fallback).
 * - `fail` — the style needs traced tabs and cannot be generated without
 *   them; the caller rethrows `error`.
 */
export type TracedTabOutcome =
    | { kind: 'ok' }
    | { kind: 'legacy-classic'; degraded: false }
    | { kind: 'legacy-classic'; degraded: true; error: unknown }
    | { kind: 'fail'; error: unknown };

export function resolveTracedTabOutcome(opts: {
    /** The plan the fetch was (or was not) started from. */
    plan: TracedTabPlan;
    /**
     * Why the chunk fetch rejected, or `null` for "it succeeded, or it was
     * never started". Typed `unknown` rather than `unknown | null` — the
     * union collapses to `unknown` anyway — so the `null` sentinel is a
     * documented convention, not a type-enforced one. The caller already
     * has to coerce a falsy rejection reason (`reject()`, `reject(null)`)
     * into a real Error for it to hold.
     */
    chunkError: unknown;
}): TracedTabOutcome {
    // Before the `chunkError` check, not after: the boot fallback never
    // started a fetch, so its `null` would otherwise read as a success and
    // license the sine config it must not have.
    if (opts.plan.forceLegacyClassic) return { kind: 'legacy-classic', degraded: false };
    if (opts.chunkError === null) return { kind: 'ok' };
    // Classic is the only style whose generator works without the chunk,
    // so it degrades instead of failing the whole start. That is what
    // keeps the default style booting when the fetch fails.
    if (opts.plan.cutStyle !== 'classic') return { kind: 'fail', error: opts.chunkError };
    return { kind: 'legacy-classic', degraded: true, error: opts.chunkError };
}
