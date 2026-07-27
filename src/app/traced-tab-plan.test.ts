import { describe, it, expect } from 'vitest';

import { planTracedTabs, resolveTracedTabOutcome } from './traced-tab-plan.js';

describe('planTracedTabs', () => {
    it('fetches the chunk for the styles that always use traced tabs', () => {
        expect(planTracedTabs({ cutStyle: 'classic' }))
            .toEqual({ cutStyle: 'classic', preloadChunk: true, forceLegacyClassic: false });
        expect(planTracedTabs({ cutStyle: 'wavy' }))
            .toEqual({ cutStyle: 'wavy', preloadChunk: true, forceLegacyClassic: false });
        expect(planTracedTabs({ cutStyle: 'triangles' }))
            .toEqual({ cutStyle: 'triangles', preloadChunk: true, forceLegacyClassic: false });
    });

    it('skips the chunk for a style that never uses traced tabs', () => {
        expect(planTracedTabs({ cutStyle: 'fractal' }))
            .toEqual({ cutStyle: 'fractal', preloadChunk: false, forceLegacyClassic: false });
    });

    it('follows the per-game tab generator for composable', () => {
        expect(planTracedTabs({ cutStyle: 'composable', tabGenerator: 'traced' }).preloadChunk).toBe(true);
        expect(planTracedTabs({ cutStyle: 'composable', tabGenerator: 'classic' }).preloadChunk).toBe(false);
        expect(planTracedTabs({ cutStyle: 'composable' }).preloadChunk).toBe(false);
    });

    it('forces legacy Classic and no chunk fetch for the boot fallback', () => {
        const styles = ['classic', 'wavy', 'triangles', 'fractal', 'composable'] as const;
        for (const cutStyle of styles) {
            expect(planTracedTabs({ cutStyle, tabGenerator: 'traced', bootFallback: true }))
                .toEqual({ cutStyle: 'classic', preloadChunk: false, forceLegacyClassic: true });
        }
    });
});

describe('resolveTracedTabOutcome', () => {
    const error = new Error('chunk boom');

    it('generates as requested when nothing failed', () => {
        expect(resolveTracedTabOutcome({ plan: planTracedTabs({ cutStyle: 'wavy' }), chunkError: null }))
            .toEqual({ kind: 'ok' });
        expect(resolveTracedTabOutcome({ plan: planTracedTabs({ cutStyle: 'fractal' }), chunkError: null }))
            .toEqual({ kind: 'ok' });
    });

    it('degrades Classic to the legacy cut when the fetch failed', () => {
        expect(resolveTracedTabOutcome({ plan: planTracedTabs({ cutStyle: 'classic' }), chunkError: error }))
            .toEqual({ kind: 'legacy-classic', degraded: true, error });
    });

    it('fails every other style when the fetch failed', () => {
        for (const cutStyle of ['wavy', 'triangles', 'composable'] as const) {
            expect(resolveTracedTabOutcome({
                plan: { cutStyle, preloadChunk: true, forceLegacyClassic: false },
                chunkError: error,
            })).toEqual({ kind: 'fail', error });
        }
    });

    it('reports the boot fallback as an undegraded legacy Classic', () => {
        expect(resolveTracedTabOutcome({
            plan: planTracedTabs({ cutStyle: 'wavy', bootFallback: true }),
            chunkError: null,
        })).toEqual({ kind: 'legacy-classic', degraded: false });
    });

    it('keeps the boot fallback undegraded even if a chunk error is somehow reported', () => {
        // Unreachable through `planTracedTabs`, which never pairs
        // `forceLegacyClassic` with a fetch — that is exactly why the
        // short-circuit order needs pinning here. Reversing the two checks
        // would turn this into `degraded: true`, and for a non-Classic
        // request into `kind: 'fail'`, i.e. the safety net rethrowing.
        expect(resolveTracedTabOutcome({
            plan: { cutStyle: 'classic', preloadChunk: false, forceLegacyClassic: true },
            chunkError: error,
        })).toEqual({ kind: 'legacy-classic', degraded: false });
    });
});
