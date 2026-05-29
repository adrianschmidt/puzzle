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
import { sanitizeErrorReason } from '../../analytics/sanitize-error-reason.js';
import type { TabGenerator } from './plugin-types.js';

/**
 * Bucket a chunk-load failure so events aggregate despite the
 * high-cardinality raw `reason`. Matches the phrasings the major
 * engines use for a failed dynamic `import()` (Chromium "Failed to
 * fetch", Firefox "error loading", Safari "Importing a module script
 * failed"), and groups parse/eval failures of the fetched chunk —
 * including the missing-export invariant below — under `parse`.
 */
function classifyFailure(reason: string): 'network' | 'parse' | 'unknown' {
    const msg = reason.toLowerCase();
    if (
        msg.includes('failed to fetch')
        || msg.includes('error loading')
        || msg.includes('importing a module script failed')
        || msg.includes('dynamically imported module')
        || msg.includes('network')
    ) {
        return 'network';
    }
    if (
        msg.includes('syntax')
        || msg.includes('unexpected')
        || msg.includes('parse')
        || msg.includes('export')
    ) {
        return 'parse';
    }
    return 'unknown';
}

/**
 * Classify a resolved-chunk timing entry into the latency-relevant
 * cache states, from transfer size relative to the cached body size
 * (both populated for our same-origin chunk):
 *
 * - `warm`        — `transferSize === 0`: served from cache, no network.
 * - `revalidated` — a small nonzero transfer below the body size: a 304
 *                   round trip carried headers only, body from cache.
 *                   Still pays a round trip, so its latency sits between
 *                   warm and cold.
 * - `cold`        — transfer at/above the body size: full download.
 *
 * Keeping `revalidated` distinct stops 304s from inflating the
 * cold-latency distribution this metric exists to measure.
 * `deliveryType` is intentionally not consulted: it's ambiguous for
 * 304s across engines and redundant with `transferSize === 0` for a
 * true cache hit.
 */
function classifyEntryCache(
    entry: PerformanceResourceTiming,
): 'cold' | 'warm' | 'revalidated' {
    if (entry.transferSize === 0) {
        return 'warm';
    }
    if (entry.encodedBodySize > 0 && entry.transferSize < entry.encodedBodySize) {
        return 'revalidated';
    }
    return 'cold';
}

/**
 * Locate the resolved chunk's Resource Timing entry and classify it.
 *
 * Returns `'unknown'` when no usable entry is available — the API is
 * absent (non-browser/jsdom), the entry was evicted from a full
 * Resource Timing buffer (long-lived PWA sessions; the buffer size is
 * bumped at boot in main.ts to reduce this), or the import was mocked
 * in tests. `'unknown'` therefore conflates "unsupported" with
 * "evicted"; they aren't separable from here.
 */
function detectCacheState(): 'cold' | 'warm' | 'revalidated' | 'unknown' {
    if (typeof performance === 'undefined'
        || typeof performance.getEntriesByType !== 'function') {
        return 'unknown';
    }
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
        // Coupled to the dynamic import below: Vite names the lazy chunk
        // after its entry module, so the emitted file is
        // `traced-tab-generator-<hash>.js`. A manualChunks/chunkFileNames
        // rename would break this match — keep the two in sync.
        if (entries[i].name.includes('traced-tab-generator')) {
            return classifyEntryCache(entries[i]);
        }
    }
    return 'unknown';
}

let preloadPromise: Promise<void> | null = null;
let realGenerator: TabGenerator | null = null;
let attemptCount = 0;

function ensureLoaded(): TabGenerator {
    if (!realGenerator) {
        throw new Error(
            'Traced tab library not loaded. '
            + 'Call preloadTracedTabGenerator() before generating traced tabs.',
        );
    }
    return realGenerator;
}

export const tracedTabGeneratorStub: TabGenerator = {
    id: 'traced',
    generate(edge, random, config) {
        return ensureLoaded().generate(edge, random, config);
    },
    // Forward the retry ladder too, so `applyTabs` runs it via the
    // registry path (not just the single-candidate `generate`). Without
    // this, the stub looks like a non-variant generator and the ladder
    // silently never runs in the app. Falls back to a single `generate`
    // candidate if a future real generator drops `generateVariants`.
    generateVariants(edge, random, config) {
        const real = ensureLoaded();
        if (real.generateVariants) {
            return real.generateVariants(edge, random, config);
        }
        const candidate = real.generate(edge, random, config);
        return candidate ? [candidate] : [];
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
 * Emits analytics per actual import attempt: `traced-chunk-preload-started`
 * up front, then `traced-chunk-loaded` (with `durationMs` + `cacheState`)
 * on success or `traced-chunk-load-failed` (with `reason` + `kind`) on
 * rejection. Every event carries the 1-based `attempt` counter so a
 * retry after a failure is distinguishable from an unrelated cold load.
 * Repeat calls that return the cached promise emit nothing, so the
 * events count real fetches rather than awaits.
 */
export function preloadTracedTabGenerator(): Promise<void> {
    if (preloadPromise) return preloadPromise;
    const attempt = ++attemptCount;
    const startedAt = performance.now();
    track('traced-chunk-preload-started', { attempt });
    // The chunk emitted for this specifier is `traced-tab-generator-<hash>.js`;
    // detectCacheState() matches its Resource Timing entry by that name.
    const inflight = import('./traced-tab-generator.js').then((m) => {
        if (!m.tracedTabGenerator) {
            // Chunk fetched and parsed, but the expected export is absent
            // (a tree-shake / rename regression). Treat as a failure so it
            // surfaces here instead of as a confusing stub throw later.
            throw new Error('Traced chunk resolved without a tracedTabGenerator export');
        }
        realGenerator = m.tracedTabGenerator;
        track('traced-chunk-loaded', {
            durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            cacheState: detectCacheState(),
            attempt,
        });
    }).catch((err) => {
        if (preloadPromise === inflight) preloadPromise = null;
        const reason = sanitizeErrorReason(err);
        track('traced-chunk-load-failed', {
            reason,
            kind: classifyFailure(reason),
            attempt,
        });
        throw err;
    });
    preloadPromise = inflight;
    return preloadPromise;
}
