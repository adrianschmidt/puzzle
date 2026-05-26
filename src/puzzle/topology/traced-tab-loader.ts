/**
 * Lazy registration for the traced tab generator.
 *
 * The 20 trace JSONs (~80 KB raw / ~10–15 KB gzipped) and
 * `tab-shapes-traced.ts` live behind a dynamic `import()`, so they
 * don't ship in the main chunk. The only UI route that can ever
 * select traced tabs (the Composable cut style) is hidden in
 * production, but a share link with `cf.tg: "traced"` can land at
 * any client, so the code path stays reachable — just lazily.
 *
 * The registry hands out the {@link tracedTabGeneratorStub} at boot.
 * Callers that are about to run traced generation must `await
 * preloadTracedTabGenerator()` first so the dynamic import resolves
 * and the stub's delegate slot is filled. After preload the stub
 * keeps doing the dispatch — no re-registration is required.
 */

import type { TabGenerator } from './plugin-types.js';

let preloadPromise: Promise<void> | null = null;
let realGenerator: TabGenerator | null = null;

export const tracedTabGeneratorStub: TabGenerator = {
    id: 'traced',
    generate(edge, random, config) {
        if (!realGenerator) {
            throw new Error(
                'Traced tab library not loaded. '
                + 'Call preloadTracedTabGenerator() before generating traced tabs.',
            );
        }
        return realGenerator.generate(edge, random, config);
    },
};

/**
 * Trigger the dynamic import of the traced tab implementation.
 *
 * Idempotent and safe to call repeatedly — concurrent callers and
 * later retry attempts all share the same in-flight promise.
 * Awaiting the returned promise guarantees that the next synchronous
 * traced-tab generation will use the real implementation.
 *
 * If the dynamic import rejects (transient network failure, stale
 * deploy hash mismatch, offline), the cached promise is cleared so
 * the next call retries from scratch. The rejection is still
 * propagated to the awaiting caller.
 */
export function preloadTracedTabGenerator(): Promise<void> {
    if (preloadPromise) return preloadPromise;
    const inflight = import('./traced-tab-generator.js').then((m) => {
        realGenerator = m.tracedTabGenerator;
    }).catch((err) => {
        if (preloadPromise === inflight) preloadPromise = null;
        throw err;
    });
    preloadPromise = inflight;
    return preloadPromise;
}
