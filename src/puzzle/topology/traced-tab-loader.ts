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

/**
 * Turn an arbitrary rejection into a bounded, low-disclosure `reason`
 * string for analytics: strip URLs (per-deploy chunk hashes rotate
 * cardinality) and extension origins (ad-blocker IDs are fingerprints),
 * fall back to `'unknown'` for empty messages, then cap the length.
 */
function describeFailure(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const redacted = raw
        .replace(/https?:\/\/\S+/gi, '<url>')
        .replace(/chrome-extension:\/\/\S+/gi, '<ext>')
        .replace(/moz-extension:\/\/\S+/gi, '<ext>')
        .trim();
    const reason = redacted || 'unknown';
    return reason.length > REASON_MAX_LENGTH
        ? reason.slice(0, REASON_MAX_LENGTH)
        : reason;
}

/**
 * Bucket a chunk-load failure so events aggregate despite the
 * high-cardinality raw `reason`. Matches the phrasings the major
 * engines use for a failed dynamic `import()` (Chromium "Failed to
 * fetch", Firefox "error loading", Safari "Importing a module script
 * failed") and for a parse/eval failure of the fetched chunk.
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
    ) {
        return 'parse';
    }
    return 'unknown';
}

/**
 * Best-effort cache classification for the resolved chunk via the
 * Resource Timing API. A same-origin entry with `transferSize === 0`
 * was served from the HTTP cache (warm); a non-zero transfer was
 * fetched over the network (cold). Returns `'unknown'` when no timing
 * entry is available (API absent, buffer evicted, mocked in tests).
 */
function detectCacheState(): 'cold' | 'warm' | 'unknown' {
    if (typeof performance === 'undefined'
        || typeof performance.getEntriesByType !== 'function') {
        return 'unknown';
    }
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].name.includes('traced-tab-generator')) {
            return entries[i].transferSize === 0 ? 'warm' : 'cold';
        }
    }
    return 'unknown';
}

let preloadPromise: Promise<void> | null = null;
let realGenerator: TabGenerator | null = null;
let attemptCount = 0;

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
    const inflight = import('./traced-tab-generator.js').then((m) => {
        realGenerator = m.tracedTabGenerator;
        track('traced-chunk-loaded', {
            durationMs: Math.round(performance.now() - startedAt),
            cacheState: detectCacheState(),
            attempt,
        });
    }).catch((err) => {
        if (preloadPromise === inflight) preloadPromise = null;
        const reason = describeFailure(err);
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
