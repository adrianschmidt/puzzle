import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    generatePiecesOffThread,
    GenerationCancelledError,
} from './generate-async.js';
import { runGeneration, type GenerationRequest } from './generation-core.js';
import { sanitizeErrorReason } from '../analytics/sanitize-error-reason.js';

const REQUEST: GenerationRequest = {
    cutStyle: 'classic',
    gridSize: { cols: 4, rows: 3 },
    imageSize: { width: 1080, height: 720 },
    seed: 7,
    tabDebug: false,
};

/** Minimal Worker stand-in driven by each test. */
class StubWorker {
    static instances: StubWorker[] = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message?: string; preventDefault: () => void }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor() { StubWorker.instances.push(this); }
    postMessage(msg: unknown) { this.posted.push(msg); }
    terminate() { this.terminated = true; }
}

/**
 * A `postMessage` that throws synchronously, the way a real Worker's does on
 * a request it cannot structured-clone (`DataCloneError`).
 *
 * Not reachable from production today — nothing under `src/` writes
 * `ComposableConfig.tabDebug` before `buildGenerationRequest` runs, and the
 * `Omit<…, 'tabDebug'>` on `GenerationRequest` documents that at the type
 * level — but the runtime guard is what keeps a future non-cloneable request
 * field from wedging the overlay instead of falling back.
 */
class ThrowingPostMessageWorker extends StubWorker {
    postMessage(): never {
        throw new DOMException('could not clone request', 'DataCloneError');
    }
}

/** A `new Worker(...)` that throws, e.g. a blocked or missing worker script. */
class ThrowingConstructorWorker {
    constructor() { throw new Error('worker script blocked'); }
}

const originalWorker = (globalThis as { Worker?: unknown }).Worker;

beforeEach(() => { StubWorker.instances = []; });
afterEach(() => {
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
});

describe('generatePiecesOffThread', () => {
    it('falls back synchronously when Worker is undefined (jsdom default)', async () => {
        delete (globalThis as { Worker?: unknown }).Worker;
        const outcome = await generatePiecesOffThread(REQUEST);
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackKind).toBe('no-worker');
        expect(outcome.fallbackReason).toBe('no-worker');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
    });

    it('uses the worker path: posts the request, resolves with the result, terminates', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        const worker = StubWorker.instances[0];
        expect(worker.posted).toEqual([REQUEST]);
        const result = runGeneration(REQUEST);
        worker.onmessage!({ data: { ok: true, result } });
        const outcome = await promise;
        expect(outcome).toEqual({ result, mode: 'worker' });
        expect(worker.terminated).toBe(true);
    });

    it('falls back to sync generation when the worker reports an infrastructure error', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({
            data: { ok: false, kind: 'infrastructure', error: 'boom', name: 'Error' },
        });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackKind).toBe('worker-infrastructure');
        expect(outcome.fallbackReason).toContain('boom');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('puts the worker-side error name in front of the fallback reason', async () => {
        // `generationFallbackReason` is the only place a worker-side failure
        // reaches analytics, and `sanitizeErrorReason` reads `.message`
        // only — so without the prefix the `name` the worker ships across
        // `postMessage` would be dropped before it gets there.
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({
            data: {
                ok: false,
                kind: 'infrastructure',
                error: 'x is not a function',
                name: 'TypeError',
            },
        });
        const outcome = await promise;
        expect(outcome.fallbackReason).toBe('TypeError: x is not a function');
    });

    it('does not spend the reason budget on a bare Error name', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({
            data: { ok: false, kind: 'infrastructure', error: 'boom', name: 'Error' },
        });
        const outcome = await promise;
        expect(outcome.fallbackReason).toBe('boom');
    });

    it('rethrows a worker generation error instead of re-running it here', async () => {
        // Generation is a pure function of the request, so the main-thread
        // rerun would freeze for a full generation and throw identically.
        // Load-bearing: with a fallback the assertion below would resolve.
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({
            data: {
                ok: false,
                kind: 'generation',
                error: 'x is not a function',
                name: 'TypeError',
            },
        });
        const rejection: unknown = await promise.then(() => null, (err: unknown) => err);
        expect(StubWorker.instances[0].terminated).toBe(true);
        // The worker-side type is folded into the message rather than left
        // on `name`: this is the one error that leaves the module, and the
        // caller's `new-game-failed` / `shared-load-failed` reason comes
        // from `sanitizeErrorReason`, which reads `.message` only. Asserted
        // through the sanitizer so the pin is on what analytics receives.
        expect(sanitizeErrorReason(rejection)).toBe('TypeError: x is not a function');
        expect(rejection).toMatchObject({ name: 'WorkerGenerationError' });
    });

    it('does not spend the rethrown reason budget on a bare Error name either', async () => {
        // The same budget rule as the fallback branch above, pinned
        // separately here: the two branches fold the name in at different
        // call sites, so a regression confined to this one would ship a
        // useless `'Error: boom'` on `new-game-failed` / `shared-load-failed`
        // with the fallback branch's assertions still green.
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({
            data: { ok: false, kind: 'generation', error: 'boom', name: 'Error' },
        });
        const rejection: unknown = await promise.then(() => null, (err: unknown) => err);
        expect(sanitizeErrorReason(rejection)).toBe('boom');
    });

    it('falls back when the worker itself errors (onerror), and cancels the event', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        const preventDefault = vi.fn();
        StubWorker.instances[0].onerror!({ message: 'script failed to load', preventDefault });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackKind).toBe('worker-error');
        expect(StubWorker.instances[0].terminated).toBe(true);
        // Uncancelled, the worker's error event is re-reported on the
        // parent's global scope, so a failure handled gracefully here would
        // also ship a spurious `unhandled-error` analytics event.
        expect(preventDefault).toHaveBeenCalledOnce();
    });

    it('falls back when the response fails to deserialize (onmessageerror)', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessageerror!();
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackKind).toBe('message-error');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('falls back when the Worker constructor itself throws', async () => {
        (globalThis as { Worker?: unknown }).Worker = ThrowingConstructorWorker;
        const outcome = await generatePiecesOffThread(REQUEST);
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackKind).toBe('spawn-failed');
        expect(outcome.fallbackReason).toContain('worker script blocked');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
    });

    it('falls back when the worker posts a response that cannot be read', async () => {
        // Reading `.ok` off a malformed message throws inside `settle`.
        // Without `settle` catching it the promise would never settle at
        // all, leaving the loading overlay up until the page is reloaded.
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({ data: null });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        // Bucketed as an unusable response, not as `'spawn-failed'` — the
        // catch-all default, which names a cause that did not happen.
        expect(outcome.fallbackKind).toBe('message-error');
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('abort during worker generation terminates and throws the sentinel', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const controller = new AbortController();
        const promise = generatePiecesOffThread(REQUEST, controller.signal);
        controller.abort();
        await expect(promise).rejects.toBeInstanceOf(GenerationCancelledError);
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('falls back to sync generation when postMessage throws synchronously, and cleans up', async () => {
        (globalThis as { Worker?: unknown }).Worker = ThrowingPostMessageWorker;
        const controller = new AbortController();
        const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener');

        const outcome = await generatePiecesOffThread(REQUEST, controller.signal);

        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
        // Load-bearing: without routing the synchronous throw through
        // `settle`, the worker is constructed and never terminated.
        expect(StubWorker.instances[0].terminated).toBe(true);
        // The abort listener attached before `postMessage` must also be
        // cleaned up, or it (and the signal it closes over) leaks.
        expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('honors an abort that lands while a worker error is being handled', async () => {
        // The worker path has already settled by then — `settle` detached
        // the abort listener — so only the re-check before the sync rerun
        // can honor this cancel. Without it the player gets a puzzle they
        // asked not to have, generated during a freeze they asked to skip.
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const controller = new AbortController();
        const promise = generatePiecesOffThread(REQUEST, controller.signal);
        StubWorker.instances[0].onerror!({ message: 'boom', preventDefault: vi.fn() });
        controller.abort();
        await expect(promise).rejects.toBeInstanceOf(GenerationCancelledError);
    });

    it('honors a Cancel that lands during the synchronous fallback generation', async () => {
        // A click made during a blocking generation cannot be dispatched
        // until that generation returns, so the abort is queued as a task
        // ahead of the fallback's own post-generation yield — the ordering
        // this timer reproduces. Without that yield the click is dropped
        // outright: the puzzle installs and nothing is even counted.
        delete (globalThis as { Worker?: unknown }).Worker;
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 0);
        await expect(generatePiecesOffThread(REQUEST, controller.signal))
            .rejects.toBeInstanceOf(GenerationCancelledError);
    });

    it('an already-aborted signal throws before spawning anything', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const controller = new AbortController();
        controller.abort();
        await expect(generatePiecesOffThread(REQUEST, controller.signal))
            .rejects.toBeInstanceOf(GenerationCancelledError);
        expect(StubWorker.instances).toHaveLength(0);
    });
});
