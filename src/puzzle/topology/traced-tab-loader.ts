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

import { track } from '../../analytics/index.js';
import type { TabGenerator } from './plugin-types.js';

const REASON_MAX_LENGTH = 200;

function describeFailure(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return raw.length > REASON_MAX_LENGTH
        ? raw.slice(0, REASON_MAX_LENGTH)
        : raw;
}

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
 *
 * Emits one analytics event per actual import attempt:
 * `traced-chunk-loaded` (with measured `durationMs`) on success, or
 * `traced-chunk-load-failed` (with `reason`) on rejection. Repeat
 * calls that return the cached promise emit nothing, so the events
 * count real fetches rather than awaits.
 */
export function preloadTracedTabGenerator(): Promise<void> {
    if (preloadPromise) return preloadPromise;
    const startedAt = performance.now();
    const inflight = import('./traced-tab-generator.js').then((m) => {
        realGenerator = m.tracedTabGenerator;
        track('traced-chunk-loaded', {
            durationMs: Math.round(performance.now() - startedAt),
        });
    }).catch((err) => {
        if (preloadPromise === inflight) preloadPromise = null;
        track('traced-chunk-load-failed', { reason: describeFailure(err) });
        throw err;
    });
    preloadPromise = inflight;
    return preloadPromise;
}
