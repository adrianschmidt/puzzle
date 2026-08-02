/**
 * The generation worker's message handler, separated from the worker
 * entry (`generation-worker.ts`) so it can be unit-tested: importing
 * the entry in jsdom would register a `message` listener on the shared
 * window and leak across tests.
 *
 * Runs in worker context in production. `track()` calls made by the
 * traced-tab loader no-op there (its `typeof window` guard) — accepted
 * by design; a worker-side chunk failure surfaces to analytics as
 * `generationFallbackKind: 'worker-infrastructure'` (with the detail in
 * `generationFallbackReason`) on `new-game-started` instead.
 */

import {
    preloadTracedTabGenerator,
    TracedTabLibraryNotLoadedError,
} from '../puzzle/topology/traced-tab-loader.js';
import {
    runGeneration,
    requestNeedsTracedTabs,
    type GenerationRequest,
    type GenerationResult,
} from './generation-core.js';

/**
 * Which half of the worker failed, so the client can pick a policy
 * rather than guess:
 *
 *  - `'infrastructure'` — the worker's own plumbing broke (the lazy
 *    traced chunk failed to fetch or was never loaded, the response
 *    failed to post). The main thread has its own copy of everything
 *    involved, so re-running the request there is likely to succeed:
 *    fall back.
 *  - `'generation'` — generation itself threw. Generation is a pure
 *    function of the request, so a main-thread rerun would throw the
 *    identical error a full generation later. Surface it now.
 *
 * Split by cause, not by which `try` caught the throw: a throw raised
 * from inside generation can still be about the realm rather than the
 * request ({@link TracedTabLibraryNotLoadedError}), and only the request
 * half reproduces across threads.
 */
export type GenerationFailureKind = 'infrastructure' | 'generation';

export type GenerationResponse =
    | { ok: true; result: GenerationResult }
    | { ok: false; kind: GenerationFailureKind; error: string; name: string };

export async function handleGenerationRequest(
    request: GenerationRequest,
): Promise<GenerationResponse> {
    if (requestNeedsTracedTabs(request)) {
        // The worker bundle has its own copy of the lazy traced
        // chunk (separate Rollup graph); the main thread's preload
        // does not warm it. Loaded on demand here.
        try {
            await preloadTracedTabGenerator();
        } catch (err) {
            return describeFailure('infrastructure', err);
        }
    }
    try {
        return { ok: true, result: runGeneration(request) };
    } catch (err) {
        return describeFailure(
            err instanceof TracedTabLibraryNotLoadedError ? 'infrastructure' : 'generation',
            err,
        );
    }
}

/**
 * Flatten a thrown value into the wire shape. `name` travels alongside
 * `message` because only plain data crosses `postMessage`: without it a
 * worker-side `TypeError: x is not a function` would reach the client as
 * a bare message, and this response is the only place worker-side
 * failures surface in analytics at all. The client puts the name back in
 * front of the message on both branches (`generate-async.ts`) rather than
 * letting it stop at the console: into `generationFallbackReason` for a
 * recovered failure, and into the rethrown error's own message for a
 * `'generation'` one, whose reason is built by the caller's
 * `new-game-failed` / `shared-load-failed`.
 */
export function describeFailure(
    kind: GenerationFailureKind,
    err: unknown,
): { ok: false; kind: GenerationFailureKind; error: string; name: string } {
    return {
        ok: false,
        kind,
        error: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
    };
}
