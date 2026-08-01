import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    generatePiecesOffThread,
    GenerationCancelledError,
} from './generate-async.js';
import { runGeneration, type GenerationRequest } from './generation-core.js';

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
    onerror: ((e: { message?: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor() { StubWorker.instances.push(this); }
    postMessage(msg: unknown) { this.posted.push(msg); }
    terminate() { this.terminated = true; }
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

    it('falls back to sync generation when the worker reports an error', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onmessage!({ data: { ok: false, error: 'boom' } });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
        expect(outcome.fallbackReason).toContain('boom');
        expect(outcome.result).toEqual(runGeneration(REQUEST));
        expect(StubWorker.instances[0].terminated).toBe(true);
    });

    it('falls back when the worker itself errors (onerror)', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const promise = generatePiecesOffThread(REQUEST);
        StubWorker.instances[0].onerror!({ message: 'script failed to load' });
        const outcome = await promise;
        expect(outcome.mode).toBe('sync-fallback');
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

    it('an already-aborted signal throws before spawning anything', async () => {
        (globalThis as { Worker?: unknown }).Worker = StubWorker;
        const controller = new AbortController();
        controller.abort();
        await expect(generatePiecesOffThread(REQUEST, controller.signal))
            .rejects.toBeInstanceOf(GenerationCancelledError);
        expect(StubWorker.instances).toHaveLength(0);
    });
});
