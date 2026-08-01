/**
 * Main-thread client for off-thread puzzle generation.
 *
 * Spawns a fresh worker per call and terminates it when done: per-call
 * lifetime keeps cancellation trivial (terminate) and leaves no stale
 * worker-side state, and spawn cost is milliseconds against a
 * once-per-new-game operation. On ANY worker-path failure — no Worker
 * in this environment, spawn failure, worker-side error — generation
 * falls back to running synchronously on the main thread, which is
 * exactly the pre-worker status quo.
 *
 * Cancellation: an aborted signal terminates the worker and rejects
 * with {@link GenerationCancelledError}. Cancel never falls back —
 * the user asked for no puzzle, not a slower one.
 */

import { diagnostics } from '../diagnostics.js';
import { sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';
import {
    runGeneration,
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

export interface OffThreadGeneration {
    result: GenerationResult;
    mode: 'worker' | 'sync-fallback';
    /** Present only when `mode` is `'sync-fallback'`. */
    fallbackReason?: string;
}

export async function generatePiecesOffThread(
    request: GenerationRequest,
    signal?: AbortSignal,
): Promise<OffThreadGeneration> {
    if (signal?.aborted) throw new GenerationCancelledError();

    if (typeof Worker === 'undefined') {
        return {
            result: runGeneration(request),
            mode: 'sync-fallback',
            fallbackReason: 'no-worker',
        };
    }

    try {
        const result = await runInWorker(request, signal);
        return { result, mode: 'worker' };
    } catch (err) {
        if (err instanceof GenerationCancelledError) throw err;
        diagnostics.warn('Generation worker failed; falling back to main thread:', err);
        if (signal?.aborted) throw new GenerationCancelledError();
        return {
            result: runGeneration(request),
            mode: 'sync-fallback',
            fallbackReason: sanitizeErrorReason(err),
        };
    }
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
            fn();
        };
        const onAbort = () => settle(() => reject(new GenerationCancelledError()));
        signal?.addEventListener('abort', onAbort);
        worker.onmessage = (event: MessageEvent<GenerationResponse>) => settle(() => {
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error));
        });
        worker.onerror = (event) => settle(() =>
            reject(new Error(event.message || 'Generation worker error')));
        worker.onmessageerror = () => settle(() =>
            reject(new Error('Generation worker response failed to deserialize')));
        worker.postMessage(request);
    });
}
