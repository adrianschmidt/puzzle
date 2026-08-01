/**
 * Main-thread client for off-thread puzzle generation.
 *
 * Spawns a fresh worker per call and terminates it when done: per-call
 * lifetime keeps cancellation trivial (terminate) and leaves no stale
 * worker-side state, and spawn cost is milliseconds against a
 * once-per-new-game operation. On any failure of the worker PATH — no
 * Worker in this environment, spawn failure, script-load failure, a
 * worker-side traced-chunk failure — generation falls back to running
 * synchronously on the main thread, which is exactly the pre-worker
 * status quo.
 *
 * The one failure that does not fall back is a `kind: 'generation'`
 * response (`generation-worker-core.ts`): generation is a pure function
 * of the request, so that rerun is guaranteed to throw the identical
 * error after a second full generation. This module rethrows it to the
 * caller, whose failure event is where it surfaces.
 *
 * Cancellation: an aborted signal terminates the worker and rejects
 * with {@link GenerationCancelledError}. Cancel never falls back —
 * the user asked for no puzzle, not a slower one.
 */

import { diagnostics } from '../diagnostics.js';
import { sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';
import { preloadTracedTabGenerator } from '../puzzle/topology/traced-tab-loader.js';
import {
    runGeneration,
    requestNeedsTracedTabs,
    type GenerationRequest,
    type GenerationResult,
} from './generation-core.js';
import type { GenerationResponse } from './generation-worker-core.js';

/** Rejection sentinel for a cancelled generation. */
export class GenerationCancelledError extends Error {
    constructor() {
        super('Puzzle generation cancelled');
        this.name = 'GenerationCancelledError';
    }
}

/**
 * Low-cardinality bucket for why generation ran on the main thread,
 * reported alongside the free-text `fallbackReason`. The reasons are
 * unbucketable strings on their own — per the HTML spec a worker whose
 * script fails to fetch fires a plain `Event` with no `message`, so
 * chunk-missing-from-precache, a CSP-blocked worker and a build with no
 * module-worker support all produce the same text.
 */
export type GenerationFallbackKind =
    /** No `Worker` constructor in this environment. */
    | 'no-worker'
    /** `new Worker(...)` or the request `postMessage` threw synchronously. */
    | 'spawn-failed'
    /** The worker fired `error`: script fetch/parse failure, or an uncaught throw. */
    | 'worker-error'
    /**
     * The response could not be used: it failed to deserialize
     * (`messageerror`), or reading the delivered payload threw.
     */
    | 'message-error'
    /** The worker reported a failure of its own plumbing (traced chunk, reply post). */
    | 'worker-infrastructure';

/**
 * A worker-side failure of `runGeneration` itself. Deterministic — the same
 * request generates the same way on either thread — so this must NOT be
 * retried on the main thread: the rerun would freeze it for a second full
 * generation and end in the identical error.
 */
class WorkerGenerationError extends Error {
    constructor(message: string, workerErrorName: string) {
        // The worker-side type goes into the message rather than onto
        // `name`, because this error is the one path that leaves this
        // module unhandled: it reaches `runWithErrorReport`, whose
        // `new-game-failed` / `shared-load-failed` reason is
        // `sanitizeErrorReason`, which reads `.message` only. Left on
        // `name` it would stop at the console — on the branch the player
        // actually sees fail, while the silently-recovering branch keeps it.
        super(withErrorName(workerErrorName, message));
        this.name = 'WorkerGenerationError';
    }
}

/** A failure of the worker path itself; re-running on the main thread is the answer. */
class WorkerPathError extends Error {
    readonly kind: GenerationFallbackKind;
    constructor(kind: GenerationFallbackKind, message: string, name = 'Error') {
        super(message);
        this.kind = kind;
        this.name = name;
    }
}

export interface OffThreadGeneration {
    result: GenerationResult;
    mode: 'worker' | 'sync-fallback';
    /** Present only when `mode` is `'sync-fallback'`. */
    fallbackKind?: GenerationFallbackKind;
    /** Present only when `mode` is `'sync-fallback'`. */
    fallbackReason?: string;
}

export async function generatePiecesOffThread(
    request: GenerationRequest,
    signal?: AbortSignal,
): Promise<OffThreadGeneration> {
    if (signal?.aborted) throw new GenerationCancelledError();

    if (typeof Worker === 'undefined') {
        return runOnMainThread(request, signal, 'no-worker', 'no-worker');
    }

    try {
        const result = await runInWorker(request, signal);
        return { result, mode: 'worker' };
    } catch (err) {
        if (err instanceof GenerationCancelledError) throw err;
        // Generation is a pure function of the request, so a worker-side
        // throw from `runGeneration` reproduces exactly here. Falling back
        // would buy a second full generation's freeze and then surface the
        // same error, so surface it now instead.
        if (err instanceof WorkerGenerationError) throw err;
        diagnostics.warn('Generation worker failed; falling back to main thread:', err);
        if (signal?.aborted) throw new GenerationCancelledError();
        const kind = err instanceof WorkerPathError ? err.kind : 'spawn-failed';
        return runOnMainThread(request, signal, kind, sanitizedReasonWithErrorName(err));
    }
}

/**
 * `'TypeError: x is not a function'` — or the bare message when the name
 * adds nothing, since a default `'Error'` would only spend the reason's
 * length budget.
 */
function withErrorName(name: string, message: string): string {
    return name && name !== 'Error' ? `${name}: ${message}` : message;
}

/**
 * `sanitizeErrorReason` reads `.message` only, so the error type the
 * worker puts on the wire as `name` (`generation-worker-core.ts`) would
 * otherwise stop at the console: `generationFallbackReason` is the only
 * place a recovered worker-side failure reaches analytics. Composed
 * before sanitizing so the name gets the same redaction and length cap
 * as the message.
 */
function sanitizedReasonWithErrorName(err: unknown): string {
    if (err instanceof Error) return sanitizeErrorReason(withErrorName(err.name, err.message));
    return sanitizeErrorReason(err);
}

/**
 * The synchronous fallback. Blocks the main thread for the whole generate
 * phase — the pre-worker status quo — so the two things wrapped around it
 * both exist because of that block.
 */
async function runOnMainThread(
    request: GenerationRequest,
    signal: AbortSignal | undefined,
    fallbackKind: GenerationFallbackKind,
    fallbackReason: string,
): Promise<OffThreadGeneration> {
    // The worker path loads the lazy traced chunk itself; this one runs
    // against the main thread's copy. Every reachable caller has already
    // preloaded it — the orchestrators have to, because they own the
    // degrade decision — so this is a no-op there (the loader memoizes,
    // and a cached call emits no analytics). It is here so
    // `createNewGameAsync`, a public export, is self-contained rather than
    // silently dependent on its caller. A rejection is swallowed: the
    // caller has already decided this request is generatable, and turning
    // a fallback into a hard failure would be strictly worse.
    if (requestNeedsTracedTabs(request)) {
        await preloadTracedTabGenerator().catch(() => {});
    }

    const result = runGeneration(request);

    // Generation just blocked the main thread, so a Cancel click made
    // during it is still queued as an undispatched task. Yield to it
    // before reading the signal: without this the click is dropped
    // outright — the puzzle installs anyway and no `generation-cancelled`
    // is emitted — in exactly the population whose freeze is longest.
    await yieldToTaskQueue();
    if (signal?.aborted) throw new GenerationCancelledError();

    return { result, mode: 'sync-fallback', fallbackKind, fallbackReason };
}

/** Let queued tasks — notably a pending user-input event — run. */
function yieldToTaskQueue(): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function runInWorker(
    request: GenerationRequest,
    signal?: AbortSignal,
): Promise<GenerationResult> {
    return new Promise<GenerationResult>((resolve, reject) => {
        const worker = new Worker(
            new URL('./generation-worker.js', import.meta.url),
            { type: 'module' },
        );
        const settle = (fn: () => void) => {
            worker.terminate();
            signal?.removeEventListener('abort', onAbort);
            try {
                fn();
            } catch (err) {
                // `fn` reads the message payload, so a malformed response
                // can throw here. Without this the promise never settles
                // and the overlay stays up until the page is reloaded.
                // Wrapped rather than rethrown raw so it doesn't fall
                // through to the `'spawn-failed'` default upstream, which
                // names a cause that did not happen.
                reject(new WorkerPathError(
                    'message-error',
                    err instanceof Error ? err.message : String(err),
                    err instanceof Error ? err.name : 'Error',
                ));
            }
        };
        const onAbort = () => settle(() => reject(new GenerationCancelledError()));
        signal?.addEventListener('abort', onAbort);
        worker.onmessage = (event: MessageEvent<GenerationResponse>) => settle(() => {
            const response = event.data;
            if (response.ok) resolve(response.result);
            else if (response.kind === 'generation') {
                reject(new WorkerGenerationError(response.error, response.name));
            } else {
                reject(new WorkerPathError(
                    'worker-infrastructure', response.error, response.name,
                ));
            }
        });
        worker.onerror = (event) => {
            // Cancel the event. Per the HTML spec an uncaught worker
            // exception whose `error` event is not canceled is re-reported
            // in the parent's global scope, where `error-tracking.ts`'s
            // `window.onerror` listener picks it up — so a failure this
            // client handles gracefully would ALSO ship a spurious
            // `unhandled-error` event (`isIgnorableErrorEvent` won't filter
            // it: the filename is the worker chunk, not an extension URL).
            event.preventDefault();
            settle(() => reject(new WorkerPathError(
                'worker-error', event.message || 'Generation worker error',
            )));
        };
        worker.onmessageerror = () => settle(() => reject(new WorkerPathError(
            'message-error', 'Generation worker response failed to deserialize',
        )));
        try {
            worker.postMessage(request);
        } catch (err) {
            // Synchronously thrown — e.g. a `DataCloneError` from a request
            // field that can't be structured-cloned. Route it through
            // `settle` like every other failure path above: without this,
            // the executor's throw still rejects the promise (so the
            // sync-fallback caller is unaffected), but `terminate()` never
            // runs and the abort listener is never removed, leaking both
            // the worker and the listener on the caller's signal.
            settle(() => reject(new WorkerPathError(
                'spawn-failed',
                err instanceof Error ? err.message : String(err),
                err instanceof Error ? err.name : 'Error',
            )));
        }
    });
}
